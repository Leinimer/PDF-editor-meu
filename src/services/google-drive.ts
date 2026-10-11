/**
 * Google Drive API & Google Identity Services (OAuth2) integration.
 *
 * Handles:
 * - Reading PUBLIC_GOOGLE_* environment variables
 * - Loading Google Identity Services (GIS)
 * - Requesting and caching OAuth2 access tokens strictly in memory
 * - Downloading file contents via Google Drive API v3
 *
 * No tokens or client secrets are ever stored in localStorage or sent to any server.
 */

import type { TokenResponse } from './google-types';

interface TokenCache {
  token: string;
  expiresAt: number;
}

// In-memory token storage (never persisted to localStorage or disk)
let cachedToken: TokenCache | null = null;
let gsiPromise: Promise<void> | null = null;

/**
 * Returns Google configuration from public environment variables.
 */
export function getGoogleDriveConfig(): { clientId: string; apiKey: string; appId: string } {
  const clientId = process.env.PUBLIC_GOOGLE_CLIENT_ID || '';
  const apiKey = process.env.PUBLIC_GOOGLE_API_KEY || '';
  const appId = process.env.PUBLIC_GOOGLE_APP_ID || '';

  return { clientId, apiKey, appId };
}

/**
 * Checks if a valid, unexpired token exists in memory.
 */
export function hasGoogleAuth(): boolean {
  return cachedToken !== null && Date.now() < cachedToken.expiresAt - 60000;
}

/**
 * Returns currently cached token in memory if valid.
 */
export function getCachedToken(): string | null {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token;
  }
  return null;
}

/**
 * Clears in-memory token and optionally revokes with Google.
 */
export function disconnectGoogleAccount(): void {
  if (cachedToken?.token && window.google?.accounts?.oauth2?.revoke) {
    try {
      window.google.accounts.oauth2.revoke(cachedToken.token);
    } catch {
      // Ignore revocation error on client disconnect
    }
  }
  cachedToken = null;
}

/**
 * Dynamically loads Google Identity Services script.
 */
export function loadGsiScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (gsiPromise) return gsiPromise;

  gsiPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => {
        gsiPromise = null;
        reject(new Error('Falha ao carregar o Google Identity Services.'));
      });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gsiPromise = null;
      reject(new Error('Não foi possível carregar os serviços do Google. Verifique sua conexão.'));
    };
    document.head.appendChild(script);
  });

  return gsiPromise;
}

/**
 * Requests OAuth2 access token with drive.file scope using Google Identity Services.
 */
export async function requestGoogleAccessToken(
  customClientId?: string,
  forceRefresh = false,
): Promise<string> {
  if (!forceRefresh) {
    const existing = getCachedToken();
    if (existing) return existing;
  }

  const clientId = customClientId || getGoogleDriveConfig().clientId;
  if (!clientId) {
    throw new Error(
      'Client ID do Google não configurado. Defina PUBLIC_GOOGLE_CLIENT_ID nas configurações.',
    );
  }

  await loadGsiScript();

  return new Promise<string>((resolve, reject) => {
    try {
      const client = window.google!.accounts!.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (response: TokenResponse) => {
          if (response.error) {
            cachedToken = null;
            if (response.error === 'access_denied' || response.error === 'popup_closed_by_user') {
              reject(new Error('Autorização do Google cancelada pelo usuário.'));
            } else {
              reject(
                new Error(
                  `Autorização não concedida pelo Google: ${response.error_description || response.error}`,
                ),
              );
            }
            return;
          }

          if (!response.access_token) {
            cachedToken = null;
            reject(new Error('Token de acesso não fornecido pelo Google.'));
            return;
          }

          const expiresIn =
            typeof response.expires_in === 'number'
              ? response.expires_in
              : parseInt(String(response.expires_in || '3600'), 10);

          cachedToken = {
            token: response.access_token,
            expiresAt: Date.now() + (expiresIn || 3600) * 1000,
          };

          resolve(response.access_token);
        },
        error_callback: (err: unknown) => {
          cachedToken = null;
          reject(err instanceof Error ? err : new Error('Falha na autenticação do Google.'));
        },
      });

      // Se for forçado refresh, solicita consentimento/seleção se necessário
      client.requestAccessToken({ prompt: forceRefresh ? 'select_account' : '' });
    } catch (err) {
      cachedToken = null;
      reject(err instanceof Error ? err : new Error('Erro ao inicializar autenticação com Google.'));
    }
  });
}

/**
 * Gets file metadata (modifiedTime, version, name) from Google Drive API v3.
 */
export async function getGoogleDriveFileMetadata(
  fileId: string,
  token: string,
): Promise<{ id: string; name: string; modifiedTime?: string; version?: string; mimeType?: string }> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,modifiedTime,version,mimeType`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      cachedToken = null;
      throw new Error('Sessão do Google Drive expirada (401). Por favor, autorize novamente.');
    }
    if (response.status === 403) {
      throw new Error('Permissão insuficiente para obter informações deste arquivo no Google Drive (403).');
    }
    if (response.status === 404) {
      throw new Error('Arquivo não encontrado no Google Drive (404).');
    }
    throw new Error(`Falha ao obter metadados do Google Drive (código HTTP ${response.status}).`);
  }

  return response.json();
}

/**
 * Downloads a file directly from Google Drive API v3 as a Blob.
 *
 * Enforces OAuth Bearer token header, verifies HTTP status, ensures response is
 * not an HTML/login page, and validates the %PDF- file signature.
 */
export async function downloadGoogleDriveFile(fileId: string, token: string): Promise<Blob> {
  if (!token) {
    throw new Error('Token de acesso do Google ausente. É necessária a autenticação.');
  }

  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (err) {
    throw new Error(
      `Falha de conexão com o Google Drive: ${err instanceof Error ? err.message : 'Erro de rede'}.`,
      { cause: err },
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      cachedToken = null; // Invalida o token expirado
      throw new Error('Sessão do Google Drive expirada (401). Por favor, autorize novamente.');
    }
    if (response.status === 403) {
      throw new Error(
        'Permissão insuficiente para acessar este arquivo no Google Drive (403). Verifique se você tem acesso ao arquivo.',
      );
    }
    if (response.status === 404) {
      throw new Error('Arquivo não encontrado no Google Drive (404).');
    }
    const errText = await response.text().catch(() => '');
    throw new Error(`Falha ao baixar o arquivo do Google Drive (código HTTP ${response.status}): ${errText || response.statusText}`);
  }

  // 1. Validar Content-Type
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw new Error(
      'A resposta do Google Drive retornou uma página HTML em vez do arquivo PDF (possível redirecionamento de login). O arquivo não pôde ser aberto.',
    );
  }

  // 2. Ler conteúdo binário
  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    throw new Error('O arquivo retornado pelo Google Drive está vazio (0 bytes).');
  }

  // 3. Inspecionar cabeçalho para descartar HTML e confirmar assinatura %PDF-
  const previewSlice = arrayBuffer.slice(0, Math.min(1024, arrayBuffer.byteLength));
  const previewBytes = new Uint8Array(previewSlice);
  const previewText = new TextDecoder('latin1').decode(previewBytes);

  if (
    previewText.toLowerCase().includes('<!doctype') ||
    previewText.toLowerCase().includes('<html') ||
    previewText.toLowerCase().includes('<body')
  ) {
    throw new Error(
      'A resposta recebida do Google Drive é uma página web HTML de login/erro, e não um documento PDF.',
    );
  }

  if (!previewText.includes('%PDF-')) {
    throw new Error(
      'O arquivo baixado do Google Drive não contém uma assinatura PDF válida (%PDF-). Não é possível abrir.',
    );
  }

  return new Blob([arrayBuffer], { type: 'application/pdf' });
}

/**
 * Updates an existing file's binary content in Google Drive API v3 using multipart/upload
 * or direct binary upload to /upload/drive/v3/files/{fileId}?uploadType=media.
 */
export async function updateGoogleDriveFile(
  fileId: string,
  token: string,
  pdfBytes: Uint8Array,
): Promise<{ id: string; name: string; modifiedTime?: string; version?: string }> {
  const url = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime,version`;

  const blob = new Blob([pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer], {
    type: 'application/pdf',
  });

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/pdf',
    },
    body: blob,
  });

  if (!response.ok) {
    if (response.status === 401) {
      cachedToken = null;
      throw new Error('Sessão expirada. Por favor, autorize novamente a conta Google.');
    }
    if (response.status === 403) {
      throw new Error(
        'Permissão negada ao salvar no Google Drive. Verifique se o app possui autorização de escrita para o arquivo selecionado.',
      );
    }
    if (response.status === 404) {
      throw new Error('Arquivo não encontrado no Google Drive.');
    }
    const errText = await response.text().catch(() => '');
    throw new Error(`Falha ao salvar no Google Drive (${response.status}): ${errText || response.statusText}`);
  }

  return response.json();
}

// Re-export picker functions for backward-compatibility
export { openPdfFromGoogleDrive as openGoogleDrivePdf, openPdfFromGoogleDrive } from './google-picker';

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
  const clientId = process.env['PUBLIC_GOOGLE_CLIENT_ID'] ?? '';
  const apiKey = process.env['PUBLIC_GOOGLE_API_KEY'] ?? '';
  const appId = process.env['PUBLIC_GOOGLE_APP_ID'] ?? '';

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
export async function requestGoogleAccessToken(customClientId?: string): Promise<string> {
  const existing = getCachedToken();
  if (existing) return existing;

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
          reject(err instanceof Error ? err : new Error('Falha na autenticação do Google.'));
        },
      });

      client.requestAccessToken({ prompt: '' });
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Erro ao inicializar autenticação com Google.'));
    }
  });
}

/**
 * Downloads a file directly from Google Drive API v3 as a Blob.
 */
export async function downloadGoogleDriveFile(fileId: string, token: string): Promise<Blob> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      cachedToken = null; // Invalidate expired token
      throw new Error('Sessão do Google Drive expirada. Por favor, autorize novamente.');
    }
    if (response.status === 403) {
      throw new Error('Permissão insuficiente para acessar este arquivo no Google Drive.');
    }
    if (response.status === 404) {
      throw new Error('Arquivo não encontrado no Google Drive.');
    }
    throw new Error(`Falha ao baixar o arquivo do Google Drive (código HTTP ${response.status}).`);
  }

  return response.blob();
}

// Re-export picker functions for backward-compatibility
export { openPdfFromGoogleDrive as openGoogleDrivePdf, openPdfFromGoogleDrive } from './google-picker';

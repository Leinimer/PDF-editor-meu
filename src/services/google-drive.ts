/**
 * Google Drive API v3 + Google Identity Services.
 *
 * Pattern follows Google's official browser sample:
 * https://github.com/googleworkspace/browser-samples/blob/main/drive/picker/helloworld.html
 * File bytes are fetched directly from Drive REST API; preview pages are never used.
 */

import type { TokenResponse } from './google-types';

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  version?: string;
  capabilities?: { canDownload?: boolean };
}

let tokenCache: TokenCache | null = null;
let identityScriptPromise: Promise<void> | null = null;

const IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export function getGoogleDriveConfig(): {
  clientId: string;
  apiKey: string;
  appId: string;
} {
  return {
    clientId: process.env.PUBLIC_GOOGLE_CLIENT_ID || '',
    apiKey: process.env.PUBLIC_GOOGLE_API_KEY || '',
    appId: process.env.PUBLIC_GOOGLE_APP_ID || '',
  };
}

/** Load Google Identity Services once, preferably before the user clicks Connect. */
export function loadGoogleIdentityServices(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Drive só pode ser conectado no navegador.'));
  }
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (identityScriptPromise) return identityScriptPromise;

  identityScriptPromise = new Promise<void>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(`script[src="${IDENTITY_SCRIPT_URL}"]`);

    const finish = () => {
      if (window.google?.accounts?.oauth2) {
        resolve();
      } else {
        identityScriptPromise = null;
        reject(new Error('O Google Identity Services carregou, mas a API OAuth não ficou disponível.'));
      }
    };

    if (script?.dataset.loadState === 'loaded') {
      finish();
      return;
    }

    const onLoad = () => {
      if (script) script.dataset.loadState = 'loaded';
      finish();
    };
    const onError = () => {
      identityScriptPromise = null;
      reject(new Error('Não foi possível carregar o Google Identity Services.'));
    };

    if (script) {
      script.addEventListener('load', onLoad, { once: true });
      script.addEventListener('error', onError, { once: true });
      // A script may already have finished loading before this listener was added.
      if (window.google?.accounts?.oauth2) finish();
      return;
    }

    script = document.createElement('script');
    script.src = IDENTITY_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    document.head.appendChild(script);
  });

  return identityScriptPromise;
}

export function hasGoogleAuth(): boolean {
  return getCachedToken() !== null;
}

export function getCachedToken(): string | null {
  if (!tokenCache) return null;
  if (Date.now() >= tokenCache.expiresAt - 60_000) {
    tokenCache = null;
    return null;
  }
  return tokenCache.accessToken;
}

export function disconnectGoogleAccount(): void {
  const token = getCachedToken();
  tokenCache = null;
  if (token && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(token, () => undefined);
  }
}

/**
 * Get an OAuth access token. The token model uses a short-lived in-memory token,
 * exactly as in Google's official browser sample; no token is written to storage.
 */
export async function requestGoogleAccessToken(
  customClientId?: string,
  forceRefresh = false,
): Promise<string> {
  if (!forceRefresh) {
    const cached = getCachedToken();
    if (cached) return cached;
  }

  const clientId = customClientId || getGoogleDriveConfig().clientId;
  if (!clientId) {
    throw new Error('PUBLIC_GOOGLE_CLIENT_ID não está configurado no build publicado.');
  }

  await loadGoogleIdentityServices();

  return new Promise<string>((resolve, reject) => {
    try {
      const tokenClient = window.google!.accounts!.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_FILE_SCOPE,
        callback: (response: TokenResponse) => {
          if (response.error) {
            tokenCache = null;
            reject(
              new Error(
                response.error === 'access_denied'
                  ? 'A autorização do Google Drive foi recusada.'
                  : `O Google não autorizou o acesso: ${response.error_description || response.error}`,
              ),
            );
            return;
          }

          if (!response.access_token) {
            tokenCache = null;
            reject(new Error('O Google não retornou um token de acesso.'));
            return;
          }

          const seconds = Math.max(60, Number(response.expires_in) || 3600);
          tokenCache = {
            accessToken: response.access_token,
            expiresAt: Date.now() + seconds * 1000,
          };
          resolve(response.access_token);
        },
        error_callback: (error: unknown) => {
          tokenCache = null;
          reject(error instanceof Error ? error : new Error('A janela de autorização do Google falhou.'));
        },
      });

      // First connection shows consent/account UI. Subsequent access uses the existing grant.
      tokenClient.requestAccessToken({
        // Do not force a new consent screen on every fresh page load. Google reuses
        // a previously granted session when prompt is empty; only force account choice on refresh.
        prompt: forceRefresh ? 'select_account' : '',
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Não foi possível iniciar a autorização Google.'));
    }
  });
}

async function readGoogleApiError(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
    return parsed.error?.message || parsed.message || body || response.statusText;
  } catch {
    return body || response.statusText;
  }
}

/** Fetch selected file metadata using its ID returned by the Picker. */
export async function getGoogleDriveFileMetadata(
  fileId: string,
  token: string,
): Promise<DriveFileMetadata> {
  const fields = 'id,name,mimeType,modifiedTime,version,capabilities(canDownload)';
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });

  if (!response.ok) {
    if (response.status === 401) tokenCache = null;
    const detail = await readGoogleApiError(response);
    throw new Error(`Não foi possível ler os dados do arquivo no Google Drive (HTTP ${response.status}): ${detail}`);
  }
  return (await response.json()) as DriveFileMetadata;
}

/**
 * Download an actual PDF from Drive (not the Drive preview page).
 * Official API method: files.get?alt=media with an OAuth Bearer token.
 */
export async function downloadGoogleDriveFile(fileId: string, token: string): Promise<Blob> {
  if (!fileId || !token) {
    throw new Error('Falta o ID do arquivo ou a autorização do Google Drive.');
  }

  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1',
      },
    });
  } catch (error) {
    throw new Error(
      `Falha de rede ao baixar o PDF pela Drive API. Verifique conexão e permissões de origem. ${error instanceof Error ? error.message : ''}`,
      { cause: error },
    );
  }

  if (!response.ok) {
    if (response.status === 401) tokenCache = null;
    const detail = await readGoogleApiError(response);
    const hint =
      response.status === 403
        ? ' Confirme que o usuário tem permissão para baixar o arquivo e que o escopo drive.file é suficiente para o documento selecionado.'
        : '';
    throw new Error(`Falha ao baixar o PDF do Google Drive (HTTP ${response.status}): ${detail}.${hint}`);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw new Error('A Drive API retornou HTML em vez do PDF. Não foi usado um link de visualização; verifique o token e as permissões.');
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error('O Google Drive retornou um arquivo vazio.');

  // A PDF header should occur at the beginning of a PDF file; tolerate a short preamble.
  const prefix = new TextDecoder('latin1').decode(bytes.slice(0, Math.min(bytes.byteLength, 1024)));
  if (!prefix.includes('%PDF-')) {
    throw new Error('O conteúdo baixado não contém o cabeçalho %PDF-. O arquivo não foi aberto para evitar corromper o editor.');
  }

  return new Blob([bytes], { type: 'application/pdf' });
}

/** Replace binary content of the original Drive file (existing Save feature). */
export async function updateGoogleDriveFile(
  fileId: string,
  token: string,
  pdfBytes: Uint8Array,
): Promise<{ id: string; name: string; modifiedTime?: string; version?: string }> {
  const url = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime,version`;
  const content = new Blob([pdfBytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/pdf',
    },
    body: content,
  });

  if (!response.ok) {
    if (response.status === 401) tokenCache = null;
    const detail = await readGoogleApiError(response);
    throw new Error(`Falha ao salvar o PDF no Google Drive (HTTP ${response.status}): ${detail}`);
  }
  return (await response.json()) as { id: string; name: string; modifiedTime?: string; version?: string };
}

/**
 * Google Picker API integration for selecting and opening PDF files from Google Drive.
 *
 * Reuses openFiles() from src/services/open-files.ts to open the selected PDF in the editor.
 */

import { useEditorStore } from '../editor-state/store';
import { openFiles, type OpenResult } from './open-files';
import {
  downloadGoogleDriveFile,
  getGoogleDriveConfig,
  requestGoogleAccessToken,
} from './google-drive';

import type {
  DocsViewInstance,
  PickerBuilderInstance,
  PickerDoc,
  PickerResponse,
} from './google-types';

export type { DocsViewInstance, PickerBuilderInstance, PickerDoc, PickerResponse };

export interface PickedGoogleFile {
  id: string;
  name: string;
  mimeType: string;
}

let gapiPromise: Promise<void> | null = null;
let isOpeningDrive = false;

/**
 * Loads the Google API client script and initializes the Google Picker library.
 */
export function loadGooglePickerScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.google?.picker) {
    return Promise.resolve();
  }
  if (gapiPromise) return gapiPromise;

  gapiPromise = new Promise<void>((resolve, reject) => {
    const onGapiReady = () => {
      if (!window.gapi) {
        gapiPromise = null;
        reject(new Error('Falha ao inicializar a biblioteca Google API.'));
        return;
      }
      window.gapi.load('picker', {
        callback: () => resolve(),
        onerror: () => {
          gapiPromise = null;
          reject(new Error('Não foi possível carregar o Google Picker API.'));
        },
      });
    };

    const existing = document.querySelector('script[src="https://apis.google.com/js/api.js"]');
    if (existing) {
      if (window.gapi) {
        onGapiReady();
      } else {
        existing.addEventListener('load', onGapiReady);
        existing.addEventListener('error', () => {
          gapiPromise = null;
          reject(new Error('Falha ao carregar a biblioteca Google API.'));
        });
      }
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    script.onload = onGapiReady;
    script.onerror = () => {
      gapiPromise = null;
      reject(new Error('Não foi possível carregar o script Google API Client.'));
    };
    document.head.appendChild(script);
  });

  return gapiPromise;
}

/**
 * Opens Google Picker modal filtered to PDF documents.
 */
export async function showGooglePicker(
  token: string,
  apiKey: string,
  appId?: string,
): Promise<PickedGoogleFile | null> {
  await loadGooglePickerScript();

  return new Promise<PickedGoogleFile | null>((resolve, reject) => {
    try {
      const docsView = new window.google!.picker!.DocsView(window.google!.picker!.ViewId.DOCS)
        .setMimeTypes('application/pdf')
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false);

      const builder = new window.google!.picker!.PickerBuilder()
        .addView(docsView)
        .setOAuthToken(token)
        .setDeveloperKey(apiKey)
        .setCallback((data: PickerResponse) => {
          if (data.action === window.google!.picker!.Action.PICKED) {
            const doc = data.docs?.[0];
            if (doc) {
              resolve({
                id: doc.id,
                name: doc.name,
                mimeType: doc.mimeType,
              });
            } else {
              resolve(null);
            }
          } else if (data.action === window.google!.picker!.Action.CANCEL) {
            // Cancelled silently
            resolve(null);
          }
        });

      if (appId) {
        builder.setAppId(appId);
      }

      const picker = builder.build();
      picker.setVisible(true);
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Erro ao inicializar o Google Picker.'));
    }
  });
}

export interface OpenGoogleDriveResult {
  file: File;
  openResult: OpenResult;
}

/**
 * Orchestrator: connects Google account if needed, shows Picker, downloads chosen PDF,
 * and opens it in the editor using openFiles().
 */
export async function openPdfFromGoogleDrive(): Promise<OpenGoogleDriveResult | null> {
  if (isOpeningDrive) {
    return null; // Prevent duplicate clicks
  }
  isOpeningDrive = true;

  try {
    const { clientId, apiKey, appId } = getGoogleDriveConfig();
    if (!clientId || !apiKey) {
      throw new Error(
        'Configuração do Google Drive ausente. Configure as variáveis PUBLIC_GOOGLE_CLIENT_ID e PUBLIC_GOOGLE_API_KEY no arquivo .env.',
      );
    }

    // 1. Authorize / get access token
    const token = await requestGoogleAccessToken(clientId);

    // 2. Open Google Picker
    const picked = await showGooglePicker(token, apiKey, appId);
    if (!picked) {
      return null; // User cancelled
    }

    // 3. Download file with loading overlay
    useEditorStore.getState().setBusy({
      label: `Baixando "${picked.name}" do Google Drive`,
      progress: null,
    });

    const blob = await downloadGoogleDriveFile(picked.id, token);
    const fileName = picked.name.toLowerCase().endsWith('.pdf') ? picked.name : `${picked.name}.pdf`;
    const file = new File([blob], fileName, { type: 'application/pdf' });

    // 4. Fetch metadata if available
    let modifiedTime: string | undefined;
    let version: string | undefined;
    try {
      const { getGoogleDriveFileMetadata } = await import('./google-drive');
      const meta = await getGoogleDriveFileMetadata(picked.id, token);
      modifiedTime = meta.modifiedTime;
      version = meta.version;
    } catch {
      // Non-fatal if metadata fetch fails
    }

    // 5. Open in editor reusing existing openFiles() pipeline with GoogleDrive metadata
    const openResult = await openFiles([file], {
      origin: 'google-drive',
      googleDrive: {
        fileId: picked.id,
        name: picked.name,
        modifiedTime,
        version,
        mimeType: picked.mimeType,
      },
    });

    return { file, openResult };
  } finally {
    useEditorStore.getState().setBusy(null);
    isOpeningDrive = false;
  }
}

// Alias for convenience
export const openGoogleDrivePdf = openPdfFromGoogleDrive;

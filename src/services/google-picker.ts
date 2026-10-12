/**
 * Google Drive -> PDF editor integration.
 *
 * Based on Google's official Picker sample:
 * https://github.com/googleworkspace/browser-samples/blob/main/drive/picker/helloworld.html
 *
 * The Picker only returns metadata. PDF bytes are retrieved separately with
 * Drive API v3 files.get?alt=media and handed to the existing openFiles() pipeline.
 */

import { useEditorStore } from '../editor-state/store';
import { openFiles, type OpenResult } from './open-files';
import {
  downloadGoogleDriveFile,
  getGoogleDriveConfig,
  getGoogleDriveFileMetadata,
  loadGoogleIdentityServices,
  requestGoogleAccessToken,
} from './google-drive';
import type { PickerDoc, PickerResponse } from './google-types';

export type { DocsViewInstance, PickerBuilderInstance, PickerDoc, PickerResponse } from './google-types';

export interface PickedGoogleFile {
  id: string;
  name: string;
  mimeType: string;
}

let pickerLibraryPromise: Promise<void> | null = null;
let opening = false;

function loadApiScript(): Promise<void> {
  if (window.gapi && window.google?.picker) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(
    'script[src="https://apis.google.com/js/api.js"]',
  );

  const scriptLoaded = existing?.dataset.loadState === 'loaded';
  const scriptPromise = scriptLoaded
    ? Promise.resolve()
    : new Promise<void>((resolve, reject) => {
        let script = existing;
        if (!script) {
          script = document.createElement('script');
          script.src = 'https://apis.google.com/js/api.js';
          script.async = true;
          script.defer = true;
          document.head.appendChild(script);
        }

        const onLoad = () => {
          script!.dataset.loadState = 'loaded';
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('Não foi possível carregar a biblioteca Google API.'));
        };
        const cleanup = () => {
          script!.removeEventListener('load', onLoad);
          script!.removeEventListener('error', onError);
        };

        script!.addEventListener('load', onLoad, { once: true });
        script!.addEventListener('error', onError, { once: true });

        // The script may already have completed loading before listeners were attached.
        if (window.gapi) {
          cleanup();
          resolve();
        }
      });

  return scriptPromise;
}

/** Initialize Google Picker once. Call on app startup so auth is ready before user interaction. */
export function loadGooglePickerLibrary(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  if (pickerLibraryPromise) return pickerLibraryPromise;

  pickerLibraryPromise = (async () => {
    await loadApiScript();

    if (!window.gapi) throw new Error('Google API Client não foi inicializado.');

    await new Promise<void>((resolve, reject) => {
      window.gapi!.load('picker', {
        callback: resolve,
        onerror: () => reject(new Error('Não foi possível inicializar o Google Picker.')),
      });
    });

    if (!window.google?.picker) {
      throw new Error('A biblioteca do Google Picker não ficou disponível.');
    }
  })().catch((error: unknown) => {
    pickerLibraryPromise = null;
    throw error instanceof Error ? error : new Error('Falha ao inicializar o Google Picker.');
  });

  return pickerLibraryPromise;
}

/** Preload both Google libraries before a click needs to request OAuth. */
export async function preloadGoogleDriveLibraries(): Promise<void> {
  await Promise.all([loadGoogleIdentityServices(), loadGooglePickerLibrary()]);
}

function getPickerValue(
  object: Record<string, unknown>,
  key: string | undefined,
  fallback: string,
): string | undefined {
  const value = (key ? object[key] : undefined) ?? object[fallback];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Show the official Google Picker dialog and return the selected PDF's ID. */
export async function showGooglePicker(
  accessToken: string,
  apiKey: string,
  appId: string,
): Promise<PickedGoogleFile | null> {
  if (!accessToken) throw new Error('Não há autorização ativa do Google Drive.');
  if (!apiKey) throw new Error('PUBLIC_GOOGLE_API_KEY não está configurada.');
  if (!appId || !/^\d+$/.test(appId)) {
    throw new Error('PUBLIC_GOOGLE_APP_ID deve conter o número do projeto Google Cloud, somente dígitos.');
  }

  await loadGooglePickerLibrary();

  const googlePicker = window.google?.picker;
  if (!googlePicker) throw new Error('Google Picker não está disponível.');

  return new Promise<PickedGoogleFile | null>((resolve, reject) => {
    let picker: ReturnType<InstanceType<typeof googlePicker.PickerBuilder>['build']> | null = null;
    let completed = false;
    let timeoutId = 0;

    const closePicker = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      try {
        picker?.setVisible(false);
      } catch {
        // Ignore if Google has already closed the dialog.
      }
      picker = null;
    };

    const finish = (result: PickedGoogleFile | null) => {
      if (completed) return;
      completed = true;
      closePicker();
      resolve(result);
    };

    const fail = (error: Error) => {
      if (completed) return;
      completed = true;
      closePicker();
      reject(error);
    };

    // If the Picker never dispatches PICKED/CANCEL, fail visibly instead of leaving
    // the app stuck forever. Five minutes is long enough for normal browsing.
    timeoutId = window.setTimeout(() => {
      fail(new Error('O Google Picker não concluiu a seleção em 5 minutos. Feche o seletor e tente novamente.'));
    }, 5 * 60 * 1000);

    try {
      const view = new googlePicker.DocsView(googlePicker.ViewId.DOCS)
        .setMimeTypes('application/pdf')
        .setIncludeFolders(false)
        .setSelectFolderEnabled(false);

      const builder = new googlePicker.PickerBuilder()
        .setDeveloperKey(apiKey)
        .setAppId(appId)
        .setOAuthToken(accessToken)
        .setOrigin(window.location.origin)
        .addView(view)
        .setCallback((response: PickerResponse) => {
          if (!response || completed) return;

          const responseObject = response as Record<string, unknown>;
          const actionKey = googlePicker.Response?.ACTION || 'action';
          const action = responseObject[actionKey] ?? responseObject.action;

          if (action === 'loaded' || (googlePicker.Action.LOADED && action === googlePicker.Action.LOADED)) return;

          if (action === googlePicker.Action.CANCEL || action === 'cancel') {
            finish(null);
            return;
          }

          if (action !== googlePicker.Action.PICKED && action !== 'picked') {
            // Do not log file IDs, OAuth tokens, or file names. This helps diagnose
            // a response-shape mismatch without exposing the user's Drive data.
            console.warn('[Google Picker] Ignoring unexpected callback action:', action ?? '(missing)');
            return;
          }

          // Use the exact response constants from Google's official sample.
          const documentsKey = googlePicker.Response?.DOCUMENTS || 'docs';
          const rawDocuments =
            responseObject[documentsKey] ??
            responseObject.docs;
          const documents = Array.isArray(rawDocuments) ? rawDocuments : [];
          const first = documents[0] as (PickerDoc & Record<string, unknown>) | undefined;

          if (!first) {
            fail(new Error('O Picker confirmou a seleção, mas não retornou o documento escolhido.'));
            return;
          }

          const documentKeys = googlePicker.Document;
          const id = getPickerValue(first, documentKeys?.ID, 'id');
          const name = getPickerValue(first, documentKeys?.NAME, 'name') || 'documento.pdf';
          const mimeType = getPickerValue(first, documentKeys?.MIME_TYPE, 'mimeType') || '';

          if (!id) {
            fail(new Error('O Google Picker não retornou o ID do arquivo.'));
            return;
          }

          if (mimeType && mimeType !== 'application/pdf' && !name.toLowerCase().endsWith('.pdf')) {
            fail(new Error('Selecione um arquivo PDF.'));
            return;
          }

          finish({
            id,
            name: name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`,
            mimeType: 'application/pdf',
          });
        });

      picker = builder.build();
      picker.setVisible(true);
    } catch (error) {
      fail(error instanceof Error ? error : new Error('Não foi possível abrir o seletor Google Drive.'));
    }
  });
}

export interface OpenGoogleDriveResult {
  file: File;
  openResult: OpenResult;
}

/** Complete flow: authorization -> Picker -> actual PDF bytes -> existing editor pipeline. */
export async function openPdfFromGoogleDrive(): Promise<OpenGoogleDriveResult | null> {
  if (opening) return null;
  opening = true;

  const store = useEditorStore.getState();
  try {
    const { clientId, apiKey, appId } = getGoogleDriveConfig();
    if (!clientId || !apiKey || !appId) {
      throw new Error(
        'Configuração incompleta. Confira PUBLIC_GOOGLE_CLIENT_ID, PUBLIC_GOOGLE_API_KEY e PUBLIC_GOOGLE_APP_ID nas variáveis de ambiente do projeto publicado.',
      );
    }

    store.setBusy({ label: 'Conectando ao Google Drive...', progress: null });
    // Script is preloaded on startup; token popup is initiated by this user action.
    let token = await requestGoogleAccessToken(clientId);

    store.setBusy({ label: 'Abrindo seus arquivos do Google Drive...', progress: null });
    const selected = await showGooglePicker(token, apiKey, appId);
    if (!selected) return null;

    // Metadata is useful for the later Save-to-Drive feature, but it is not a
    // prerequisite for opening. First obtain a reliable name from the Picker;
    // enrich it with Drive metadata if available.
    let metadata: {
      id: string;
      name: string;
      mimeType?: string;
      modifiedTime?: string;
      version?: string;
      capabilities?: { canDownload?: boolean };
    } = {
      id: selected.id,
      name: selected.name,
      mimeType: selected.mimeType,
    };

    try {
      metadata = await getGoogleDriveFileMetadata(selected.id, token);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('401') || message.includes('expirada')) {
        token = await requestGoogleAccessToken(clientId, true);
        try {
          metadata = await getGoogleDriveFileMetadata(selected.id, token);
        } catch (retryError) {
          // Do not block opening when optional metadata is unavailable.
          console.warn('Google Drive metadata unavailable; opening using Picker data.', retryError);
        }
      } else {
        // Some Drive files can be downloaded even when optional metadata fields
        // are restricted. The file ID returned by Picker remains the authority.
        console.warn('Google Drive metadata unavailable; opening using Picker data.', error);
      }
    }

    if (metadata.mimeType && metadata.mimeType !== 'application/pdf') {
      throw new Error(`"${metadata.name}" não é um PDF. Selecione um arquivo PDF no Google Drive.`);
    }
    if (metadata.capabilities?.canDownload === false) {
      throw new Error('O proprietário do arquivo desativou o download deste PDF no Google Drive.');
    }

    store.setBusy({ label: `Baixando "${metadata.name}"...`, progress: null });
    let blob: Blob;
    try {
      blob = await downloadGoogleDriveFile(selected.id, token);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('401')) throw error;
      token = await requestGoogleAccessToken(clientId, true);
      blob = await downloadGoogleDriveFile(selected.id, token);
    }

    const name = metadata.name || selected.name;
    const file = new File([blob], name, { type: 'application/pdf' });

    store.setBusy({ label: `Abrindo "${name}" no editor...`, progress: null });
    const openResult = await openFiles([file], {
      origin: 'google-drive',
      googleDrive: {
        fileId: selected.id,
        name,
        modifiedTime: metadata.modifiedTime,
        version: metadata.version,
        mimeType: metadata.mimeType || selected.mimeType,
      },
    });

    const documentId = openResult.openedDocumentIds?.[0];
    if (openResult.openedFiles !== 1 || !documentId) {
      const reason = openResult.errors.map((item) => item.message).filter(Boolean).join('; ');
      throw new Error(reason || 'O PDF foi baixado, mas não foi possível abrir uma nova aba no editor.');
    }

    useEditorStore.getState().setActiveDocument(documentId);
    return { file, openResult };
  } catch (error) {
    throw error instanceof Error ? error : new Error('Falha ao abrir o PDF do Google Drive.');
  } finally {
    useEditorStore.getState().setBusy(null);
    opening = false;
  }
}

export const openGoogleDrivePdf = openPdfFromGoogleDrive;

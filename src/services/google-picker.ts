/**
 * Google Picker integration.
 *
 * Uses the official Picker response keys, downloads the selected PDF through
 * the Drive REST API, validates its bytes, and hands the File to openFiles().
 * No Drive preview page, iframe, or secondary window is used to load the PDF.
 */

import { useEditorStore } from '../editor-state/store';
import { openFiles, type OpenResult } from './open-files';
import {
  downloadGoogleDriveFile,
  getGoogleDriveConfig,
  getGoogleDriveFileMetadata,
  requestGoogleAccessToken,
} from './google-drive';
import type { PickerDoc, PickerResponse } from './google-types';

export type { DocsViewInstance, PickerBuilderInstance, PickerDoc, PickerResponse } from './google-types';

export interface PickedGoogleFile {
  id: string;
  name: string;
  mimeType: string;
}

let pickerScriptPromise: Promise<void> | null = null;
let isOpeningDrive = false;

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing?.dataset.loaded === 'true') return Promise.resolve();

  if (existing) {
    return new Promise<void>((resolve, reject) => {
      const onLoad = () => {
        existing.dataset.loaded = 'true';
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`Não foi possível carregar o script: ${src}`));
      };
      const cleanup = () => {
        existing.removeEventListener('load', onLoad);
        existing.removeEventListener('error', onError);
      };
      existing.addEventListener('load', onLoad, { once: true });
      existing.addEventListener('error', onError, { once: true });
      // A script may already have completed loading before its marker was set.
      if (src.includes('/api.js') && window.gapi) {
        cleanup();
        resolve();
      } else if (src.includes('/gsi/client') && window.google?.accounts?.oauth2) {
        cleanup();
        resolve();
      }
    });
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => {
      script.remove();
      reject(new Error(`Não foi possível carregar a biblioteca do Google: ${src}`));
    };
    document.head.appendChild(script);
  });
}

/** Load the Google API client and Picker library once. */
export function loadGooglePickerScript(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  if (pickerScriptPromise) return pickerScriptPromise;

  pickerScriptPromise = (async () => {
    await loadScript('https://apis.google.com/js/api.js');

    if (!window.gapi) {
      throw new Error('A biblioteca Google API Client não foi inicializada.');
    }

    await new Promise<void>((resolve, reject) => {
      window.gapi!.load('picker', {
        callback: resolve,
        onerror: () => reject(new Error('Não foi possível inicializar o Google Picker.')),
      });
    });

    if (!window.google?.picker) {
      throw new Error('A API Google Picker carregou, mas não ficou disponível.');
    }
  })().catch((error: unknown) => {
    pickerScriptPromise = null;
    throw error instanceof Error ? error : new Error('Falha ao carregar o Google Picker.');
  });

  return pickerScriptPromise;
}

function getStringField(
  value: Record<string, unknown>,
  directName: string,
  pickerFieldName?: string,
): string | undefined {
  const direct = value[directName];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  if (pickerFieldName) {
    const field = value[pickerFieldName];
    if (typeof field === 'string' && field.length > 0) return field;
  }
  return undefined;
}

/** Open the official Google Picker and return the selected PDF metadata. */
export async function showGooglePicker(
  token: string,
  apiKey: string,
  appId?: string,
): Promise<PickedGoogleFile | null> {
  if (!token) throw new Error('A autorização do Google expirou. Conecte sua conta novamente.');
  if (!apiKey) throw new Error('PUBLIC_GOOGLE_API_KEY não está configurada.');

  await loadGooglePickerScript();

  const pickerApi = window.google?.picker;
  if (!pickerApi) throw new Error('Google Picker indisponível após o carregamento.');

  return new Promise<PickedGoogleFile | null>((resolve, reject) => {
    let picker: ReturnType<InstanceType<typeof pickerApi.PickerBuilder>['build']> | null = null;
    let settled = false;

    const close = () => {
      if (!picker) return;
      try {
        picker.setVisible(false);
        picker.dispose?.();
      } catch {
        // The Picker may already have closed itself.
      }
      picker = null;
    };

    const finish = (result: PickedGoogleFile | null) => {
      if (settled) return;
      settled = true;
      close();
      resolve(result);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      close();
      reject(error);
    };

    try {
      const view = new pickerApi.DocsView(pickerApi.ViewId.DOCS)
        .setMimeTypes('application/pdf')
        .setIncludeFolders(false)
        .setSelectFolderEnabled(false);

      const builder = new pickerApi.PickerBuilder()
        .setDeveloperKey(apiKey)
        .setOAuthToken(token)
        .setOrigin(window.location.origin)
        .addView(view)
        .setCallback((response: PickerResponse) => {
          if (!response || settled) return;

          const responseObject = response as Record<string, unknown>;
          const responseKeys = pickerApi.Response;
          const action =
            getStringField(responseObject, 'action', responseKeys?.ACTION) ?? '';

          if (action === 'loaded' || action === pickerApi.Action.LOADED) return;

          if (action === pickerApi.Action.CANCEL || action === 'cancel') {
            finish(null);
            return;
          }

          if (action !== pickerApi.Action.PICKED && action !== 'picked') return;

          // The official API calls this Response.DOCUMENTS. Keep the literal
          // "docs" fallback for Picker versions that expose the JSON property directly.
          const documentKey = responseKeys?.DOCUMENTS ?? responseKeys?.DOCS ?? 'docs';
          const rawDocs = Array.isArray(response.docs)
            ? response.docs
            : Array.isArray(responseObject[documentKey])
              ? (responseObject[documentKey] as PickerDoc[])
              : Array.isArray(responseObject.docs)
                ? (responseObject.docs as PickerDoc[])
                : [];

          const first = rawDocs[0] as (PickerDoc & Record<string, unknown>) | undefined;
          if (!first) {
            fail(new Error('O Google Picker confirmou a seleção, mas não retornou um arquivo.'));
            return;
          }

          const documentKeys = pickerApi.Document;
          const id = getStringField(first, 'id', documentKeys?.ID);
          const name = getStringField(first, 'name', documentKeys?.NAME) ?? 'documento.pdf';
          const mimeType =
            getStringField(first, 'mimeType', documentKeys?.MIME_TYPE) ?? 'application/pdf';

          if (!id) {
            fail(new Error('O Google Picker não retornou o ID do arquivo selecionado.'));
            return;
          }

          if (mimeType !== 'application/pdf' && !name.toLowerCase().endsWith('.pdf')) {
            fail(new Error('Selecione um arquivo PDF do Google Drive.'));
            return;
          }

          finish({ id, name, mimeType: 'application/pdf' });
        });

      // appId must be the numeric Google Cloud project number, never a Client ID.
      if (appId) builder.setAppId(appId);

      picker = builder.build();
      picker.setVisible(true);
    } catch (error) {
      fail(error instanceof Error ? error : new Error('Não foi possível abrir o Google Picker.'));
    }
  });
}

export interface OpenGoogleDriveResult {
  file: File;
  openResult: OpenResult;
}

/**
 * End-to-end flow: OAuth -> Picker -> Drive REST download -> PDF validation ->
 * existing openFiles pipeline -> activate the created document tab.
 */
export async function openPdfFromGoogleDrive(): Promise<OpenGoogleDriveResult | null> {
  if (isOpeningDrive) return null;
  isOpeningDrive = true;

  const store = useEditorStore.getState();

  try {
    const { clientId, apiKey, appId } = getGoogleDriveConfig();
    if (!clientId || !apiKey) {
      throw new Error(
        'Configuração do Google Drive incompleta. Confira PUBLIC_GOOGLE_CLIENT_ID e PUBLIC_GOOGLE_API_KEY.',
      );
    }

    // Token OAuth is obtained before creating the Picker, as required by Google's sample.
    store.setBusy({ label: 'Autorizando Google Drive...', progress: null });
    let accessToken = await requestGoogleAccessToken(clientId);

    store.setBusy({ label: 'Abrindo seletor de arquivos...', progress: null });
    const picked = await showGooglePicker(accessToken, apiKey, appId);
    if (!picked) return null;

    store.setBusy({ label: `Baixando "${picked.name}" do Google Drive...`, progress: null });

    let blob: Blob;
    try {
      blob = await downloadGoogleDriveFile(picked.id, accessToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('(401)') && !message.includes('401')) throw error;

      accessToken = await requestGoogleAccessToken(clientId, true);
      blob = await downloadGoogleDriveFile(picked.id, accessToken);
    }

    if (blob.size === 0) throw new Error('O Google Drive retornou um arquivo vazio.');

    const fileName = picked.name.toLowerCase().endsWith('.pdf') ? picked.name : `${picked.name}.pdf`;
    const file = new File([blob], fileName, { type: 'application/pdf' });

    // Metadata is optional for opening, but retained for future save-to-source support.
    let modifiedTime: string | undefined;
    let version: string | undefined;
    try {
      const metadata = await getGoogleDriveFileMetadata(picked.id, accessToken);
      modifiedTime = metadata.modifiedTime;
      version = metadata.version;
    } catch {
      // A metadata lookup must not prevent opening a PDF whose bytes were downloaded successfully.
    }

    store.setBusy({ label: `Carregando "${fileName}" no editor...`, progress: null });
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

    if (openResult.openedFiles !== 1 || !openResult.openedDocumentIds?.[0]) {
      const detail = openResult.errors.map((item) => item.message).filter(Boolean).join('; ');
      throw new Error(detail || 'O PDF foi baixado, mas o editor não conseguiu registrar o documento.');
    }

    useEditorStore.getState().setActiveDocument(openResult.openedDocumentIds[0]);
    return { file, openResult };
  } catch (error) {
    throw error instanceof Error ? error : new Error('Não foi possível abrir o PDF do Google Drive.');
  } finally {
    useEditorStore.getState().setBusy(null);
    isOpeningDrive = false;
  }
}

export const openGoogleDrivePdf = openPdfFromGoogleDrive;

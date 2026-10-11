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
 * Opens Google Picker modal filtered strictly to PDF documents.
 */
export async function showGooglePicker(
  token: string,
  apiKey: string,
  appId?: string,
  clientId?: string,
): Promise<PickedGoogleFile | null> {
  await loadGooglePickerScript();

  return new Promise<PickedGoogleFile | null>((resolve, reject) => {
    let pickerInstance: { setVisible(visible: boolean): void; dispose?: () => void } | null = null;
    let isSettled = false;

    const closePicker = () => {
      if (pickerInstance) {
        try {
          pickerInstance.setVisible(false);
        } catch {
          // ignore
        }
        try {
          if (typeof pickerInstance.dispose === 'function') {
            pickerInstance.dispose();
          }
        } catch {
          // ignore
        }
      }
      // Limpeza de segurança para remover nós do DOM do Google Picker
      if (typeof document !== 'undefined') {
        const dialogs = document.querySelectorAll('.picker-dialog, .picker-dialog-bg');
        dialogs.forEach((el) => {
          try {
            (el as HTMLElement).style.display = 'none';
            el.remove();
          } catch {
            // ignore
          }
        });
      }
    };

    const handleSuccess = (result: PickedGoogleFile | null) => {
      if (isSettled) return;
      isSettled = true;
      closePicker();
      resolve(result);
    };

    const handleError = (error: Error) => {
      if (isSettled) return;
      isSettled = true;
      closePicker();
      reject(error);
    };

    try {
      const docsView = new window.google!.picker!.DocsView(window.google!.picker!.ViewId.DOCS)
        .setMimeTypes('application/pdf')
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false);

      const builder = new window.google!.picker!.PickerBuilder()
        .addView(docsView)
        .setOAuthToken(token)
        .setDeveloperKey(apiKey);

      // Define a origem explícita da janela para evitar criação de popups de autenticação secundários indesejados
      if (typeof window !== 'undefined' && window.location) {
        const origin = window.location.origin || `${window.location.protocol}//${window.location.host}`;
        if (typeof builder.setOrigin === 'function') {
          builder.setOrigin(origin);
        }
      }

      // Conecta o AppId/Project Number do Google Cloud se disponível
      const derivedAppId = clientId && clientId.includes('-') ? clientId.split('-')[0] : undefined;
      const effectiveAppId = appId || derivedAppId;
      if (effectiveAppId && typeof builder.setAppId === 'function') {
        builder.setAppId(effectiveAppId);
      }

      if (typeof builder.setTitle === 'function') {
        builder.setTitle('Selecione um arquivo PDF do Google Drive');
      }

      if (window.google?.picker?.Feature?.SUPPORT_DRIVES && typeof builder.enableFeature === 'function') {
        builder.enableFeature(window.google.picker.Feature.SUPPORT_DRIVES);
      }

      builder.setCallback((data: PickerResponse) => {
        if (!data || isSettled) return;

        const action =
          data.action ||
          (data as Record<string, unknown>)[window.google?.picker?.Response?.ACTION as string] ||
          (data as Record<string, unknown>)['action'];

        // Se for evento de carregamento da interface, não finaliza a Promise
        if (action === 'loaded' || action === window.google?.picker?.Action?.LOADED) {
          return;
        }

        if (action === window.google!.picker!.Action.PICKED || action === 'picked') {
          const docs =
            data.docs ||
            ((data as Record<string, unknown>)[window.google?.picker?.Response?.DOCS as string] as PickerDoc[]) ||
            ((data as Record<string, unknown>)['docs'] as PickerDoc[]);

          const firstDoc = docs?.[0];
          if (!firstDoc) {
            handleSuccess(null);
            return;
          }

          const fileId =
            firstDoc.id ||
            ((firstDoc as Record<string, unknown>)[window.google?.picker?.Document?.ID as string] as string) ||
            ((firstDoc as Record<string, unknown>)['id'] as string);

          const fileName =
            firstDoc.name ||
            ((firstDoc as Record<string, unknown>)[window.google?.picker?.Document?.NAME as string] as string) ||
            ((firstDoc as Record<string, unknown>)['name'] as string) ||
            'documento.pdf';

          const mimeType =
            firstDoc.mimeType ||
            ((firstDoc as Record<string, unknown>)[window.google?.picker?.Document?.MIME_TYPE as string] as string) ||
            ((firstDoc as Record<string, unknown>)['mimeType'] as string) ||
            'application/pdf';

          if (!fileId) {
            handleError(new Error('Nenhum identificador de arquivo recebido do Google Picker.'));
            return;
          }

          // Validação: confirmar que o arquivo selecionado é um PDF
          const isPdf =
            mimeType === 'application/pdf' ||
            fileName.toLowerCase().endsWith('.pdf');

          if (!isPdf) {
            handleError(
              new Error(
                `O arquivo "${fileName}" não é um documento PDF válido. Por favor, escolha um arquivo com extensão .pdf.`,
              ),
            );
            return;
          }

          handleSuccess({
            id: fileId,
            name: fileName,
            mimeType,
          });
        } else if (action === window.google!.picker!.Action.CANCEL || action === 'cancel') {
          handleSuccess(null);
        }
      });

      pickerInstance = builder.build();
      pickerInstance.setVisible(true);
    } catch (err) {
      handleError(err instanceof Error ? err : new Error('Erro ao inicializar o Google Picker.'));
    }
  });
}

export interface OpenGoogleDriveResult {
  file: File;
  openResult: OpenResult;
}

/**
 * Orchestrator: connects Google account if needed, shows Picker, downloads chosen PDF directly,
 * validates content, and opens it into the current editor without navigating or opening secondary windows.
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

    // 1. Obter token de acesso OAuth2
    const token = await requestGoogleAccessToken(clientId);

    // 2. Abrir Google Picker diretamente no site
    const picked = await showGooglePicker(token, apiKey, appId, clientId);
    if (!picked) {
      // Usuário cancelou no Picker
      return null;
    }

    // 3. Exibir loading na interface durante o download
    useEditorStore.getState().setBusy({
      label: `Baixando "${picked.name}" do Google Drive...`,
      progress: null,
    });

    // 4. Baixar arquivo do Google Drive diretamente via API v3
    let blob: Blob;
    try {
      blob = await downloadGoogleDriveFile(picked.id, token);
    } catch (downloadErr) {
      // Se o token expirou (401), tenta reautenticar uma vez e repetir o download
      const errMsg = downloadErr instanceof Error ? downloadErr.message : '';
      if (errMsg.includes('401') || errMsg.includes('expirada')) {
        const freshToken = await requestGoogleAccessToken(clientId, true);
        blob = await downloadGoogleDriveFile(picked.id, freshToken);
      } else {
        throw downloadErr;
      }
    }

    const fileName = picked.name.toLowerCase().endsWith('.pdf') ? picked.name : `${picked.name}.pdf`;
    const file = new File([blob], fileName, { type: 'application/pdf' });

    // 5. Obter metadados de modificação caso disponível
    let modifiedTime: string | undefined;
    let version: string | undefined;
    try {
      const { getGoogleDriveFileMetadata } = await import('./google-drive');
      const meta = await getGoogleDriveFileMetadata(picked.id, token);
      modifiedTime = meta.modifiedTime;
      version = meta.version;
    } catch {
      // Falha não fatal na obtenção de metadados opcionais
    }

    // 6. Abrir no editor reutilizando openFiles()
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

    // 7. Ativar a aba do documento recém-aberto
    const firstDocId = openResult.openedDocumentIds?.[0];
    if (firstDocId) {
      useEditorStore.getState().setActiveDocument(firstDocId);
    }

    return { file, openResult };
  } finally {
    useEditorStore.getState().setBusy(null);
    isOpeningDrive = false;
  }
}

// Alias for convenience
export const openGoogleDrivePdf = openPdfFromGoogleDrive;


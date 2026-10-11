/**
 * Shared type definitions for Google Identity Services, Google Picker API, and Google Drive.
 */

export interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

export interface PickerDoc {
  id: string;
  name: string;
  mimeType: string;
  url?: string;
  sizeBytes?: number;
  lastEditedUtc?: number;
  version?: string;
  modifiedTime?: string;
  [key: string]: unknown;
}

export interface PickerResponse {
  action: string;
  docs?: PickerDoc[];
  [key: string]: unknown;
}

export interface PickerBuilderInstance {
  addView(view: unknown): PickerBuilderInstance;
  setOAuthToken(token: string): PickerBuilderInstance;
  setDeveloperKey(key: string): PickerBuilderInstance;
  setAppId(appId: string): PickerBuilderInstance;
  setOrigin(origin: string): PickerBuilderInstance;
  setTitle(title: string): PickerBuilderInstance;
  setSize(width: number, height: number): PickerBuilderInstance;
  enableFeature(feature: string | number): PickerBuilderInstance;
  setCallback(callback: (data: PickerResponse) => void): PickerBuilderInstance;
  build(): {
    setVisible(visible: boolean): void;
    dispose?(): void;
    isVisible?(): boolean;
  };
}

export interface DocsViewInstance {
  setMimeTypes(mimeTypes: string): DocsViewInstance;
  setIncludeFolders(include: boolean): DocsViewInstance;
  setSelectFolderEnabled(enabled: boolean): DocsViewInstance;
  setMode(mode: string): DocsViewInstance;
  setParent?(parent: string): DocsViewInstance;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: unknown) => void;
          }): {
            requestAccessToken(overrideConfig?: { prompt?: string }): void;
          };
          revoke(token: string, callback?: () => void): void;
        };
      };
      picker?: {
        PickerBuilder: new () => PickerBuilderInstance;
        DocsView: new (viewId?: string) => DocsViewInstance;
        ViewId: {
          DOCS: string;
          ALL?: string;
        };
        DocsViewMode: {
          LIST: string;
          GRID: string;
        };
        Action: {
          PICKED: string;
          CANCEL: string;
          LOADED?: string;
        };
        Feature?: {
          SUPPORT_DRIVES?: string | number;
          NAV_HIDDEN?: string | number;
          MULTISELECT_ENABLED?: string | number;
        };
        Document?: {
          ID: string;
          NAME: string;
          MIME_TYPE: string;
          URL: string;
        };
        Response?: {
          ACTION: string;
          DOCS: string;
        };
      };
    };
    gapi?: {
      load(api: string, callbacks: { callback: () => void; onerror?: () => void }): void;
    };
  }
}


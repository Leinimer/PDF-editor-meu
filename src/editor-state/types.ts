/**
 * Editor-level domain models: everything the store holds beyond the pure
 * pdf-core types.
 */

import type {
  Annotation,
  AnnotationId,
  ImageAsset,
  PageId,
  PageRef,
  SourceId,
  SourcePageInfo,
} from '../pdf-core/types';

export type DocumentId = string;

export interface GoogleDriveMeta {
  fileId: string;
  name: string;
  modifiedTime?: string | undefined;
  version?: string | undefined;
  mimeType?: string | undefined;
}

/** A loaded source PDF kept in memory for rendering and export. */
export interface SourceEntry {
  id: SourceId;
  name: string;
  bytes: Uint8Array;
  pageCount: number;
  pageInfos: SourcePageInfo[];
  /**
   * Where this source came from. Blank sheets created by the editor are
   * 'blank' — they never claim the document name and stay out of recents.
   */
  origin?: 'file' | 'blank' | 'google-drive' | undefined;
  /** Google Drive metadata when opened from Drive. */
  googleDrive?: GoogleDriveMeta | undefined;
}

/** The undoable part of one document's state. Immutable snapshots. */
export interface DocSnapshot {
  pages: PageRef[];
  annotations: Record<AnnotationId, Annotation>;
}

export const EMPTY_DOC: DocSnapshot = { pages: [], annotations: {} };

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * One open document (a tab): its pages/annotations, per-document undo/redo
 * history, selection, and naming. Several documents can be open at once and
 * share the global source pool (split results reference the same sources as
 * the document they came from).
 */
export interface DocumentState {
  id: DocumentId;
  doc: DocSnapshot;
  past: DocSnapshot[];
  future: DocSnapshot[];
  selection: PageId[];
  /** Anchor for shift-click range selection. */
  selectionAnchor: PageId | null;
  activePageId: PageId | null;
  activeAnnotationId: AnnotationId | null;
  /** Base name for export files. */
  docName: string;
  /** True once a real file has claimed the document name. */
  docNameClaimed: boolean;
  /** Google Drive metadata when this document originated from Google Drive. */
  googleDrive?: GoogleDriveMeta | undefined;
  /** Status of the save operation for this tab. */
  saveStatus?: SaveStatus | undefined;
  /** The snapshot history length at the time the document was last saved. */
  savedPastLength?: number | undefined;
}

/** A document closed during this session, restorable without re-picking the file. */
export interface RecentDoc {
  id: string;
  name: string;
  pageCount: number;
  bytes: Uint8Array;
  closedAt: number;
}

export type Tool =
  | 'select'
  | 'edit-text'
  | 'remove-object'
  | 'text'
  | 'richtext'
  | 'ink'
  | 'highlight'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'image';

export interface BusyState {
  label: string;
  /** 0..1, or null for indeterminate. */
  progress: number | null;
}

export interface EditorSnapshot {
  documents: Record<DocumentId, DocumentState>;
  /** Tab order. */
  documentOrder: DocumentId[];
  activeDocumentId: DocumentId | null;
  /** Source PDFs, shared across documents (split tabs reuse them). */
  sources: Record<SourceId, SourceEntry>;
  assets: Record<string, ImageAsset>;
  tool: Tool;
  recents: RecentDoc[];
  busy: BusyState | null;
  showLeftSidebar: boolean;
  showRightSidebar: boolean;
}

/**
 * Command toolbar: file actions, undo/redo, annotation tools, page
 * operations, and exports.
 */

import { useRef, useState, type JSX } from 'react';
import {
  selectActiveDocument,
  selectCanRedo,
  selectCanUndo,
  useEditorStore,
} from '../../editor-state/store';
import type { Tool } from '../../editor-state/types';
import { addBlankPage } from '../../services/new-document';
import { openFiles, reopenRecent } from '../../services/open-files';
import { placeImageFromFile } from '../../services/place-image';
import {
  buildDocumentPdfBytes,
  exportDocument,
  exportPagesAsZip,
  exportSelection,
  printDocument,
} from '../../services/export-service';
import { useToasts } from '../toast/Toasts';
import { useActiveDoc } from '../hooks/useActiveDoc';
import { THEME_LABELS, useTheme } from '../hooks/useTheme';
import { Icon, type IconName } from '../icons';
import {
  disconnectGoogleAccount,
  getGoogleDriveFileMetadata,
  hasGoogleAuth,
  requestGoogleAccessToken,
  updateGoogleDriveFile,
} from '../../services/google-drive';
import { openPdfFromGoogleDrive } from '../../services/google-picker';
import { downloadPdf, safeBaseName } from '../../export/download';

export interface ToolbarProps {
  onSplit(): void;
  onInsert(): void;
  onSignature(): void;
  onClear(): void;
  onShortcuts(): void;
}

const TOOLS: { tool: Tool; icon: IconName; label: string; key: string }[] = [
  { tool: 'select', icon: 'cursor', label: 'Select', key: 'V' },
  { tool: 'edit-text', icon: 'editText', label: 'Edit text', key: 'E' },
  { tool: 'remove-object', icon: 'removeObject', label: 'Remove object', key: 'X' },
  { tool: 'text', icon: 'text', label: 'Text', key: 'T' },
  { tool: 'richtext', icon: 'richText', label: 'Rich text', key: 'B' },
  { tool: 'ink', icon: 'pen', label: 'Draw', key: 'P' },
  { tool: 'highlight', icon: 'highlighter', label: 'Highlight', key: 'H' },
  { tool: 'rectangle', icon: 'square', label: 'Rectangle', key: 'R' },
  { tool: 'ellipse', icon: 'circle', label: 'Ellipse', key: 'O' },
  { tool: 'line', icon: 'line', label: 'Line', key: 'L' },
  { tool: 'arrow', icon: 'arrow', label: 'Arrow', key: 'A' },
];

export function Toolbar({
  onSplit,
  onInsert,
  onSignature,
  onClear,
  onShortcuts,
}: ToolbarProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openFileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const toasts = useToasts();
  const { theme, cycleTheme } = useTheme();

  const tool = useEditorStore((state) => state.tool);
  const setTool = useEditorStore((state) => state.setTool);
  const recents = useEditorStore((state) => state.recents);
  const removeRecent = useEditorStore((state) => state.removeRecent);
  const selectionCount = useActiveDoc((docState) => docState.selection.length) ?? 0;
  const pageCount = useActiveDoc((docState) => docState.doc.pages.length) ?? 0;
  const busy = useEditorStore((state) => state.busy);
  const canUndo = useEditorStore(selectCanUndo);
  const canRedo = useEditorStore(selectCanRedo);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const rotateSelectedPages = useEditorStore((state) => state.rotateSelectedPages);
  const duplicatePages = useEditorStore((state) => state.duplicatePages);
  const deletePages = useEditorStore((state) => state.deletePages);
  const activePageId = useActiveDoc((docState) => docState.activePageId) ?? null;

  const hasSelectionOrActive = selectionCount > 0 || activePageId !== null;
  const deletable = selectionCount > 0 && selectionCount < pageCount;
  const exporting = busy !== null;

  const run = (work: () => Promise<void>, successMessage?: string): void => {
    void work()
      .then(() => successMessage && toasts.push('success', successMessage))
      .catch((error: unknown) =>
        toasts.push('error', error instanceof Error ? error.message : 'Something went wrong.'),
      );
  };

  const handleOpenFromComputer = () => {
    setOpenMenuOpen(false);
    openFileInputRef.current?.click();
  };

  const handleOpenFromGoogleDrive = async () => {
    setOpenMenuOpen(false);
    try {
      const outcome = await openPdfFromGoogleDrive();
      if (!outcome) return;
      for (const failure of outcome.openResult.errors) {
        toasts.push('error', `${failure.name}: ${failure.message}`);
      }
      if (outcome.openResult.openedFiles > 0) {
        toasts.push('success', `Documento "${outcome.file.name}" aberto com sucesso.`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro ao abrir arquivo do Google Drive.';
      toasts.push('error', msg);
    }
  };

  const handleConnectGoogle = async () => {
    setOpenMenuOpen(false);
    try {
      await requestGoogleAccessToken();
      toasts.push('success', 'Conta Google autorizada com sucesso.');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Falha na autorização do Google.';
      toasts.push('error', msg);
    }
  };

  const showLeftSidebar = useEditorStore((state) => state.showLeftSidebar);
  const toggleLeftSidebar = useEditorStore((state) => state.toggleLeftSidebar);
  const showRightSidebar = useEditorStore((state) => state.showRightSidebar);
  const setShowRightSidebar = useEditorStore((state) => state.setShowRightSidebar);

  const activeAnnotation = useActiveDoc((docState) =>
    docState.activeAnnotationId ? docState.doc.annotations[docState.activeAnnotationId] : undefined,
  );
  const updateAnnotation = useEditorStore((state) => state.updateAnnotation);

  const textColorInputRef = useRef<HTMLInputElement>(null);
  const highlightColorInputRef = useRef<HTMLInputElement>(null);

  // Formatting state for active text/rich-text/text-edit or default values
  const isTextAnnotation =
    activeAnnotation &&
    (activeAnnotation.kind === 'text' ||
      activeAnnotation.kind === 'rich-text' ||
      activeAnnotation.kind === 'text-edit');

  const currentFontSize =
    isTextAnnotation && 'fontSize' in activeAnnotation ? activeAnnotation.fontSize : 16;
  const currentTextColor =
    isTextAnnotation && 'color' in activeAnnotation ? activeAnnotation.color : '#1a2030';

  // Rich text span mark checking if activeAnnotation is rich-text
  const isBold =
    activeAnnotation?.kind === 'rich-text'
      ? activeAnnotation.blocks.some((b) => b.spans.some((s) => s.bold))
      : false;
  const isItalic =
    activeAnnotation?.kind === 'rich-text'
      ? activeAnnotation.blocks.some((b) => b.spans.some((s) => s.italic))
      : false;
  const isUnderline =
    activeAnnotation?.kind === 'rich-text'
      ? activeAnnotation.blocks.some((b) => b.spans.some((s) => s.underline))
      : false;
  const isStrike =
    activeAnnotation?.kind === 'rich-text'
      ? activeAnnotation.blocks.some((b) => b.spans.some((s) => s.strike))
      : false;

  const toggleRichTextMark = (mark: 'bold' | 'italic' | 'underline' | 'strike') => {
    if (!activeAnnotation || activeAnnotation.kind !== 'rich-text') return;
    const currentlyActive = activeAnnotation.blocks.some((b) => b.spans.some((s) => s[mark]));
    const newBlocks = activeAnnotation.blocks.map((b) => ({
      spans: b.spans.map((s) => ({
        ...s,
        [mark]: !currentlyActive ? true : undefined,
      })),
    }));
    updateAnnotation(activeAnnotation.id, { blocks: newBlocks });
  };

  const clearFormatting = () => {
    if (!activeAnnotation || activeAnnotation.kind !== 'rich-text') return;
    const newBlocks = activeAnnotation.blocks.map((b) => ({
      spans: b.spans.map((s) => ({
        text: s.text,
      })),
    }));
    updateAnnotation(activeAnnotation.id, { blocks: newBlocks });
  };

  const changeFontSize = (delta: number) => {
    if (!activeAnnotation || !('fontSize' in activeAnnotation)) return;
    const newSize = Math.min(Math.max((activeAnnotation.fontSize || 16) + delta, 6), 96);
    updateAnnotation(activeAnnotation.id, { fontSize: newSize });
  };

  const setParagraphStyle = (style: string) => {
    if (!activeAnnotation || !('fontSize' in activeAnnotation)) return;
    let newSize = 16;
    if (style === 'h1') newSize = 28;
    else if (style === 'h2') newSize = 22;
    else if (style === 'h3') newSize = 18;
    else if (style === 'body') newSize = 16;
    else if (style === 'caption') newSize = 12;
    updateAnnotation(activeAnnotation.id, { fontSize: newSize });
  };

  const setTextColor = (color: string) => {
    if (activeAnnotation && 'color' in activeAnnotation) {
      updateAnnotation(activeAnnotation.id, { color });
    }
  };

  const activeDocState = useActiveDoc((doc) => doc);
  const sources = useEditorStore((state) => state.sources);
  const setDocumentSaveStatus = useEditorStore((state) => state.setDocumentSaveStatus);
  const markDocumentSaved = useEditorStore((state) => state.markDocumentSaved);

  const saveStatus = activeDocState?.saveStatus ?? 'idle';
  const hasUnsavedChanges =
    activeDocState &&
    (activeDocState.savedPastLength === undefined
      ? activeDocState.past.length > 0
      : activeDocState.past.length !== activeDocState.savedPastLength);

  const handleSave = async () => {
    if (!activeDocState || activeDocState.doc.pages.length === 0 || saveStatus === 'saving') {
      return;
    }

    const docId = activeDocState.id;
    setDocumentSaveStatus(docId, 'saving');

    try {
      // 1. Identify source files contributing pages
      const referencedSourceIds = new Set<string>();
      for (const p of activeDocState.doc.pages) {
        referencedSourceIds.add(p.sourceId);
      }

      const driveSources = [...referencedSourceIds]
        .map((sId) => sources[sId])
        .filter((s): s is NonNullable<typeof s> => Boolean(s?.googleDrive?.fileId));

      // 2. Check if this document can be saved to Google Drive
      if (driveSources.length === 1 && (activeDocState.googleDrive || driveSources[0]?.googleDrive)) {
        const driveMeta = activeDocState.googleDrive || driveSources[0]!.googleDrive!;

        // Check for conflicts: fetch current remote metadata if modifiedTime is tracked
        const token = await requestGoogleAccessToken();

        if (driveMeta.modifiedTime) {
          try {
            const remoteMeta = await getGoogleDriveFileMetadata(driveMeta.fileId, token);
            if (remoteMeta.modifiedTime && remoteMeta.modifiedTime !== driveMeta.modifiedTime) {
              const proceed = window.confirm(
                `O arquivo "${driveMeta.name}" foi modificado no Google Drive por outra sessão desde que foi aberto.\n\nDeseja sobrescrever com suas alterações locais?`,
              );
              if (!proceed) {
                // Allow user to download a copy instead
                const pdfBytes = await buildDocumentPdfBytes(activeDocState);
                downloadPdf(pdfBytes, `${safeBaseName(activeDocState.docName)}_copia.pdf`);
                setDocumentSaveStatus(docId, 'idle');
                toasts.push('info', 'Salvamento no Drive cancelado; cópia baixada localmente.');
                return;
              }
            }
          } catch (metaErr) {
            console.warn('Não foi possível verificar versão remota:', metaErr);
          }
        }

        // Assemble full document with all pages, annotations and rotations
        const pdfBytes = await buildDocumentPdfBytes(activeDocState);

        // Upload to Drive files.update
        const updated = await updateGoogleDriveFile(driveMeta.fileId, token, pdfBytes);

        markDocumentSaved(docId, {
          fileId: driveMeta.fileId,
          name: updated.name || driveMeta.name,
          modifiedTime: updated.modifiedTime,
          version: updated.version,
        });

        toasts.push('success', `Arquivo "${driveMeta.name}" salvo no Google Drive com sucesso!`);
      } else if (driveSources.length > 1) {
        // Document has pages from multiple Google Drive files!
        const proceed = window.confirm(
          'Este documento é composto por páginas de múltiplos arquivos do Google Drive. Deseja baixar o resultado como um novo arquivo PDF em vez de sobrescrever um deles?',
        );
        const pdfBytes = await buildDocumentPdfBytes(activeDocState);
        downloadPdf(pdfBytes, `${safeBaseName(activeDocState.docName)}.pdf`);
        markDocumentSaved(docId);
        toasts.push(
          'info',
          proceed
            ? 'PDF composto salvo via download.'
            : 'PDF baixado para preservar os arquivos originais.',
        );
      } else {
        // Local file or blank document
        const pdfBytes = await buildDocumentPdfBytes(activeDocState);
        downloadPdf(pdfBytes, `${safeBaseName(activeDocState.docName)}.pdf`);
        markDocumentSaved(docId);
        toasts.push('success', 'Documento baixado localmente.');
      }
    } catch (error) {
      setDocumentSaveStatus(docId, 'error');
      const msg = error instanceof Error ? error.message : 'Falha ao salvar documento.';
      toasts.push('error', msg);
    }
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="Editor commands">
      {/* 1. Toggle Sidebar Esquerda (extremo esquerdo) */}
      <button
        type="button"
        className={`icon-button ${showLeftSidebar ? 'is-on' : ''}`}
        aria-label={showLeftSidebar ? 'Ocultar miniaturas' : 'Mostrar miniaturas'}
        title={showLeftSidebar ? 'Ocultar miniaturas' : 'Mostrar miniaturas'}
        onClick={toggleLeftSidebar}
      >
        <Icon name="panelLeft" />
      </button>

      {/* Main visible actions: Open PDF, Undo, Redo, Print, Configure PDF */}
      <div className="toolbar-group" aria-label="Main commands">
        {/* Open PDF button with dropdown */}
        <div className="menu-anchor">
          <button
            type="button"
            className={`icon-button ${openMenuOpen ? 'is-on' : ''}`}
            aria-label="Abrir PDF"
            title="Abrir PDF"
            aria-haspopup="menu"
            aria-expanded={openMenuOpen}
            onClick={() => setOpenMenuOpen((current) => !current)}
          >
            <Icon name="fileOpen" />
          </button>

          {openMenuOpen && (
            <>
              <button
                type="button"
                className="menu-backdrop"
                aria-label="Fechar menu"
                tabIndex={-1}
                onClick={() => setOpenMenuOpen(false)}
              />
              <div role="menu" aria-label="Abrir PDF" className="menu-popover" style={{ minWidth: '14rem' }}>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={handleOpenFromComputer}
                >
                  <Icon name="computer" size={16} />
                  <span>Do computador</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={handleOpenFromGoogleDrive}
                >
                  <Icon name="googleDrive" size={16} />
                  <span>Google Drive</span>
                </button>
                <div style={{ height: 1, background: 'var(--border)', margin: '0.2rem 0' }} />
                {hasGoogleAuth() ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item is-danger"
                    onClick={() => {
                      setOpenMenuOpen(false);
                      disconnectGoogleAccount();
                      toasts.push('success', 'Conta Google desconectada da sessão.');
                    }}
                  >
                    <Icon name="close" size={14} />
                    <span>Desconectar Google</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={handleConnectGoogle}
                  >
                    <Icon name="lock" size={14} />
                    <span>Conectar conta Google</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          className="icon-button"
          aria-label="Undo"
          title="Undo (Ctrl/⌘+Z)"
          disabled={!canUndo}
          onClick={undo}
        >
          <Icon name="undo" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Redo"
          title="Redo (Shift+Ctrl/⌘+Z)"
          disabled={!canRedo}
          onClick={redo}
        >
          <Icon name="redo" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Print document"
          title="Print document (Ctrl/⌘+P)"
          disabled={pageCount === 0 || exporting}
          onClick={() => run(printDocument)}
        >
          <Icon name="printer" />
        </button>

        {/* Configure PDF button (page with gear icon, no text) */}
        <div className="menu-anchor">
          <button
            type="button"
            className={`icon-button ${menuOpen ? 'is-on' : ''}`}
            aria-label="PDF Tools & Settings"
            title="PDF Tools & Settings"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <Icon name="pageGear" />
          </button>

          {menuOpen && (
            <>
              <button
                type="button"
                className="menu-backdrop"
                aria-label="Close menu"
                tabIndex={-1}
                onClick={() => setMenuOpen(false)}
              />
              <div role="menu" aria-label="PDF Tools" className="pdf-tools-popover">
                {/* SECTION 1: Annotation & Drawing */}
                <div className="pdf-tools-section">
                  <div className="pdf-tools-section-title">Annotation & Drawing</div>
                  <div className="pdf-tools-grid">
                    {TOOLS.map((entry) => (
                      <button
                        key={entry.tool}
                        type="button"
                        role="menuitem"
                        className={`pdf-tool-item ${tool === entry.tool ? 'is-active' : ''}`}
                        title={`${entry.label} (${entry.key})`}
                        onClick={() => {
                          setTool(entry.tool);
                          setMenuOpen(false);
                        }}
                      >
                        <Icon name={entry.icon} size={16} />
                        <span className="pdf-tool-name">{entry.label}</span>
                        <kbd className="pdf-tool-key">{entry.key}</kbd>
                      </button>
                    ))}
                    <button
                      type="button"
                      role="menuitem"
                      className="pdf-tool-item"
                      title="Place image or stamp"
                      onClick={() => {
                        setMenuOpen(false);
                        imageInputRef.current?.click();
                      }}
                    >
                      <Icon name="image" size={16} />
                      <span className="pdf-tool-name">Place image</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="pdf-tool-item"
                      title="Add signature"
                      onClick={() => {
                        setMenuOpen(false);
                        onSignature();
                      }}
                    >
                      <Icon name="signature" size={16} />
                      <span className="pdf-tool-name">Signature</span>
                    </button>
                  </div>
                </div>

                {/* SECTION 2: Document & Pages */}
                <div className="pdf-tools-section">
                  <div className="pdf-tools-section-title">Document & Pages</div>
                  <div className="pdf-tools-grid">
                    <button
                      type="button"
                      role="menuitem"
                      className="pdf-tool-item"
                      title="Merge a PDF's pages into this document"
                      onClick={() => {
                        setMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                    >
                      <Icon name="filePlus" size={16} />
                      <span className="pdf-tool-name">Merge PDF</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      className="pdf-tool-item"
                      title="Insert an empty A4 page after the current page"
                      onClick={() => {
                        setMenuOpen(false);
                        const docState = selectActiveDocument(useEditorStore.getState());
                        const activeIndex =
                          docState?.doc.pages.findIndex((page) => page.id === docState.activePageId) ?? -1;
                        run(
                          () => addBlankPage(activeIndex >= 0 ? { insertAt: activeIndex + 1 } : undefined),
                          'Blank page added.',
                        );
                      }}
                    >
                      <Icon name="blankPage" size={16} />
                      <span className="pdf-tool-name">Blank page</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      className="pdf-tool-item"
                      disabled={pageCount === 0}
                      title="Insert pages from another PDF"
                      onClick={() => {
                        setMenuOpen(false);
                        onInsert();
                      }}
                    >
                      <Icon name="split" size={16} />
                      <span className="pdf-tool-name">Insert…</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      className="pdf-tool-item"
                      disabled={!hasSelectionOrActive}
                      title="Rotate left ([)"
                      onClick={() => {
                        rotateSelectedPages(-90);
                      }}
                    >
                      <Icon name="rotateLeft" size={16} />
                      <span className="pdf-tool-name">Rotate left</span>
                      <kbd className="pdf-tool-key">[</kbd>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      className="pdf-tool-item"
                      disabled={!hasSelectionOrActive}
                      title="Rotate right (])"
                      onClick={() => {
                        rotateSelectedPages(90);
                      }}
                    >
                      <Icon name="rotateRight" size={16} />
                      <span className="pdf-tool-name">Rotate right</span>
                      <kbd className="pdf-tool-key">]</kbd>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      className="pdf-tool-item"
                      disabled={selectionCount === 0}
                      title="Duplicate pages (Ctrl/⌘+D)"
                      onClick={() => {
                        setMenuOpen(false);
                        const docState = selectActiveDocument(useEditorStore.getState());
                        if (docState) duplicatePages(docState.selection);
                      }}
                    >
                      <Icon name="duplicate" size={16} />
                      <span className="pdf-tool-name">Duplicate</span>
                      <kbd className="pdf-tool-key">⌘D</kbd>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      className="pdf-tool-item is-danger"
                      disabled={!deletable}
                      title={
                        selectionCount > 0 && !deletable
                          ? 'Cannot delete every page'
                          : 'Delete pages (Del)'
                      }
                      onClick={() => {
                        setMenuOpen(false);
                        const docState = selectActiveDocument(useEditorStore.getState());
                        if (docState) deletePages(docState.selection);
                      }}
                    >
                      <Icon name="trash" size={16} />
                      <span className="pdf-tool-name">Delete pages</span>
                      <kbd className="pdf-tool-key">Del</kbd>
                    </button>
                  </div>
                </div>

                {/* SECTION 3: Export */}
                <div className="pdf-tools-section">
                  <div className="pdf-tools-section-title">Export</div>
                  <div className="pdf-tools-grid">
                    <button
                      type="button"
                      role="menuitem"
                      className="pdf-tool-item is-primary"
                      disabled={pageCount === 0 || exporting}
                      title="Download the whole edited document — all pages"
                      onClick={() => {
                        setMenuOpen(false);
                        run(exportDocument, 'PDF download started.');
                      }}
                    >
                      <Icon name="download" size={16} />
                      <span className="pdf-tool-name">Export PDF</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      className="pdf-tool-item"
                      disabled={selectionCount === 0 || exporting}
                      title="Download only the selected pages as one PDF"
                      onClick={() => {
                        setMenuOpen(false);
                        run(exportSelection, 'PDF download started.');
                      }}
                    >
                      <Icon name="scissors" size={16} />
                      <span className="pdf-tool-name">
                        Export selection{selectionCount > 0 ? ` (${selectionCount})` : ''}
                      </span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      className="pdf-tool-item"
                      disabled={pageCount === 0 || exporting}
                      title="Split by page ranges into new document tabs"
                      onClick={() => {
                        setMenuOpen(false);
                        onSplit();
                      }}
                    >
                      <Icon name="split" size={16} />
                      <span className="pdf-tool-name">Split…</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      className="pdf-tool-item"
                      disabled={pageCount === 0 || exporting}
                      title="Every page of this document as its own PDF, packed into a ZIP"
                      onClick={() => {
                        setMenuOpen(false);
                        run(exportPagesAsZip, 'ZIP download started.');
                      }}
                    >
                      <Icon name="zip" size={16} />
                      <span className="pdf-tool-name">ZIP</span>
                    </button>
                  </div>
                </div>

                {/* SECTION 4: Recents (if any) */}
                {recents.length > 0 && (
                  <div className="pdf-tools-section">
                    <div className="pdf-tools-section-title">Recent Documents</div>
                    {recents.map((recent) => (
                      <div key={recent.id} className="menu-item-row">
                        <button
                          type="button"
                          role="menuitem"
                          className="menu-item"
                          onClick={() => {
                            setMenuOpen(false);
                            void reopenRecent(recent)
                              .then(() => toasts.push('success', `Reopened ${recent.name}.`))
                              .catch((error: unknown) =>
                                toasts.push(
                                  'error',
                                  error instanceof Error
                                    ? error.message
                                    : 'Could not reopen this document.',
                                ),
                              );
                          }}
                        >
                          <Icon name="clock" size={15} />
                          <span className="recent-name">{recent.name}</span>
                          <span className="muted small">
                            {recent.pageCount} page{recent.pageCount === 1 ? '' : 's'}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Forget ${recent.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRecent(recent.id);
                          }}
                        >
                          <Icon name="close" size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* SECTION 4.5: Panels & View Settings */}
                <div className="pdf-tools-section">
                  <div className="pdf-tools-section-title">Painéis & Exibição</div>
                  <div style={{ padding: '0.3rem 0.5rem' }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.55rem',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={showRightSidebar}
                        onChange={(e) => setShowRightSidebar(e.target.checked)}
                        style={{ cursor: 'pointer', width: '1rem', height: '1rem' }}
                      />
                      <span>Mostrar painel de informações</span>
                    </label>
                  </div>
                </div>

                {/* SECTION 5: More / Utilities */}
                <div className="pdf-tools-section">
                  <div className="pdf-tools-section-title">More</div>
                  <div className="pdf-tools-grid">
                    <button
                      type="button"
                      role="menuitem"
                      className="pdf-tool-item"
                      title="Keyboard shortcuts (?)"
                      onClick={() => {
                        setMenuOpen(false);
                        onShortcuts();
                      }}
                    >
                      <Icon name="question" size={16} />
                      <span className="pdf-tool-name">Shortcuts</span>
                      <kbd className="pdf-tool-key">?</kbd>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      className="pdf-tool-item is-danger"
                      title="Close document"
                      onClick={() => {
                        setMenuOpen(false);
                        onClear();
                      }}
                    >
                      <Icon name="broom" size={16} />
                      <span className="pdf-tool-name">Close document</span>
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 3. Text Formatting Controls (Image order 1-13) */}
      <div className="toolbar-group" aria-label="Formatação de texto">
        {/* 1. Negrito */}
        <button
          type="button"
          className={`icon-button ${isBold ? 'is-on' : ''}`}
          aria-label="Negrito"
          title="Negrito (Ctrl+B)"
          disabled={!activeAnnotation || activeAnnotation.kind !== 'rich-text'}
          onClick={() => toggleRichTextMark('bold')}
        >
          <Icon name="formatBold" />
        </button>

        {/* 2. Itálico */}
        <button
          type="button"
          className={`icon-button ${isItalic ? 'is-on' : ''}`}
          aria-label="Itálico"
          title="Itálico (Ctrl+I)"
          disabled={!activeAnnotation || activeAnnotation.kind !== 'rich-text'}
          onClick={() => toggleRichTextMark('italic')}
        >
          <Icon name="formatItalic" />
        </button>

        {/* 3. Sublinhado */}
        <button
          type="button"
          className={`icon-button ${isUnderline ? 'is-on' : ''}`}
          aria-label="Sublinhado"
          title="Sublinhado (Ctrl+U)"
          disabled={!activeAnnotation || activeAnnotation.kind !== 'rich-text'}
          onClick={() => toggleRichTextMark('underline')}
        >
          <Icon name="formatUnderline" />
        </button>

        {/* 4. Tachado */}
        <button
          type="button"
          className={`icon-button ${isStrike ? 'is-on' : ''}`}
          aria-label="Tachado"
          title="Tachado"
          disabled={!activeAnnotation || activeAnnotation.kind !== 'rich-text'}
          onClick={() => toggleRichTextMark('strike')}
        >
          <Icon name="formatStrike" />
        </button>

        {/* 5. Estilo de parágrafo com padrão 'Corpo' */}
        <select
          className="toolbar-select"
          aria-label="Estilo de parágrafo"
          title="Estilo de parágrafo"
          disabled={!activeAnnotation || !('fontSize' in activeAnnotation)}
          value={
            currentFontSize >= 26
              ? 'h1'
              : currentFontSize >= 21
                ? 'h2'
                : currentFontSize >= 18
                  ? 'h3'
                  : currentFontSize <= 13
                    ? 'caption'
                    : 'body'
          }
          onChange={(e) => setParagraphStyle(e.target.value)}
        >
          <option value="body">Corpo</option>
          <option value="h1">Título 1</option>
          <option value="h2">Título 2</option>
          <option value="h3">Título 3</option>
          <option value="caption">Legenda</option>
        </select>

        {/* 6. Diminuir tamanho da fonte */}
        <button
          type="button"
          className="icon-button"
          aria-label="Diminuir tamanho da fonte"
          title="Diminuir tamanho da fonte"
          disabled={!activeAnnotation || !('fontSize' in activeAnnotation) || currentFontSize <= 6}
          onClick={() => changeFontSize(-2)}
        >
          <Icon name="minus" />
        </button>

        {/* 7. Aumentar tamanho da fonte */}
        <button
          type="button"
          className="icon-button"
          aria-label="Aumentar tamanho da fonte"
          title="Aumentar tamanho da fonte"
          disabled={!activeAnnotation || !('fontSize' in activeAnnotation) || currentFontSize >= 96}
          onClick={() => changeFontSize(2)}
        >
          <Icon name="plus" />
        </button>

        {/* 8. Cor do texto com seletor */}
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            type="button"
            className="toolbar-color-btn"
            aria-label="Cor do texto"
            title="Cor do texto"
            disabled={!activeAnnotation || !('color' in activeAnnotation)}
            onClick={() => textColorInputRef.current?.click()}
          >
            <span style={{ fontWeight: 'bold', fontSize: '1rem', lineHeight: '1rem' }}>A</span>
            <span
              className="toolbar-color-indicator"
              style={{ background: currentTextColor || '#1a2030' }}
            />
          </button>
          <input
            ref={textColorInputRef}
            type="color"
            className="toolbar-color-input-hidden"
            value={currentTextColor || '#1a2030'}
            onChange={(e) => setTextColor(e.target.value)}
          />
        </div>

        {/* 9. Marca-texto com seletor */}
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            type="button"
            className={`toolbar-color-btn ${tool === 'highlight' ? 'is-on' : ''}`}
            aria-label="Marca-texto"
            title="Marca-texto"
            onClick={() => {
              setTool('highlight');
              highlightColorInputRef.current?.click();
            }}
          >
            <Icon name="highlighter" size={15} />
            <span
              className="toolbar-color-indicator"
              style={{
                background:
                  activeAnnotation?.kind === 'highlight'
                    ? activeAnnotation.color
                    : '#ffd43b',
              }}
            />
          </button>
          <input
            ref={highlightColorInputRef}
            type="color"
            className="toolbar-color-input-hidden"
            defaultValue="#ffd43b"
            onChange={(e) => {
              if (activeAnnotation?.kind === 'highlight') {
                updateAnnotation(activeAnnotation.id, { color: e.target.value });
              }
            }}
          />
        </div>

        {/* 10. Alinhar à esquerda */}
        <button
          type="button"
          className="icon-button is-on"
          aria-label="Alinhar à esquerda"
          title="Alinhar à esquerda"
        >
          <Icon name="alignLeft" />
        </button>

        {/* 11. Centralizar */}
        <button
          type="button"
          className="icon-button"
          aria-label="Centralizar"
          title="Centralizar"
        >
          <Icon name="alignCenter" />
        </button>

        {/* 12. Alinhar à direita */}
        <button
          type="button"
          className="icon-button"
          aria-label="Alinhar à direita"
          title="Alinhar à direita"
        >
          <Icon name="alignRight" />
        </button>

        {/* 13. Limpar formatação */}
        <button
          type="button"
          className="icon-button"
          aria-label="Limpar formatação"
          title="Limpar formatação"
          disabled={!activeAnnotation || activeAnnotation.kind !== 'rich-text'}
          onClick={clearFormatting}
        >
          <Icon name="formatClear" />
        </button>
      </div>

      {/* Extreme Right: Dark/Light Mode Theme Toggle & Save Button */}
      <div className="toolbar-group toolbar-end" aria-label="Theme and Save">
        <button
          type="button"
          className="theme-toggle"
          title={`Switch theme (${THEME_LABELS[theme]})`}
          aria-label={`Switch theme (${THEME_LABELS[theme]})`}
          onClick={cycleTheme}
        >
          <Icon name="theme" size={15} />
          <span>{THEME_LABELS[theme]}</span>
        </button>

        {/* Botão Salvar na extrema direita */}
        <button
          type="button"
          className={`save-button is-${saveStatus} ${hasUnsavedChanges ? 'has-unsaved' : ''}`}
          aria-label="Salvar alterações"
          title={
            saveStatus === 'saving'
              ? 'Salvando alterações...'
              : saveStatus === 'saved'
                ? 'Salvo com sucesso'
                : saveStatus === 'error'
                  ? 'Erro ao salvar. Clique para tentar novamente.'
                  : 'Salvar alterações'
          }
          disabled={!activeDocState || activeDocState.doc.pages.length === 0 || saveStatus === 'saving'}
          onClick={handleSave}
        >
          {saveStatus === 'saving' ? (
            <Icon name="spinner" className="spin-icon" size={16} />
          ) : saveStatus === 'saved' ? (
            <Icon name="check" size={16} />
          ) : saveStatus === 'error' ? (
            <Icon name="alertTriangle" size={16} />
          ) : (
            <Icon name="save" size={16} />
          )}
        </button>
      </div>

      <input
        ref={openFileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length === 0) return;
          run(async () => {
            const result = await openFiles(files);
            for (const failure of result.errors) {
              toasts.push('error', `${failure.name}: ${failure.message}`);
            }
            if (result.openedFiles > 0) {
              toasts.push(
                'success',
                `Aberto${result.openedFiles === 1 ? '' : 's'} ${result.openedFiles} documento${result.openedFiles === 1 ? '' : 's'}.`,
              );
            }
          });
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length === 0) return;
          run(async () => {
            const result = await openFiles(files, { mode: 'merge' });
            for (const failure of result.errors) {
              toasts.push('error', `${failure.name}: ${failure.message}`);
            }
            if (result.openedFiles > 0) {
              toasts.push(
                'success',
                `Merged ${result.openedPages} page${result.openedPages === 1 ? '' : 's'} from ${result.openedFiles} file${result.openedFiles === 1 ? '' : 's'}.`,
              );
            }
          });
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) run(() => placeImageFromFile(file), 'Image placed — drag it into position.');
        }}
      />
    </div>
  );
}

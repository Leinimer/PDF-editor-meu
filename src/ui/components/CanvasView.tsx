/**
 * Main canvas: continuous vertical scroll of all pages with progressive on-demand
 * rendering, active page tracking, direct page input, and zoom controls.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { computeDisplayInfo } from '../../editor-state/selectors';
import { useEditorStore } from '../../editor-state/store';
import { useActiveDoc } from '../hooks/useActiveDoc';
import { PageView } from './PageView';
import { Icon } from '../icons';

const ZOOM_LEVELS = [0.25, 0.35, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 3, 4];
const NO_PAGES: never[] = [];

export function CanvasView(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewSize, setViewSize] = useState({ width: 800, height: 600 });
  const [zoomSetting, setZoomSetting] = useState<'fit' | number>('fit');
  const [pageInputText, setPageInputText] = useState('');
  const [isEditingPageInput, setIsEditingPageInput] = useState(false);

  const pages = useActiveDoc((docState) => docState.doc.pages) ?? NO_PAGES;
  const activePageId = useActiveDoc((docState) => docState.activePageId) ?? null;
  const setActivePage = useEditorStore((state) => state.setActivePage);
  const sources = useEditorStore((state) => state.sources);

  const activeDoc = useActiveDoc((docState) => docState);
  const activeDocId = activeDoc?.id;

  // Active page calculation
  const activeIndex = pages.findIndex((p) => p.id === activePageId);
  const currentDisplayIndex = activeIndex >= 0 ? activeIndex : 0;

  // Reset zoom to auto-fit whenever a new document is opened
  useEffect(() => {
    setZoomSetting('fit');
  }, [activeDocId]);

  // Max page width in display points to compute 90% fit-to-width accurately
  const maxPageDimensions = useMemo(() => {
    let maxWidth = 0;
    let maxHeight = 0;
    for (const page of pages) {
      const info = sources[page.sourceId]?.pageInfos[page.sourceIndex];
      const display = computeDisplayInfo(info, page.rotation);
      if (display.width > maxWidth) maxWidth = display.width;
      if (display.height > maxHeight) maxHeight = display.height;
    }
    return { width: maxWidth > 0 ? maxWidth : 595, height: maxHeight > 0 ? maxHeight : 842 };
  }, [pages, sources]);

  // Responsive ResizeObserver for canvas-scroll container (reacts to window resize and sidebar toggles)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const width = container.clientWidth || container.getBoundingClientRect().width;
      const height = container.clientHeight || container.getBoundingClientRect().height;
      if (width > 0) {
        setViewSize({ width, height });
      }
    };

    updateSize();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = container.clientWidth || entry.contentRect.width;
      const height = container.clientHeight || entry.contentRect.height;
      if (width > 0) {
        setViewSize({ width, height });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Compute zoom: fit mode makes the page width occupy approximately 90% of available viewer width
  // without restricting by page height, enabling continuous vertical scrolling.
  const zoom = useMemo(() => {
    if (pages.length === 0 || maxPageDimensions.width <= 0) return 1;
    if (zoomSetting === 'fit') {
      const targetWidth = viewSize.width * 0.90;
      const scale = targetWidth / maxPageDimensions.width;
      return Math.min(Math.max(scale, 0.1), 5.0);
    }
    return zoomSetting;
  }, [maxPageDimensions.width, zoomSetting, viewSize.width, pages.length]);

  // Zoom helpers
  const zoomBy = useCallback(
    (direction: 1 | -1) => {
      const current = zoom;
      const next =
        direction === 1
          ? ZOOM_LEVELS.find((level) => level > current + 0.01)
          : [...ZOOM_LEVELS].reverse().find((level) => level < current - 0.01);
      if (next) setZoomSetting(next);
    },
    [zoom],
  );

  // Track page visibilities in container
  const pageRatios = useRef<Map<string, number>>(new Map());

  const handleVisibleChange = useCallback(
    (pageId: string, isVisible: boolean, ratio: number) => {
      if (isVisible) {
        pageRatios.current.set(pageId, ratio);
      } else {
        pageRatios.current.delete(pageId);
      }

      // Determine page with maximum visible ratio
      let bestPageId: string | null = null;
      let maxRatio = -1;
      for (const [id, r] of pageRatios.current.entries()) {
        if (r > maxRatio) {
          maxRatio = r;
          bestPageId = id;
        }
      }

      if (bestPageId && bestPageId !== activePageId && maxRatio > 0.15) {
        setActivePage(bestPageId);
      }
    },
    [activePageId, setActivePage],
  );

  // Scroll to active page when changed by thumbnail or nav controls
  const scrollToPage = useCallback((pageId: string) => {
    const el = document.getElementById(`page-${pageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, []);

  // Handle clicking a page to activate it
  const handlePageClick = useCallback(
    (pageId: string) => {
      setActivePage(pageId);
    },
    [setActivePage],
  );

  // Page navigation buttons
  const goToPreviousPage = () => {
    if (currentDisplayIndex > 0) {
      const prevId = pages[currentDisplayIndex - 1]!.id;
      setActivePage(prevId);
      scrollToPage(prevId);
    }
  };

  const goToNextPage = () => {
    if (currentDisplayIndex < pages.length - 1) {
      const nextId = pages[currentDisplayIndex + 1]!.id;
      setActivePage(nextId);
      scrollToPage(nextId);
    }
  };

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(pageInputText, 10);
    if (!isNaN(num) && num >= 1 && num <= pages.length) {
      const targetId = pages[num - 1]!.id;
      setActivePage(targetId);
      scrollToPage(targetId);
    }
    setIsEditingPageInput(false);
  };

  if (pages.length === 0) {
    return (
      <section className="canvas-view" aria-label="Page preview">
        <p className="muted canvas-placeholder">Nenhum documento aberto.</p>
      </section>
    );
  }

  return (
    <section className="canvas-view" aria-label="Visualizador do PDF">
      <div className="canvas-scroll" ref={containerRef}>
        <div className="canvas-pages-column">
          {pages.map((page, index) => (
            <PageView
              key={page.id}
              page={page}
              pageNumber={index + 1}
              isActive={page.id === activePageId}
              zoom={zoom}
              scrollContainerRef={containerRef}
              onVisibleChange={handleVisibleChange}
              onPageClick={handlePageClick}
            />
          ))}
        </div>
      </div>

      <footer className="canvas-controls">
        <div className="canvas-nav">
          <button
            type="button"
            className="icon-button"
            aria-label="Página anterior"
            title="Página anterior"
            disabled={currentDisplayIndex <= 0}
            onClick={goToPreviousPage}
          >
            <Icon name="undo" />
          </button>

          {isEditingPageInput ? (
            <form onSubmit={handlePageInputSubmit} style={{ display: 'inline-flex' }}>
              <input
                type="number"
                min={1}
                max={pages.length}
                autoFocus
                defaultValue={currentDisplayIndex + 1}
                className="toolbar-select"
                style={{ width: '4rem', textAlign: 'center', height: '1.8rem', padding: '0 0.2rem' }}
                onBlur={() => setIsEditingPageInput(false)}
                onChange={(e) => setPageInputText(e.target.value)}
              />
            </form>
          ) : (
            <span
              className="canvas-page-label"
              title="Clique para ir para uma página específica"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setPageInputText(String(currentDisplayIndex + 1));
                setIsEditingPageInput(true);
              }}
            >
              {currentDisplayIndex + 1} / {pages.length}
            </span>
          )}

          <button
            type="button"
            className="icon-button"
            aria-label="Próxima página"
            title="Próxima página"
            disabled={currentDisplayIndex >= pages.length - 1}
            onClick={goToNextPage}
          >
            <Icon name="redo" />
          </button>
        </div>

        <div className="canvas-zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            className="icon-button"
            aria-label="Diminuir zoom"
            title="Diminuir zoom"
            onClick={() => zoomBy(-1)}
          >
            <Icon name="minus" />
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Aumentar zoom"
            title="Aumentar zoom"
            onClick={() => zoomBy(1)}
          >
            <Icon name="plus" />
          </button>
          <button
            type="button"
            className={`icon-button ${zoomSetting === 'fit' ? 'is-on' : ''}`}
            aria-label="Ajustar à largura"
            title="Ajustar à largura"
            aria-pressed={zoomSetting === 'fit'}
            onClick={() => setZoomSetting('fit')}
          >
            <Icon name="fit" />
          </button>
        </div>
      </footer>
    </section>
  );
}

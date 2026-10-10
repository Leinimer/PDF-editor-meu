/**
 * Individual page in the continuous scroll PDF reader.
 * Renders on demand using an IntersectionObserver to maintain high performance
 * for large documents, while keeping dimensions reserved in the DOM.
 *
 * Integrates:
 * 1. Base visual PDF canvas
 * 2. Real PDF.js TextLayer for native browser text selection, copy/paste, and multi-line selection
 * 3. Automatic selection-based highlighting (Range.getClientRects() across multiple lines)
 * 4. AnnotationLayer for shapes, ink, text additions, and in-place text edits
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { PageRef, Rect } from '../../pdf-core/types';
import { computeDisplayInfo } from '../../editor-state/selectors';
import { useEditorStore } from '../../editor-state/store';
import { renderService } from '../../rendering/render-service';
import { sampleBackgroundColor } from '../../rendering/sample-background';
import { AnnotationLayer } from './AnnotationLayer';

interface PageViewProps {
  page: PageRef;
  pageNumber: number;
  isActive: boolean;
  zoom: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onVisibleChange: (pageId: string, isVisible: boolean, ratio: number) => void;
  onPageClick: (pageId: string) => void;
}

export function PageView({
  page,
  pageNumber,
  isActive,
  zoom,
  scrollContainerRef,
  onVisibleChange,
  onPageClick,
}: PageViewProps): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const [renderFailed, setRenderFailed] = useState(false);

  const tool = useEditorStore((state) => state.tool);
  const addAnnotation = useEditorStore((state) => state.addAnnotation);

  const pageInfo = useEditorStore((state) =>
    state.sources[page.sourceId]?.pageInfos[page.sourceIndex],
  );
  const display = useMemo(
    () => computeDisplayInfo(pageInfo, page.rotation),
    [pageInfo, page.rotation],
  );

  // Monitor visibility in scroll container:
  // 1. Trigger onVisibleChange for active page tracking
  // 2. Set isNearViewport to true when near visible range for progressive rendering
  useEffect(() => {
    const stage = stageRef.current;
    const root = scrollContainerRef.current;
    if (!stage || !root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        onVisibleChange(page.id, entry.isIntersecting, entry.intersectionRatio);
        // Render if intersecting or within rootMargin (near viewport)
        setIsNearViewport(entry.isIntersecting);
      },
      {
        root,
        rootMargin: '600px 0px 600px 0px',
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      },
    );

    observer.observe(stage);
    return () => observer.disconnect();
  }, [page.id, onVisibleChange, scrollContainerRef]);

  // Render to canvas and textLayer when near viewport
  useEffect(() => {
    if (!isNearViewport || !display) return;
    const canvas = canvasRef.current;
    const textLayerContainer = textLayerRef.current;
    if (!canvas) return;

    let cancelled = false;
    setRenderFailed(false);

    const cssWidth = display.width * zoom;

    // 1. Render page visual to canvas
    renderService
      .render(page.sourceId, page.sourceIndex, {
        canvas,
        cssWidth,
        rotation: page.rotation,
      })
      .catch(() => {
        if (!cancelled) setRenderFailed(true);
      });

    // 2. Render real text layer for selectable/copyable text
    if (textLayerContainer) {
      renderService
        .renderTextLayer(page.sourceId, page.sourceIndex, textLayerContainer, cssWidth, page.rotation)
        .catch(() => {
          // Non-fatal if text layer fails on pure scanned pages
        });
    }

    return () => {
      cancelled = true;
    };
  }, [isNearViewport, page, display, zoom]);

  // Text selection based highlighting (requirement 4, 5, 6, 7):
  // When in 'highlight' mode, selecting text applies automatic highlighting on mouseup.
  const handleMouseUp = useCallback(() => {
    if (tool !== 'highlight' || !stageRef.current) return;

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    const stage = stageRef.current;

    // Check if selection intersects this page
    if (!stage.contains(range.commonAncestorContainer)) {
      return;
    }

    const stageRect = stage.getBoundingClientRect();
    const clientRects = Array.from(range.getClientRects());
    if (clientRects.length === 0) return;

    // Convert each client rect line into an exact display-space highlight annotation
    for (const cr of clientRects) {
      if (cr.width <= 2 || cr.height <= 2) continue;

      const rect: Rect = {
        x: Math.max((cr.left - stageRect.left) / zoom, 0),
        y: Math.max((cr.top - stageRect.top) / zoom, 0),
        width: Math.min(cr.width / zoom, display.width),
        height: Math.min(cr.height / zoom, display.height),
      };

      addAnnotation({
        kind: 'highlight',
        id: crypto.randomUUID(),
        pageId: page.id,
        rect,
        color: '#ffd43b',
        opacity: 0.45,
      });
    }

    // Clear selection after applying highlight
    sel.removeAllRanges();
  }, [tool, zoom, display.width, display.height, addAnnotation, page.id]);

  const sampleBackground = useCallback(
    (rect: Rect): string => {
      const canvas = canvasRef.current;
      if (!canvas || !display || canvas.width === 0) return '#ffffff';
      return sampleBackgroundColor(canvas, rect, canvas.width / display.width);
    },
    [display],
  );

  const width = display.width * zoom;
  const height = display.height * zoom;

  return (
    <div
      ref={stageRef}
      id={`page-${page.id}`}
      data-page-id={page.id}
      data-page-number={pageNumber}
      data-tool={tool}
      className={`page-stage ${isActive ? 'is-active-page' : ''}`}
      style={{ width, height }}
      onClick={() => onPageClick(page.id)}
      onMouseUp={handleMouseUp}
    >
      {renderFailed ? (
        <p className="thumb-error">Esta página não pôde ser renderizada.</p>
      ) : (
        <canvas
          ref={canvasRef}
          className="page-canvas"
          role="img"
          aria-label={`Page ${pageNumber}`}
          style={{ width, height }}
        />
      )}

      {/* PDF.js Real Text Layer for browser text selection and copy */}
      <div
        ref={textLayerRef}
        className="textLayer"
        style={{ width, height }}
      />

      {/* Annotation, drawing, and in-place text editing layer */}
      <AnnotationLayer
        page={page}
        displayWidth={display.width}
        displayHeight={display.height}
        zoom={zoom}
        sampleBackground={sampleBackground}
      />
    </div>
  );
}

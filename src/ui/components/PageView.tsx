/**
 * Individual page in the continuous scroll PDF reader.
 * Renders on demand using an IntersectionObserver to maintain high performance
 * for large documents, while keeping dimensions reserved in the DOM.
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
  const [isNearViewport, setIsNearViewport] = useState(false);
  const [renderFailed, setRenderFailed] = useState(false);

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

  // Render to canvas when near viewport
  useEffect(() => {
    if (!isNearViewport || !display) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    setRenderFailed(false);

    renderService
      .render(page.sourceId, page.sourceIndex, {
        canvas,
        cssWidth: display.width * zoom,
        rotation: page.rotation,
      })
      .catch(() => {
        if (!cancelled) setRenderFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isNearViewport, page, display, zoom]);

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
      className={`page-stage ${isActive ? 'is-active-page' : ''}`}
      style={{ width, height }}
      onClick={() => onPageClick(page.id)}
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

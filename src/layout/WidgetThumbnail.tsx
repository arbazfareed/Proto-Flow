import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Layer, Stage } from "react-konva";
import type Konva from "konva";
import type { Widget } from "../project/schema";
import { renderWidgetShape } from "../canvas/shapes";

export const THUMBNAIL_SIZE = 24;
export const THUMBNAIL_CACHE_LIMIT = 200;
const RENDER_SIZE = 120;
const DEBOUNCE_MS = 100;
const thumbnailCache = new Map<string, string>();

export function getWidgetThumbnailCacheKey(widget: Widget | Widget[]): string {
  const id = Array.isArray(widget)
    ? `group:${widget.map((item) => item.id).sort().join(",")}`
    : widget.id;
  return `${id}:${JSON.stringify(widget)}`;
}

export function getCachedWidgetThumbnail(key: string): string | undefined {
  const cached = thumbnailCache.get(key);
  if (cached === undefined) return undefined;
  thumbnailCache.delete(key);
  thumbnailCache.set(key, cached);
  return cached;
}

export function cacheWidgetThumbnail(key: string, dataUrl: string): void {
  thumbnailCache.delete(key);
  thumbnailCache.set(key, dataUrl);
  if (thumbnailCache.size > THUMBNAIL_CACHE_LIMIT) {
    const oldestKey = thumbnailCache.keys().next().value;
    if (oldestKey !== undefined) thumbnailCache.delete(oldestKey);
  }
}

export function clearWidgetThumbnailCache(): void {
  thumbnailCache.clear();
}

function thumbnailWidget(widget: Widget): Widget {
  return widget.type === "text"
    ? { ...widget, props: { ...widget.props, text: "Abc" } }
    : widget;
}

export function WidgetThumbnail({
  widget,
  widgets,
}: {
  widget?: Widget;
  widgets?: Widget[];
}) {
  const renderWidgets = useMemo(() => widgets ?? (widget ? [widget] : []), [widget, widgets]);
  const baseWidget = widget ?? renderWidgets[0];
  const key = useMemo(
    () => baseWidget ? getWidgetThumbnailCacheKey(widgets ?? baseWidget) : "",
    [baseWidget, widgets],
  );
  const stageRef = useRef<Konva.Stage>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(() => getCachedWidgetThumbnail(key) ?? null);
  const [failed, setFailed] = useState(false);
  const imageWidgets = useMemo(() => renderWidgets.map(thumbnailWidget), [renderWidgets]);
  const minimumX = renderWidgets.length > 1 ? Math.min(...renderWidgets.map((item) => item.x)) : 0;
  const minimumY = renderWidgets.length > 1 ? Math.min(...renderWidgets.map((item) => item.y)) : 0;
  const boundsWidth = renderWidgets.length > 1
    ? Math.max(...renderWidgets.map((item) => item.x + item.width)) - minimumX
    : baseWidget?.width ?? 1;
  const boundsHeight = renderWidgets.length > 1
    ? Math.max(...renderWidgets.map((item) => item.y + item.height)) - minimumY
    : baseWidget?.height ?? 1;
  const scale = Math.min(
    (RENDER_SIZE - 12) / Math.max(1, boundsWidth),
    (RENDER_SIZE - 12) / Math.max(1, boundsHeight),
  );
  const x = (RENDER_SIZE - boundsWidth * scale) / 2;
  const y = (RENDER_SIZE - boundsHeight * scale) / 2;

  useEffect(() => {
    if (!baseWidget) return;
    const cached = getCachedWidgetThumbnail(key);
    if (cached) {
      setDataUrl(cached);
      setFailed(false);
      return;
    }
    setDataUrl(null);
    setFailed(false);
    if (renderWidgets.some((item) => item.type === "image")) return;

    const timer = window.setTimeout(() => {
      const stage = stageRef.current;
      if (!stage) return;
      try {
        const result = stage.toDataURL({ mimeType: "image/png", pixelRatio: THUMBNAIL_SIZE / RENDER_SIZE });
        cacheWidgetThumbnail(key, result);
        setDataUrl(result);
      } catch (error) {
        console.error("Could not render a layer thumbnail.", error);
        setFailed(true);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [baseWidget, key, renderWidgets]);

  const captureLoadedImage = useCallback(() => {
    window.setTimeout(() => {
      const stage = stageRef.current;
      if (!stage) return;
      try {
        const result = stage.toDataURL({ mimeType: "image/png", pixelRatio: THUMBNAIL_SIZE / RENDER_SIZE });
        cacheWidgetThumbnail(key, result);
        setDataUrl(result);
      } catch (error) {
        console.error("Could not render a layer thumbnail.", error);
        setFailed(true);
      }
    }, 0);
  }, [key]);

  return (
    <span className="layer-thumbnail" aria-hidden="true">
      {dataUrl && !failed && <img src={dataUrl} alt="" width={THUMBNAIL_SIZE} height={THUMBNAIL_SIZE} />}
      {baseWidget && !dataUrl && !failed && (
        <span className="layer-thumbnail-renderer">
          <Stage ref={stageRef} width={RENDER_SIZE} height={RENDER_SIZE} listening={false}>
            <Layer listening={false}>
              <Group
                x={x}
                y={y}
                scaleX={scale}
                scaleY={scale}
              >
                {imageWidgets.map((imageWidget) => (
                  <Group
                    key={imageWidget.id}
                    x={renderWidgets.length > 1 ? imageWidget.x - minimumX : 0}
                    y={renderWidgets.length > 1 ? imageWidget.y - minimumY : 0}
                    opacity={imageWidget.opacity}
                    rotation={imageWidget.rotation}
                  >
                    {renderWidgetShape(imageWidget, false, captureLoadedImage)}
                  </Group>
                ))}
              </Group>
            </Layer>
          </Stage>
        </span>
      )}
    </span>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Layer, Line, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import type { Screen } from "../project/schema";
import { DEFAULT_DEVICE_PRESET, findDevicePreset, toScreenDevice } from "../devices/catalog";
import type { ScreenDevice } from "../devices/types";
import { renderWidgetShape } from "../canvas/shapes";
import { resolveActiveBreakpoint, resolveWidgetsForBreakpoint } from "../project/responsive";

export const SCREEN_THUMBNAIL_WIDTH = 160;
export const SCREEN_THUMBNAIL_HEIGHT = 100;
export const SCREEN_THUMBNAIL_CACHE_LIMIT = 50;
const RENDER_WIDTH = SCREEN_THUMBNAIL_WIDTH * 2;
const RENDER_HEIGHT = SCREEN_THUMBNAIL_HEIGHT * 2;
const RENDER_DEBOUNCE_MS = 200;
const thumbnailCache = new Map<string, string>();

export function getScreenThumbnailCacheKey(
  screen: Screen,
  breakpointId: string | null = null,
): string {
  const device = screen.device ?? toScreenDevice(DEFAULT_DEVICE_PRESET);
  const source = JSON.stringify(screen);
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193);
    hashB = Math.imul(hashB ^ code, 0x85ebca6b);
  }
  return `${screen.id}:${device.presetId}:${device.width}x${device.height}:${breakpointId ?? "base"}:${source.length}:${hashA >>> 0}:${hashB >>> 0}`;
}

export function getCachedScreenThumbnail(key: string): string | undefined {
  const cached = thumbnailCache.get(key);
  if (cached === undefined) return undefined;
  thumbnailCache.delete(key);
  thumbnailCache.set(key, cached);
  return cached;
}

export function cacheScreenThumbnail(key: string, dataUrl: string): void {
  thumbnailCache.delete(key);
  thumbnailCache.set(key, dataUrl);
  if (thumbnailCache.size > SCREEN_THUMBNAIL_CACHE_LIMIT) {
    const oldestKey = thumbnailCache.keys().next().value;
    if (oldestKey !== undefined) thumbnailCache.delete(oldestKey);
  }
}

export function clearScreenThumbnailCache(): void {
  thumbnailCache.clear();
}

function hasInsets(device: ScreenDevice): boolean {
  const { top, bottom, left, right } = device.insets;
  return top + bottom + left + right > 0;
}

export function ScreenThumbnail({
  screen,
  breakpointId = null,
}: {
  screen: Screen;
  breakpointId?: string | null;
}) {
  const stageRef = useRef<Konva.Stage>(null);
  const observerRef = useRef<HTMLDivElement>(null);
  const renderTimerRef = useRef<number | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const cacheKey = useMemo(
    () => getScreenThumbnailCacheKey(screen, breakpointId),
    [breakpointId, screen],
  );
  const [rendered, setRendered] = useState<{ key: string; dataUrl: string } | null>(() => {
    const cached = getCachedScreenThumbnail(cacheKey);
    return cached ? { key: cacheKey, dataUrl: cached } : null;
  });
  const baseDevice = screen.device ?? toScreenDevice(DEFAULT_DEVICE_PRESET);
  const breakpoint = resolveActiveBreakpoint(screen, breakpointId);
  const device: ScreenDevice = {
    ...baseDevice,
    width: breakpoint.width,
    height: breakpoint.height,
    insets: {
      top: Math.min(baseDevice.insets.top, Math.max(0, breakpoint.height - 1)),
      bottom: Math.min(baseDevice.insets.bottom, Math.max(0, breakpoint.height - 1)),
      left: Math.min(baseDevice.insets.left, Math.max(0, breakpoint.width - 1)),
      right: Math.min(baseDevice.insets.right, Math.max(0, breakpoint.width - 1)),
    },
  };
  const preset = findDevicePreset(device.presetId);
  const width = breakpoint.width;
  const height = breakpoint.height;
  const chrome = preset?.frameChrome;
  const bezel = chrome?.bezel ?? 0;
  const maxScale = Math.min(
    (RENDER_WIDTH - 20) / (width + bezel * 2),
    (RENDER_HEIGHT - 20) / (height + bezel * 2),
  );
  const screenX = (RENDER_WIDTH - width * maxScale) / 2;
  const screenY = (RENDER_HEIGHT - height * maxScale) / 2;
  const renderWidgets = useMemo(
    () => resolveWidgetsForBreakpoint(
      screen.widgets,
      breakpoint,
      baseDevice.width,
      baseDevice.height,
    ),
    [baseDevice.height, baseDevice.width, breakpoint, screen.widgets],
  );
  const dataUrl = rendered?.key === cacheKey ? rendered.dataUrl : null;

  useEffect(() => {
    const element = observerRef.current;
    if (!element) return;
    const list = element.closest(".screen-list");
    const sidebar = element.closest(".left-sidebar");
    const updateVisibility = () => {
      const bounds = element.getBoundingClientRect();
      const clip = list instanceof HTMLElement
        ? list.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
      if (
        bounds.bottom > clip.top - 40 &&
        bounds.top < clip.bottom + 40 &&
        bounds.right > clip.left &&
        bounds.left < clip.right
      ) {
        setIsVisible(true);
      }
    };
    updateVisibility();
    list?.addEventListener("scroll", updateVisibility, { passive: true });
    sidebar?.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility);
    return () => {
      list?.removeEventListener("scroll", updateVisibility);
      sidebar?.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("resize", updateVisibility);
    };
  }, []);

  const scheduleRender = useCallback(() => {
    if (renderTimerRef.current !== null) window.clearTimeout(renderTimerRef.current);
    renderTimerRef.current = window.setTimeout(() => {
      renderTimerRef.current = null;
      const stage = stageRef.current;
      if (!stage) return;
      try {
        const result = stage.toDataURL({
          mimeType: "image/png",
          pixelRatio: SCREEN_THUMBNAIL_WIDTH / RENDER_WIDTH,
        });
        cacheScreenThumbnail(cacheKey, result);
        setRendered({ key: cacheKey, dataUrl: result });
        setFailed(false);
      } catch (error) {
        console.error(`Could not render a preview for screen "${screen.name}".`, error);
        setFailed(true);
      }
    }, RENDER_DEBOUNCE_MS);
  }, [cacheKey, screen.name]);

  useEffect(() => {
    const cached = getCachedScreenThumbnail(cacheKey);
    if (cached) {
      setRendered({ key: cacheKey, dataUrl: cached });
      setFailed(false);
      return;
    }
    setRendered(null);
    setFailed(false);
    if (isVisible) scheduleRender();
    return () => {
      if (renderTimerRef.current !== null) {
        window.clearTimeout(renderTimerRef.current);
        renderTimerRef.current = null;
      }
    };
  }, [cacheKey, isVisible, scheduleRender]);

  const frameRadius = chrome?.notch === "watch"
    ? Math.min(width, height) / 2
    : chrome?.cornerRadius ?? 0;
  const viewportRadius = Math.max(0, frameRadius - bezel) * maxScale;
  const outerRadius = frameRadius * maxScale;
  const safeArea = device.insets;
  const empty = renderWidgets.length === 0;

  return (
    <div className="screen-thumbnail" ref={observerRef} aria-hidden="true">
      {dataUrl ? (
        <img
          src={dataUrl}
          alt=""
          width={SCREEN_THUMBNAIL_WIDTH}
          height={SCREEN_THUMBNAIL_HEIGHT}
        />
      ) : failed ? (
        <span className="screen-thumbnail-fallback">Preview unavailable</span>
      ) : (
        <>
          <span className="screen-thumbnail-placeholder">
            {empty ? "Empty screen" : "Rendering preview…"}
          </span>
          {isVisible && (
            <span className="screen-thumbnail-renderer">
              <Stage
                ref={stageRef}
                width={RENDER_WIDTH}
                height={RENDER_HEIGHT}
                listening={false}
              >
                <Layer listening={false} perfectDrawEnabled={false}>
                  <Rect
                    width={RENDER_WIDTH}
                    height={RENDER_HEIGHT}
                    fill="#191a1f"
                    perfectDrawEnabled={false}
                  />
                  {bezel > 0 && (
                    <Rect
                      x={screenX - bezel * maxScale}
                      y={screenY - bezel * maxScale}
                      width={(width + bezel * 2) * maxScale}
                      height={(height + bezel * 2) * maxScale}
                      cornerRadius={outerRadius}
                      fill="#111216"
                      stroke="#565862"
                      strokeWidth={Math.max(1, bezel * maxScale / 4)}
                      perfectDrawEnabled={false}
                    />
                  )}
                  <Group
                    x={screenX}
                    y={screenY}
                    scaleX={maxScale}
                    scaleY={maxScale}
                  >
                    <Rect
                      width={width}
                      height={height}
                      cornerRadius={viewportRadius / maxScale}
                      fill="#ffffff"
                      stroke="#72747e"
                      strokeWidth={1}
                      perfectDrawEnabled={false}
                    />
                    {renderWidgets.filter((widget) => widget.visible).map((widget) => (
                      <Group
                        key={widget.id}
                        x={widget.x}
                        y={widget.y}
                        opacity={widget.opacity}
                        rotation={widget.rotation}
                      >
                        {renderWidgetShape(widget, false, scheduleRender)}
                      </Group>
                    ))}
                    {empty && (
                      <Text
                        x={0}
                        y={height / 2 - 8}
                        width={width}
                        height={16}
                        align="center"
                        text="Empty screen"
                        fontSize={Math.max(10, Math.min(width, height) * 0.04)}
                        fill="#8a8d98"
                        listening={false}
                      />
                    )}
                    {hasInsets(device) && (
                      <Rect
                        x={safeArea.left}
                        y={safeArea.top}
                        width={Math.max(1, width - safeArea.left - safeArea.right)}
                        height={Math.max(1, height - safeArea.top - safeArea.bottom)}
                        fill="#45c69b"
                        opacity={0.035}
                        stroke="#45c69b"
                        strokeWidth={Math.max(1, width / 500)}
                        dash={[Math.max(2, width / 80), Math.max(2, width / 80)]}
                        listening={false}
                        perfectDrawEnabled={false}
                      />
                    )}
                    {chrome?.notch === "dynamic-island" && (
                      <Rect
                        x={width / 2 - 54}
                        y={8}
                        width={108}
                        height={28}
                        cornerRadius={15}
                        fill="#111216"
                        listening={false}
                      />
                    )}
                    {chrome?.notch === "notch" && (
                      <Rect
                        x={width / 2 - 75}
                        y={0}
                        width={150}
                        height={24}
                        cornerRadius={[0, 0, 14, 14]}
                        fill="#111216"
                        listening={false}
                      />
                    )}
                    {chrome?.notch === "punch-hole" && (
                      <Circle
                        x={width / 2}
                        y={14}
                        radius={5}
                        fill="#15161a"
                        listening={false}
                      />
                    )}
                    {device.insets.bottom > 0 && (
                      <Rect
                        x={width / 2 - Math.min(54, width / 7)}
                        y={height - Math.max(12, device.insets.bottom / 2) - 3}
                        width={Math.min(108, width / 3.5)}
                        height={4}
                        cornerRadius={2}
                        fill="#6f717a"
                        opacity={0.8}
                        listening={false}
                      />
                    )}
                    {chrome?.notch === "browser" && (
                      <Group y={-24}>
                        <Rect
                          width={width}
                          height={24}
                          cornerRadius={[6, 6, 0, 0]}
                          fill="#292a30"
                          listening={false}
                        />
                        <Line
                          points={[12, 12, 40, 12]}
                          stroke="#8b8d96"
                          strokeWidth={3}
                          listening={false}
                        />
                      </Group>
                    )}
                  </Group>
                </Layer>
              </Stage>
            </span>
          )}
        </>
      )}
    </div>
  );
}

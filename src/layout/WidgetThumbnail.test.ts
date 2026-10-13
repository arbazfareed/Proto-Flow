import { beforeEach, describe, expect, it } from "vitest";
import { createShapeWidget } from "../canvas/shapes";
import {
  cacheWidgetThumbnail,
  clearWidgetThumbnailCache,
  getCachedWidgetThumbnail,
  getWidgetThumbnailCacheKey,
  THUMBNAIL_CACHE_LIMIT,
} from "./WidgetThumbnail";

describe("widget thumbnail cache", () => {
  beforeEach(() => clearWidgetThumbnailCache());

  it("uses the widget id and full widget data for invalidation", () => {
    const widget = createShapeWidget("rectangle", 0, 0);
    const initialKey = getWidgetThumbnailCacheKey(widget);
    const modifiedKey = getWidgetThumbnailCacheKey({ ...widget, x: 12 });

    expect(initialKey).toContain(widget.id);
    expect(modifiedKey).not.toBe(initialKey);
  });

  it("refreshes recently used thumbnails and evicts the least recently used entry", () => {
    for (let index = 0; index < THUMBNAIL_CACHE_LIMIT; index += 1) {
      cacheWidgetThumbnail(`widget-${index}`, `image-${index}`);
    }
    expect(getCachedWidgetThumbnail("widget-0")).toBe("image-0");
    cacheWidgetThumbnail("widget-new", "image-new");

    expect(getCachedWidgetThumbnail("widget-0")).toBe("image-0");
    expect(getCachedWidgetThumbnail("widget-1")).toBeUndefined();
    expect(getCachedWidgetThumbnail("widget-new")).toBe("image-new");
  });
});

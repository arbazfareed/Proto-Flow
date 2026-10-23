import { beforeEach, describe, expect, it } from "vitest";
import type { Screen } from "../project/schema";
import {
  cacheScreenThumbnail,
  clearScreenThumbnailCache,
  getCachedScreenThumbnail,
  getScreenThumbnailCacheKey,
  SCREEN_THUMBNAIL_CACHE_LIMIT,
} from "./ScreenThumbnail";

const screen: Screen = {
  id: "screen-1",
  name: "Home",
  device: {
    presetId: "iphone-15",
    width: 390,
    height: 844,
    dpr: 3,
    insets: { top: 59, bottom: 34, left: 0, right: 0 },
    orientation: "portrait",
  },
  inputMode: "touch",
  breakpoints: [],
  widgets: [],
  interactionRules: [],
};

const widget: Screen["widgets"][number] = {
  id: "00000000-0000-4000-8000-000000000001",
  type: "rectangle",
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  zIndex: 0,
  style: { fill: "#7856c8" },
  props: {},
};

describe("screen thumbnail cache", () => {
  beforeEach(() => clearScreenThumbnailCache());

  it("keys previews by screen content, device, and breakpoint", () => {
    const key = getScreenThumbnailCacheKey(screen);
    expect(getScreenThumbnailCacheKey({ ...screen, name: "Dashboard" })).not.toBe(key);
    expect(getScreenThumbnailCacheKey({
      ...screen,
      device: { ...screen.device!, presetId: "custom" },
    })).not.toBe(key);
    expect(getScreenThumbnailCacheKey({
      ...screen,
      widgets: [{ ...widget, style: { ...widget.style, fill: "#22aa77" } }],
    })).not.toBe(getScreenThumbnailCacheKey({
      ...screen,
      widgets: [widget],
    }));
    expect(getScreenThumbnailCacheKey(screen, "mobile")).not.toBe(key);
  });

  it("refreshes cache recency when a preview is accessed", () => {
    for (let index = 0; index < SCREEN_THUMBNAIL_CACHE_LIMIT; index += 1) {
      cacheScreenThumbnail(`screen-${index}`, `image-${index}`);
    }
    expect(getCachedScreenThumbnail("screen-0")).toBe("image-0");
    cacheScreenThumbnail("screen-new", "new-image");
    expect(getCachedScreenThumbnail("screen-0")).toBe("image-0");
    expect(getCachedScreenThumbnail("screen-1")).toBeUndefined();
  });

  it("keeps the number of cached screen previews capped at 50", () => {
    for (let index = 0; index <= SCREEN_THUMBNAIL_CACHE_LIMIT; index += 1) {
      cacheScreenThumbnail(`screen-${index}`, `image-${index}`);
    }
    expect(getCachedScreenThumbnail("screen-0")).toBeUndefined();
    expect(getCachedScreenThumbnail(`screen-${SCREEN_THUMBNAIL_CACHE_LIMIT}`))
      .toBe(`image-${SCREEN_THUMBNAIL_CACHE_LIMIT}`);
  });
});

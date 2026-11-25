import { describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../project/schema";
import type { Project, Widget } from "../project/schema";
import { afterEach } from "vitest";
import { embedRemoteImages, fetchImageAsDataUrl, findRemoteMedia, isRemoteUrl, MAX_EMBEDDED_IMAGE_BYTES } from "./remoteMedia";

const base = { x: 0, y: 0, width: 100, height: 80, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0, style: {} };
const widget = (type: string, props: Record<string, unknown>): Widget =>
  ({ ...base, id: crypto.randomUUID(), type, props }) as Widget;

function projectWith(...widgets: Widget[]): Project {
  const project = createEmptyProject("Shared");
  project.screens[0].name = "Home";
  project.screens[0].widgets = widgets;
  return project;
}

const DATA = "data:image/png;base64,AAAA";

describe("web pictures and videos in a shared preview | B23", () => {
  it("recognises web addresses, including protocol-relative ones, but not embedded or local sources", () => {
    expect(isRemoteUrl("https://example.com/a.png")).toBe(true);
    expect(isRemoteUrl("http://example.com/a.png")).toBe(true);
    expect(isRemoteUrl("//cdn.example.com/a.png")).toBe(true);
    expect(isRemoteUrl(DATA)).toBe(false);
    expect(isRemoteUrl("assets/a.png")).toBe(false);
    expect(isRemoteUrl("{{imageUrl}}")).toBe(false);
    expect(isRemoteUrl("")).toBe(false);
    expect(isRemoteUrl(undefined)).toBe(false);
  });

  it("lists web sources of images, card images, videos and video posters, and nothing else", () => {
    const project = projectWith(
      widget("image", { src: "https://img.example/a.png", alt: "Logo" }),
      widget("image", { src: DATA }),
      widget("card", { title: "Offer", imageSrc: "https://img.example/card.jpg" }),
      widget("card", { title: "Plain", src: "https://img.example/plain.jpg" }),
      widget("video", { src: "https://video.example/v.mp4", poster: "https://img.example/poster.jpg" }),
      widget("text", { text: "https://not-media.example" }),
    );

    expect(findRemoteMedia(project).map((item) => [item.widgetName, item.kind, item.url])).toEqual([
      ["Logo", "image", "https://img.example/a.png"],
      ["Offer", "card image", "https://img.example/card.jpg"],
      ["Plain", "card image", "https://img.example/plain.jpg"],
      ["video", "video", "https://video.example/v.mp4"],
      ["video", "video poster", "https://img.example/poster.jpg"],
    ]);
    expect(findRemoteMedia(project)[0]).toMatchObject({ screenName: "Home" });
  });

  it("returns the same project, with no work, when nothing is a web address", async () => {
    const project = projectWith(widget("image", { src: DATA }), widget("text", { text: "Hello" }));
    const fetchImage = vi.fn();

    const result = await embedRemoteImages(project, fetchImage);

    expect(result.project).toBe(project);
    expect(result).toMatchObject({ remaining: [], embedded: 0 });
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("embeds pictures the other site allows, once per address, without changing the open project", async () => {
    const project = projectWith(
      widget("image", { src: "https://img.example/a.png" }),
      widget("image", { src: "https://img.example/a.png" }),
      widget("card", { imageSrc: "https://img.example/card.jpg" }),
      widget("video", { src: DATA, poster: "https://img.example/poster.jpg" }),
    );
    const fetchImage = vi.fn(async (url: string) => `data:image/png;base64,${url.length}`);

    const result = await embedRemoteImages(project, fetchImage);

    expect(fetchImage).toHaveBeenCalledTimes(3); // the repeated address is fetched once
    expect(result.embedded).toBe(4);
    expect(result.remaining).toEqual([]);
    const [first, second, card, video] = result.project.screens[0].widgets;
    expect(first.props.src).toMatch(/^data:image\/png;base64,/);
    expect(second.props.src).toBe(first.props.src);
    expect(card.props.imageSrc).toMatch(/^data:image\/png;base64,/);
    expect(video.props.poster).toMatch(/^data:image\/png;base64,/);
    // The project the person is editing is untouched.
    expect(project.screens[0].widgets[0].props.src).toBe("https://img.example/a.png");
    expect(result.project).not.toBe(project);
  });

  it("keeps what cannot be fetched, and always keeps videos, in the list of missing media", async () => {
    const project = projectWith(
      widget("image", { src: "https://blocked.example/a.png", alt: "Hero" }),
      widget("image", { src: "https://open.example/b.png", alt: "Banner" }),
      widget("video", { src: "https://video.example/v.mp4" }),
    );
    const fetchImage = vi.fn(async (url: string) => (url.includes("open") ? DATA : null));

    const result = await embedRemoteImages(project, fetchImage);

    expect(result.embedded).toBe(1);
    expect(fetchImage).not.toHaveBeenCalledWith("https://video.example/v.mp4");
    expect(result.remaining.map((item) => [item.widgetName, item.kind])).toEqual([
      ["Hero", "image"],
      ["video", "video"],
    ]);
    expect(result.project.screens[0].widgets[1].props.src).toBe(DATA);
  });

  describe("downloading a picture", () => {
    afterEach(() => vi.unstubAllGlobals());
    const respond = (body: BlobPart, type: string, ok = true) =>
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok, blob: async () => new Blob([body], { type }) })));

    it("returns the picture as a data: URL, without cookies or a referrer", async () => {
      respond(new Uint8Array([137, 80, 78, 71]), "image/png");

      await expect(fetchImageAsDataUrl("//cdn.example/a.png")).resolves.toBe("data:image/png;base64,iVBORw==");
      expect(fetch).toHaveBeenCalledWith("https://cdn.example/a.png", { credentials: "omit", referrerPolicy: "no-referrer" });
    });

    it("gives up on anything that is not a small picture, or that fails", async () => {
      respond("<html></html>", "text/html");
      await expect(fetchImageAsDataUrl("https://example.com/page")).resolves.toBeNull();

      respond(new Uint8Array(MAX_EMBEDDED_IMAGE_BYTES + 1), "image/jpeg");
      await expect(fetchImageAsDataUrl("https://example.com/huge.jpg")).resolves.toBeNull();

      respond("", "image/png", false);
      await expect(fetchImageAsDataUrl("https://example.com/missing.png")).resolves.toBeNull();

      vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch (no CORS)"); }));
      await expect(fetchImageAsDataUrl("https://example.com/blocked.png")).resolves.toBeNull();
    });
  });
});

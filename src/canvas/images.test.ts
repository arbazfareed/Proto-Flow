import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_ASSET_THRESHOLD,
  MAX_IMAGE_FILE_SIZE,
  MAX_INLINE_IMAGE_BYTES,
  getImageDataByteSize,
  getInlineImageBytes,
  imageDataToBytes,
  readImageFile,
  readImageUrl,
} from "./images";

describe("canvas image validation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts a PNG file and preserves its source bytes | svg-sanitization", async () => {
    const pngHeader = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const file = new File([pngHeader], "mock.png", { type: "image/png" });
    const image = await readImageFile(file);

    expect(image.mime).toBe("image/png");
    expect(image.size).toBe(pngHeader.length);
    expect([...imageDataToBytes(image.src)]).toEqual([...pngHeader]);
  });

  it("converts TIFF images to PNG for canvas rendering", async () => {
    const UTIF = await import("utif");
    const tiff = UTIF.encodeImage(new Uint8Array([255, 0, 0, 255]), 1, 1);
    const pngHeader = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ putImageData: vi.fn() }),
      toBlob: (callback: BlobCallback) =>
        callback(new Blob([pngHeader], { type: "image/png" })),
    };
    vi.stubGlobal("document", { createElement: () => canvas });
    vi.stubGlobal(
      "ImageData",
      class {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number,
        ) {}
      },
    );

    const image = await readImageFile(new File([tiff], "photo.tiff", { type: "image/tiff" }));

    expect(image.name).toBe("photo.png");
    expect(image.mime).toBe("image/png");
    expect([...imageDataToBytes(image.src)]).toEqual([...pngHeader]);
  });

  it.each([
    ["GIF", "image/gif", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    ["BMP", "image/bmp", [0x42, 0x4d]],
    ["AVIF", "image/avif", [0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]],
    ["HEIC", "image/heic", [0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]],
  ])("recognizes %s device images", async (name, mime, signature) => {
    const bytes = new Uint8Array([...signature, 0, 0, 0]);
    const file = new File([bytes], `photo.${name.toLowerCase()}`, { type: mime });
    if (mime === "image/heic") {
      await expect(readImageFile(file)).rejects.toThrow("Could not decode this HEIC/HEIF image");
    } else {
      const image = await readImageFile(file);
      expect(image.mime).toBe(mime);
      expect(image.size).toBe(bytes.length);
    }
  });

  it("rejects unsupported extensions and mismatched file contents", async () => {
    await expect(
      readImageFile(new File(["not an image"], "mock.gif", { type: "image/gif" })),
    ).rejects.toThrow("Unsupported or invalid image");
    await expect(
      readImageFile(new File(["not a png"], "mock.png", { type: "image/png" })),
    ).rejects.toThrow("Unsupported or invalid image");
  });

  it("uses the required 500 KB threshold and rejects oversized images", async () => {
    expect(IMAGE_ASSET_THRESHOLD).toBe(500 * 1024);
    const oversized = new File(
      [new Uint8Array(25 * 1024 * 1024 + 1)],
      "large.png",
      { type: "image/png" },
    );
    await expect(readImageFile(oversized)).rejects.toThrow("25 MB or smaller");
  });

  it("calculates decoded payload bytes and enforces the cumulative image-payload-budget", () => {
    const encoded = `data:image/png;base64,${btoa("a".repeat(490 * 1024))}`;
    expect(getImageDataByteSize(encoded)).toBe(490 * 1024);
    expect(getInlineImageBytes([encoded, encoded, encoded, encoded])).toBe(
      1_960 * 1024,
    );
    expect(MAX_INLINE_IMAGE_BYTES).toBe(2 * 1024 * 1024);
    expect(() => getImageDataByteSize("data:image/png;base64,%%%")).toThrow(
      "valid base64",
    );
  });

  it("rejects SVGs containing script or external-resource payloads | svg-sanitization", async () => {
    vi.stubGlobal(
      "DOMParser",
      class {
        parseFromString(source: string) {
          const tags = [...source.matchAll(/<[^!?][^>]*>/g)].map(([tag]) => tag);
          const elements = tags.map((tag) => ({
            attributes: [...tag.matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/g)].map(
              ([, name, value]) => ({ name, value }),
            ),
          }));
          return {
            querySelector: (selector: string) =>
              selector.split(", ").some((name) => new RegExp(`<${name}`, "i").test(source))
                ? {}
                : null,
            querySelectorAll: () => elements,
          };
        }
      },
    );
    const unsafeSvg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    await expect(
      readImageFile(new File([unsafeSvg], "unsafe.svg", { type: "image/svg+xml" })),
    ).rejects.toThrow("must not contain scripts or external resources");
    const externalSvg = '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/pixel.png"/></svg>';
    await expect(
      readImageFile(new File([externalSvg], "external.svg", { type: "image/svg+xml" })),
    ).rejects.toThrow("must not contain scripts or external resources");
  });

  it("parses complete SVG documents larger than 4 KB", async () => {
    let parsedLength = 0;
    vi.stubGlobal(
      "DOMParser",
      class {
        parseFromString(source: string) {
          parsedLength = source.length;
          return {
            querySelector: () => null,
            querySelectorAll: () => [],
          };
        }
      },
    );
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">${" ".repeat(5000)}<rect width="1" height="1"/></svg>`;
    const image = await readImageFile(
      new File([svg], "large.svg", { type: "image/svg+xml" }),
    );

    expect(image.mime).toBe("image/svg+xml");
    expect(parsedLength).toBe(svg.length);
  });

  it("fetches and validates HTTP image URLs under the per-image limit", async () => {
    const pngHeader = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Blob([pngHeader], { type: "image/png" }), {
          status: 200,
          headers: { "content-length": String(pngHeader.length) },
        }),
      ),
    );

    const image = await readImageUrl("https://example.com/assets/photo.png");

    expect(image.name).toBe("photo.png");
    expect(image.mime).toBe("image/png");
    expect(image.size).toBe(pngHeader.length);
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://example.com/assets/photo.png"),
      { credentials: "omit" },
    );
  });

  it("rejects unsafe, failed, and oversized image URLs", async () => {
    await expect(readImageUrl("file:///private/photo.png")).rejects.toThrow("HTTP or HTTPS");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );
    await expect(readImageUrl("https://example.com/missing.png")).rejects.toThrow("HTTP 404");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 200,
          headers: { "content-length": String(MAX_IMAGE_FILE_SIZE + 1) },
        }),
      ),
    );
    await expect(readImageUrl("https://example.com/large.png")).rejects.toThrow("25 MB");
  });
});

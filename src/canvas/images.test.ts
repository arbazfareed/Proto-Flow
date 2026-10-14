import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_ASSET_THRESHOLD,
  MAX_INLINE_IMAGE_BYTES,
  getImageDataByteSize,
  getInlineImageBytes,
  imageDataToBytes,
  readImageFile,
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
});

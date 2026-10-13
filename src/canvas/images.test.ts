import { describe, expect, it } from "vitest";
import {
  IMAGE_ASSET_THRESHOLD,
  imageDataToBytes,
  readImageFile,
} from "./images";

describe("canvas image validation", () => {
  it("accepts a PNG file and preserves its source bytes", async () => {
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
});

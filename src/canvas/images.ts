export const IMAGE_ASSET_THRESHOLD = 500 * 1024;
export const MAX_IMAGE_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_DECODED_IMAGE_PIXELS = 50_000_000;

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  ico: "image/x-icon",
};

export interface ImportedImage {
  name: string;
  mime: string;
  size: number;
  src: string;
}

export function getImageDataByteSize(src: string): number {
  const separator = src.indexOf(",");
  if (!src.startsWith("data:image/") || separator < 0) return 0;
  const payload = src.slice(separator + 1);
  if (payload.length === 0 || payload.length % 4 !== 0) {
    throw new Error("The image data is not a valid base64 data URL.");
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  if (!/^[A-Za-z\d+/]*={0,2}$/.test(payload)) {
    throw new Error("The image data is not a valid base64 data URL.");
  }
  return (payload.length / 4) * 3 - padding;
}

export function getInlineImageBytes(sources: readonly string[]): number {
  return sources.reduce((total, source) => total + getImageDataByteSize(source), 0);
}

function getExtension(name: string): string {
  return name.split(".").at(-1)?.toLowerCase() ?? "";
}

function bytesStartWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function detectImageMime(bytes: Uint8Array, fileName: string): string {
  const extensionMime = MIME_BY_EXTENSION[getExtension(fileName)];
  const isPng = bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const isJpeg = bytesStartWith(bytes, [0xff, 0xd8, 0xff]);
  const isWebp =
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";

  if (isPng) return "image/png";
  if (isJpeg) return "image/jpeg";
  if (isWebp) return "image/webp";
  if (String.fromCharCode(...bytes.subarray(0, 6)) === "GIF87a" ||
      String.fromCharCode(...bytes.subarray(0, 6)) === "GIF89a") {
    return "image/gif";
  }
  if (bytesStartWith(bytes, [0x42, 0x4d])) return "image/bmp";
  if (
    bytesStartWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    bytesStartWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return "image/tiff";
  }
  if (bytesStartWith(bytes, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp"
  ) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (["avif", "avis"].includes(brand)) return "image/avif";
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }

  if (extensionMime === "image/svg+xml") {
    const text = new TextDecoder().decode(bytes);
    if (/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(text)) {
      const document = new DOMParser().parseFromString(text, "image/svg+xml");
      if (
        document.querySelector("parsererror, script, foreignObject") ||
        [...document.querySelectorAll("*")].some((element) =>
          [...element.attributes].some((attribute) => {
            if (/^on/i.test(attribute.name)) return true;
            if (/^(?:href|xlink:href|src)$/i.test(attribute.name)) {
              return /^(?:javascript:|https?:|file:|\/\/)/i.test(attribute.value.trim());
            }
            return /url\(\s*['"]?\s*(?:javascript:|https?:|file:|\/\/)/i.test(
              attribute.value,
            );
          }),
        )
      ) {
        throw new Error("SVG images must not contain scripts or external resources.");
      }
      return "image/svg+xml";
    }
  }

  throw new Error(
    "Unsupported or invalid image. Choose a PNG, JPG, GIF, BMP, AVIF, HEIC/HEIF, TIFF, ICO, SVG, or WebP file.",
  );
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not convert this image to PNG."));
    }, "image/png");
  });
}

async function normalizeToPng(file: File, mime: string): Promise<ImportedImage> {
  let canvas: HTMLCanvasElement;
  if (mime === "image/tiff") {
    const UTIF = await import("utif");
    const buffer = await file.arrayBuffer();
    const pages = UTIF.decode(buffer);
    const page = pages[0];
    if (!page) throw new Error("The TIFF image does not contain a readable page.");
    const width = Number(Array.isArray(page.t256) ? page.t256[0] : page.width);
    const height = Number(Array.isArray(page.t257) ? page.t257[0] : page.height);
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      width * height > MAX_DECODED_IMAGE_PIXELS
    ) {
      throw new Error("Images must be 50 megapixels or smaller.");
    }
    UTIF.decodeImage(buffer, page);
    const rgba = UTIF.toRGBA8(page);
    const bitmapCanvas = document.createElement("canvas");
    bitmapCanvas.width = page.width;
    bitmapCanvas.height = page.height;
    const context = bitmapCanvas.getContext("2d");
    if (!context) throw new Error("This device cannot convert the TIFF image.");
    context.putImageData(
      new ImageData(new Uint8ClampedArray(rgba), page.width, page.height),
      0,
      0,
    );
    canvas = bitmapCanvas;
  } else {
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > MAX_DECODED_IMAGE_PIXELS) {
        throw new Error("Images must be 50 megapixels or smaller.");
      }
      canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This device cannot convert this image.");
      context.drawImage(bitmap, 0, 0);
    } finally {
      bitmap.close();
    }
  }
  if (canvas.width * canvas.height > MAX_DECODED_IMAGE_PIXELS) {
    throw new Error("Images must be 50 megapixels or smaller.");
  }
  const blob = await canvasToPng(canvas);
  if (blob.size > MAX_IMAGE_FILE_SIZE) {
    throw new Error("The converted image is larger than 25 MB.");
  }
  const name = `${file.name.replace(/\.[^.]*$/, "") || "image"}.png`;
  return readImageFile(new File([blob], name, { type: "image/png" }));
}

export async function readImageFile(file: File): Promise<ImportedImage> {
  if (file.size === 0) throw new Error("The selected image file is empty.");
  if (file.size > MAX_IMAGE_FILE_SIZE) {
    throw new Error("Images must be 25 MB or smaller.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectImageMime(bytes, file.name);
  if (
    file.type &&
    file.type !== "application/octet-stream" &&
    file.type !== mime &&
    !(mime === "image/heic" && file.type === "image/heif") &&
    !(mime === "image/heif" && file.type === "image/heic") &&
    !(file.type === "image/jpg" && mime === "image/jpeg")
  ) {
    throw new Error("The selected image file type does not match its contents.");
  }

  if (mime === "image/heic" || mime === "image/heif") {
    try {
      const { default: heic2any } = await import("heic2any");
      const converted = await heic2any({ blob: file, toType: "image/png" });
      const png = Array.isArray(converted) ? converted[0] : converted;
      if (!png) throw new Error("No image was returned by the HEIF decoder.");
      const bitmap = await createImageBitmap(png);
      try {
        if (bitmap.width * bitmap.height > MAX_DECODED_IMAGE_PIXELS) {
          throw new Error("Images must be 50 megapixels or smaller.");
        }
      } finally {
        bitmap.close();
      }
      return readImageFile(new File([png], `${file.name.replace(/\.[^.]*$/, "") || "image"}.png`, {
        type: "image/png",
      }));
    } catch (error) {
      throw new Error(
        `Could not decode this HEIC/HEIF image: ${error instanceof Error ? error.message : "unsupported device codec"}`,
      );
    }
  }
  if (mime === "image/tiff") return normalizeToPng(file, mime);

  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }

  return {
    name: file.name,
    mime,
    size: file.size,
    src: `data:${mime};base64,${btoa(binary)}`,
  };
}

export async function readImageUrl(value: string): Promise<ImportedImage> {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a complete image URL beginning with http:// or https://.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Image URLs must use HTTP or HTTPS and cannot include credentials.");
  }

  let response: Response;
  try {
    response = await fetch(url, { credentials: "omit" });
  } catch (error) {
    throw new Error(
      `Could not fetch the image URL. Check the link and its CORS settings.${error instanceof Error ? ` ${error.message}` : ""}`,
    );
  }
  if (!response.ok) {
    throw new Error(`The image URL returned HTTP ${response.status}.`);
  }
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_FILE_SIZE) {
    throw new Error("Images must be 25 MB or smaller.");
  }
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("The image URL returned an empty file.");
  if (blob.size > MAX_IMAGE_FILE_SIZE) throw new Error("Images must be 25 MB or smaller.");
  const encodedName = url.pathname.split("/").at(-1) || "image";
  let name: string;
  try {
    name = decodeURIComponent(encodedName);
  } catch {
    name = encodedName;
  }
  if (blob.type.split(";")[0] === "image/svg+xml" && !/\.[a-z\d]+$/i.test(name)) {
    name = `${name}.svg`;
  }
  const fileType = blob.type.startsWith("image/") ? blob.type : "";
  return readImageFile(new File([blob], name, { type: fileType }));
}

export function imageDataToBytes(src: string): Uint8Array {
  const separator = src.indexOf(",");
  if (!src.startsWith("data:image/") || separator < 0) {
    throw new Error("The image data is not a supported data URL.");
  }
  const binary = atob(src.slice(separator + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

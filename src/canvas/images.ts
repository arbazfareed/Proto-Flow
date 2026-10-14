export const IMAGE_ASSET_THRESHOLD = 500 * 1024;
export const MAX_IMAGE_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  webp: "image/webp",
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

  throw new Error("Unsupported or invalid image. Choose a PNG, JPG, SVG, or WebP file.");
}

export async function readImageFile(file: File): Promise<ImportedImage> {
  if (file.size === 0) throw new Error("The selected image file is empty.");
  if (file.size > MAX_IMAGE_FILE_SIZE) {
    throw new Error("Images must be 25 MB or smaller.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectImageMime(bytes, file.name);
  if (file.type && file.type !== mime && !(file.type === "image/jpg" && mime === "image/jpeg")) {
    throw new Error("The selected image file type does not match its contents.");
  }

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

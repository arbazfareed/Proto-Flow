import type { WorkerEnv } from "./env";

export const MAX_PREVIEW_BUNDLE_BYTES = 10 * 1024 * 1024;
export const PREVIEW_EXPIRY_SECONDS = 30 * 24 * 60 * 60;
export const PREVIEW_ID_PATTERN = /^[A-Za-z0-9]{8}$/;

const PREVIEW_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function generatePreviewId(): string {
  let id = "";
  while (id.length < 8) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    for (const byte of bytes) {
      if (byte < 248) id += PREVIEW_ID_ALPHABET[byte % PREVIEW_ID_ALPHABET.length];
      if (id.length === 8) break;
    }
  }
  return id;
}

export function isPreviewBundle(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const size = new TextEncoder().encode(value).byteLength;
  return size > 0 &&
    size <= MAX_PREVIEW_BUNDLE_BYTES &&
    /^<!doctype html>/i.test(value.trimStart()) &&
    /<html(?:\s|>)/i.test(value) &&
    /<\/html\s*>/i.test(value);
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function buildSandboxedPreviewDocument(bundle: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ProtoFlow published preview</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}body{overflow:hidden}</style></head><body><iframe title="Published prototype" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escapeAttribute(bundle)}"></iframe></body></html>`;
}

export async function removePreviewObjects(
  env: WorkerEnv,
  id: string,
  objectKey: string,
): Promise<void> {
  await env.ASSETS.delete(objectKey);
  await env.CACHE.delete(`short:${id}`);
}

export async function purgeExpiredPreviews(env: WorkerEnv, now: string): Promise<number> {
  const expired = await env.DB.prepare(
    "SELECT id, object_key FROM published_previews WHERE expires_at <= ? ORDER BY expires_at LIMIT 100",
  ).bind(now).all<{ id: string; object_key: string }>();
  let removed = 0;
  for (const preview of expired.results) {
    try {
      await removePreviewObjects(env, preview.id, preview.object_key);
      const result = await env.DB.prepare(
        "DELETE FROM published_previews WHERE id = ? AND expires_at <= ?",
      ).bind(preview.id, now).run();
      if (!result.success) throw new Error("Expired preview metadata could not be removed.");
      removed += result.meta.changes ?? 0;
    } catch (error) {
      console.error("Could not remove an expired cloud preview.", {
        previewId: preview.id,
        message: error instanceof Error ? error.message : "Unknown preview cleanup error.",
      });
    }
  }
  return removed;
}

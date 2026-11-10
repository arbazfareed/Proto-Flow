import { parseImportedHtmlDocument } from "./importedCode";

const MAX_EXTERNAL_HTML_LENGTH = 200_000;
const MAX_EXTERNAL_CSS_LENGTH = 100_000;
const MAX_EXTERNAL_JAVASCRIPT_LENGTH = 100_000;
const MAX_EXTERNAL_ASSET_BYTES = 140 * 1024;
const MAX_TOTAL_FETCH_BYTES = 2 * 1024 * 1024;
const MAX_FETCH_REQUESTS = 40;
const MAX_CSS_IMPORT_DEPTH = 5;
const MAX_CSS_IMPORTS = 20;
const FETCH_TIMEOUT_MS = 8_000;
const RASTER_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const FONT_TYPES = new Set([
  "font/woff",
  "font/woff2",
  "application/font-woff",
  "application/vnd.ms-fontobject",
]);

export interface ExternalAssetResolution {
  html: string;
  css: string;
  javascript: string;
  warnings: string[];
  resolvedCount: number;
}

interface ResolutionContext {
  fetcher: typeof fetch;
  baseUrl?: string;
  warnings: string[];
  resolvedCount: number;
  requestCount: number;
  fetchedBytes: number;
  imports: number;
}

interface FetchedAsset {
  bytes: Uint8Array;
  mimeType: string;
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    !host.includes(".") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
    host.includes(":");
}

function resolveAssetUrl(source: string, baseUrl?: string): URL {
  const url = baseUrl ? new URL(source, baseUrl) : new URL(source);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    isPrivateOrLocalHostname(url.hostname)
  ) {
    throw new Error("Only public HTTPS assets can be fetched.");
  }
  url.hash = "";
  return url;
}

function addWarning(context: ResolutionContext, url: string, reason: string): void {
  if (context.warnings.length >= 30) return;
  context.warnings.push(`${url}: ${reason}`);
}

async function readResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("The asset exceeds the per-file size limit.");
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("The asset exceeds the per-file size limit.");
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("The asset exceeds the per-file size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchAsset(
  source: string,
  context: ResolutionContext,
  maxBytes = MAX_EXTERNAL_ASSET_BYTES,
  baseUrl = context.baseUrl,
): Promise<{ url: URL; asset: FetchedAsset } | null> {
  let url: URL;
  try {
    url = resolveAssetUrl(source, baseUrl);
  } catch {
    addWarning(context, source, "Use a public HTTPS URL and set an asset base URL for relative paths.");
    return null;
  }
  if (context.requestCount >= MAX_FETCH_REQUESTS) {
    addWarning(context, url.href, "The import reached its external asset request limit.");
    return null;
  }
  if (context.fetchedBytes >= MAX_TOTAL_FETCH_BYTES) {
    addWarning(context, url.href, "The import reached its total download size limit.");
    return null;
  }

  context.requestCount += 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await context.fetcher(url, {
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      addWarning(context, url.href, `The server returned HTTP ${response.status}.`);
      return null;
    }
    const bytes = await readResponseBytes(
      response,
      Math.min(maxBytes, MAX_TOTAL_FETCH_BYTES - context.fetchedBytes),
    );
    context.fetchedBytes += bytes.byteLength;
    return {
      url,
      asset: {
        bytes,
        mimeType: response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "",
      },
    };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError"
      ? "The request timed out."
      : "The request failed or was blocked by CORS or network policy.";
    addWarning(context, url.href, reason);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function dataUrl(asset: FetchedAsset): string {
  return `data:${asset.mimeType};base64,${bytesToBase64(asset.bytes)}`;
}

function cssWithoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\r\n]/g, " "),
  );
}

const CSS_IMPORT_PATTERN =
  /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)|"([^"]*)"|'([^']*)')\s*([^;]*);/gi;
const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;

async function inlineCssUrls(css: string, baseUrl: string, context: ResolutionContext): Promise<string> {
  const matches = [...css.matchAll(CSS_URL_PATTERN)];
  let output = "";
  let cursor = 0;
  for (const match of matches) {
    const source = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    const start = match.index ?? 0;
    const end = start + match[0].length;
    output += css.slice(cursor, start);
    cursor = end;
    if (!source || /^(?:data:|blob:|#)/i.test(source)) {
      output += match[0];
      continue;
    }
    const fetched = await fetchAsset(source, context, 80 * 1024, baseUrl);
    if (!fetched) {
      output += match[0];
      continue;
    }
    const mimeType = fetched.asset.mimeType;
    if (!RASTER_IMAGE_TYPES.has(mimeType) && !FONT_TYPES.has(mimeType)) {
      addWarning(context, fetched.url.href, "Only raster images and web fonts are inlined from CSS.");
      output += match[0];
      continue;
    }
    const replacement = `url("${dataUrl(fetched.asset)}")`;
    if (output.length + replacement.length + css.length - end > MAX_EXTERNAL_CSS_LENGTH) {
      addWarning(context, fetched.url.href, "Inlining this asset would exceed the CSS size limit.");
      output += match[0];
      continue;
    }
    output += replacement;
    context.resolvedCount += 1;
  }
  return output + css.slice(cursor);
}

async function resolveCss(
  css: string,
  baseUrl: string,
  context: ResolutionContext,
  importStack = new Set<string>(),
  depth = 0,
): Promise<string> {
  const maskedCss = cssWithoutComments(css);
  const matches = [...maskedCss.matchAll(CSS_IMPORT_PATTERN)];
  let output = "";
  let cursor = 0;
  for (const match of matches) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    output += css.slice(cursor, start);
    cursor = end;
    const source = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? "").trim();
    const qualifiers = (match[6] ?? "").trim();
    if (!source || depth >= MAX_CSS_IMPORT_DEPTH || context.imports >= MAX_CSS_IMPORTS) {
      addWarning(context, source || baseUrl, "CSS imports exceeded the recursion limit.");
      output += css.slice(start, end);
      continue;
    }
    if (/\b(?:layer|supports)\b/i.test(qualifiers)) {
      addWarning(context, source, "CSS @import layer() and supports() qualifiers are not supported.");
      output += css.slice(start, end);
      continue;
    }
    const fetched = await fetchAsset(source, context, MAX_EXTERNAL_CSS_LENGTH, baseUrl);
    if (!fetched) {
      output += css.slice(start, end);
      continue;
    }
    if (importStack.has(fetched.url.href)) {
      addWarning(context, fetched.url.href, "A circular CSS import was skipped.");
      continue;
    }
    context.imports += 1;
    const importedCss = new TextDecoder().decode(fetched.asset.bytes);
    const nextStack = new Set(importStack).add(fetched.url.href);
    let resolved = await resolveCss(importedCss, fetched.url.href, context, nextStack, depth + 1);
    resolved = await inlineCssUrls(resolved, fetched.url.href, context);
    const replacement = qualifiers ? `@media ${qualifiers} { ${resolved} }` : resolved;
    if (output.length + replacement.length + css.length - end > MAX_EXTERNAL_CSS_LENGTH) {
      addWarning(context, fetched.url.href, "Inlining this stylesheet would exceed the 100 KB CSS limit.");
      output += css.slice(start, end);
      continue;
    }
    output += replacement;
    context.resolvedCount += 1;
  }
  output += css.slice(cursor);
  return await inlineCssUrls(output, baseUrl, context);
}

function serializeHtml(html: string, document: Document, body: HTMLElement): string {
  if (
    /<html(?:\s|>)/i.test(html) ||
    /<!doctype\b/i.test(html) ||
    document.head.childElementCount > 0
  ) {
    const doctype = document.doctype ? `<!doctype ${document.doctype.name}>` : "";
    return `${doctype}${document.documentElement.outerHTML}`;
  }
  return body.innerHTML;
}

export async function resolveExternalAssets(
  html: string,
  css: string,
  javascript: string,
  options: { baseUrl?: string; fetcher?: typeof fetch } = {},
): Promise<ExternalAssetResolution> {
  const context: ResolutionContext = {
    fetcher: options.fetcher ?? globalThis.fetch.bind(globalThis),
    ...(options.baseUrl?.trim() ? { baseUrl: options.baseUrl.trim() } : {}),
    warnings: [],
    resolvedCount: 0,
    requestCount: 0,
    fetchedBytes: 0,
    imports: 0,
  };
  if (!html.trim()) {
    return { html, css, javascript, warnings: ["Add HTML before resolving external assets."], resolvedCount: 0 };
  }

  const { document, body } = parseImportedHtmlDocument(html);
  if (!context.baseUrl) {
    const declaredBase = document.querySelector("base[href]")?.getAttribute("href")?.trim();
    if (declaredBase) {
      try {
        context.baseUrl = new URL(declaredBase).href;
      } catch {
        addWarning(context, declaredBase, "The document base URL is invalid.");
      }
    }
  }
  let resolvedCss = css;
  const stylesheets = Array.from(document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>(
    'link[rel~="stylesheet"][href], style',
  ));
  for (const stylesheetElement of stylesheets) {
    if (stylesheetElement.tagName === "STYLE") {
      const style = stylesheetElement as HTMLStyleElement;
      const styleCss = await resolveCss(style.textContent ?? "", context.baseUrl ?? "", context);
      if (resolvedCss.length + styleCss.length <= MAX_EXTERNAL_CSS_LENGTH) {
        resolvedCss = [resolvedCss, styleCss].filter(Boolean).join("\n");
        style.remove();
      } else {
        addWarning(context, "inline <style>", "The resolved stylesheet would exceed the 100 KB CSS limit.");
      }
      continue;
    }
    const link = stylesheetElement as HTMLLinkElement;
    const source = link.getAttribute("href")?.trim() ?? "";
    if (/^(?:data:|blob:|#)/i.test(source)) continue;
    const fetched = await fetchAsset(source, context, MAX_EXTERNAL_CSS_LENGTH);
    if (!fetched) continue;
    const stylesheet = await resolveCss(
      new TextDecoder().decode(fetched.asset.bytes),
      fetched.url.href,
      context,
      new Set([fetched.url.href]),
    );
    const media = link.getAttribute("media")?.trim();
    const mediaCss = media ? `@media ${media} { ${stylesheet} }` : stylesheet;
    if (resolvedCss.length + mediaCss.length > MAX_EXTERNAL_CSS_LENGTH) {
      addWarning(context, fetched.url.href, "The resolved stylesheet would exceed the 100 KB CSS limit.");
      continue;
    }
    resolvedCss = [resolvedCss, mediaCss].filter(Boolean).join("\n");
    link.remove();
    context.resolvedCount += 1;
  }
  resolvedCss = await resolveCss(
    resolvedCss,
    context.baseUrl ?? "",
    context,
  );

  for (const script of Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"))) {
    const source = script.getAttribute("src")?.trim() ?? "";
    if (/^(?:data:|blob:|#)/i.test(source)) continue;
    const type = (script.getAttribute("type") ?? "").trim().toLowerCase();
    if (type === "module") {
      addWarning(context, source, "External JavaScript modules are not supported.");
      continue;
    }
    if (type && ![
      "text/javascript",
      "application/javascript",
      "text/ecmascript",
      "application/ecmascript",
    ].includes(type)) continue;
    const fetched = await fetchAsset(source, context, MAX_EXTERNAL_JAVASCRIPT_LENGTH);
    if (!fetched) continue;
    const sourceCode = new TextDecoder().decode(fetched.asset.bytes);
    const embeddedJavaScriptLength = Array.from(document.querySelectorAll("script"))
      .reduce((length, element) => length + (element.textContent?.length ?? 0), javascript.length);
    if (embeddedJavaScriptLength + sourceCode.length > MAX_EXTERNAL_JAVASCRIPT_LENGTH) {
      addWarning(context, fetched.url.href, "The resolved JavaScript would exceed the 100 KB limit.");
      continue;
    }
    const originalSource = script.getAttribute("src");
    script.removeAttribute("src");
    script.textContent = sourceCode;
    if (serializeHtml(html, document, body).length > MAX_EXTERNAL_HTML_LENGTH) {
      script.setAttribute("src", originalSource ?? source);
      script.textContent = "";
      addWarning(context, fetched.url.href, "Inlining this script would exceed the 200 KB HTML limit.");
      continue;
    }
    context.resolvedCount += 1;
  }

  for (const image of Array.from(document.querySelectorAll<HTMLImageElement>("img[src]"))) {
    const source = image.getAttribute("src")?.trim() ?? "";
    if (/^(?:data:|blob:|#)/i.test(source)) continue;
    const fetched = await fetchAsset(source, context);
    if (!fetched) continue;
    if (!RASTER_IMAGE_TYPES.has(fetched.asset.mimeType)) {
      addWarning(context, fetched.url.href, "Only PNG, JPEG, GIF, and WebP images can be inlined.");
      continue;
    }
    const inlineSource = dataUrl(fetched.asset);
    image.setAttribute("src", inlineSource);
    if (serializeHtml(html, document, body).length > MAX_EXTERNAL_HTML_LENGTH) {
      image.setAttribute("src", source);
      addWarning(context, fetched.url.href, "Inlining this image would exceed the 200 KB HTML limit.");
      continue;
    }
    context.resolvedCount += 1;
  }

  if (resolvedCss.length > MAX_EXTERNAL_CSS_LENGTH) {
    context.warnings.push("Resolved CSS exceeds the 100 KB import limit; no resolved CSS was applied.");
    resolvedCss = css;
  }
  return {
    html: serializeHtml(html, document, body),
    css: resolvedCss,
    javascript,
    warnings: context.warnings,
    resolvedCount: context.resolvedCount,
  };
}

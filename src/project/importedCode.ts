export interface ExtractedImportedCode {
  html: string;
  css: string;
  javascript: string;
}

export function parseImportedHtmlDocument(html: string): {
  document: Document;
  body: HTMLElement;
} {
  const document = new DOMParser().parseFromString(html, "text/html");
  if (document.body) return { document, body: document.body };

  const body = document.createElement("body");
  const root = document.documentElement ?? document.appendChild(document.createElement("html"));
  for (const child of Array.from(root.childNodes)) {
    if (child !== document.head) body.append(child);
  }
  root.append(body);
  return { document, body };
}

export function extractImportedCode(
  html: string,
  css = "",
  javascript = "",
): ExtractedImportedCode {
  const { document, body } = parseImportedHtmlDocument(html);
  const embeddedCss = Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .filter(Boolean);
  const embeddedJavascript = Array.from(document.querySelectorAll("script"))
    .map((script) => script.textContent ?? "")
    .filter(Boolean);

  document.querySelectorAll("style, script").forEach((element) => element.remove());

  return {
    html: body.innerHTML,
    css: [...embeddedCss, css].filter((source) => source.trim()).join("\n"),
    javascript: [...embeddedJavascript, javascript].filter((source) => source.trim()).join("\n"),
  };
}

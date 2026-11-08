export interface ExtractedImportedCode {
  html: string;
  css: string;
  javascript: string;
}

export function extractImportedCode(
  html: string,
  css = "",
  javascript = "",
): ExtractedImportedCode {
  const document = new DOMParser().parseFromString(html, "text/html");
  const embeddedCss = Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .filter(Boolean);
  const embeddedJavascript = Array.from(document.querySelectorAll("script"))
    .map((script) => script.textContent ?? "")
    .filter(Boolean);

  document.querySelectorAll("style, script").forEach((element) => element.remove());

  return {
    html: document.body.innerHTML,
    css: [...embeddedCss, css].filter((source) => source.trim()).join("\n"),
    javascript: [...embeddedJavascript, javascript].filter((source) => source.trim()).join("\n"),
  };
}

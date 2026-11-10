export interface ImportedDomSelection {
  nodeId: string;
  tagName: string;
  label: string;
  textContent: string;
}

export interface ImportedDomInteractionBinding {
  nodeId: string;
  targetScreenId: string;
}

export function parseImportedDomSelectionMessage(
  value: unknown,
  expectedNonce: string,
): ImportedDomSelection | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;
  if (
    message.type !== "protoflow-dom-selection" ||
    message.nonce !== expectedNonce ||
    typeof message.nodeId !== "string" ||
    !/^node-\d{1,4}$/.test(message.nodeId) ||
    typeof message.tagName !== "string" ||
    !/^[a-z][a-z0-9-]{0,31}$/.test(message.tagName) ||
    typeof message.label !== "string" ||
    message.label.length > 120 ||
    typeof message.textContent !== "string" ||
    message.textContent.length > 160
  ) return null;

  return {
    nodeId: message.nodeId,
    tagName: message.tagName,
    label: message.label,
    textContent: message.textContent,
  };
}

export function createImportedDomInspectorScript(nonce: string): string {
  return `(() => {
  const nonce = ${JSON.stringify(nonce)};
  const skippedTags = new Set(["HEAD", "SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "SVG"]);
  let nodeIndex = 0;
  const tagTree = (element) => {
    if (
      nodeIndex >= 2000 ||
      skippedTags.has(element.tagName) ||
      element.hasAttribute("hidden")
    ) return;
    element.setAttribute("data-protoflow-node-id", "node-" + (++nodeIndex));
    for (const child of Array.from(element.children)) tagTree(child);
  };
  for (const child of Array.from(document.body.children)) tagTree(child);

  const outline = document.createElement("style");
  outline.textContent = "[data-protoflow-node-id].protoflow-inspected { outline: 2px solid #8065d6 !important; outline-offset: 2px !important; cursor: crosshair !important; }";
  document.head.appendChild(outline);

  let enabled = false;
  let selected = null;
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (
      event.source !== parent ||
      !message ||
      message.type !== "protoflow-dom-inspector-mode" ||
      message.nonce !== nonce ||
      typeof message.enabled !== "boolean"
    ) return;
    enabled = message.enabled;
    if (!enabled && selected) {
      selected.classList.remove("protoflow-inspected");
      selected = null;
    }
  });

  document.addEventListener("click", (event) => {
    if (!enabled || !(event.target instanceof Element)) return;
    const element = event.target.closest("[data-protoflow-node-id]");
    if (!element) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selected?.classList.remove("protoflow-inspected");
    selected = element;
    selected.classList.add("protoflow-inspected");
    const nodeId = selected.getAttribute("data-protoflow-node-id") || "";
    const identity = selected.id
      ? "#" + selected.id
      : typeof selected.className === "string" && selected.className.trim()
        ? "." + selected.className.trim().split(/\\s+/)[0]
        : selected.tagName.toLowerCase();
    parent.postMessage({
      type: "protoflow-dom-selection",
      nonce,
      nodeId,
      tagName: selected.tagName.toLowerCase(),
      label: identity.slice(0, 120),
      textContent: (selected.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 160),
    }, "*");
  }, true);
})();`;
}

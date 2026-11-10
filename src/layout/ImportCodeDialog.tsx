import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  Code2,
  Crosshair,
  FileText,
  ShieldCheck,
  X,
} from "lucide-react";
import { findRequiredIcons } from "../project/htmlImport";
import { extractImportedCode } from "../project/importedCode";
import {
  createImportedDomInspectorScript,
  parseImportedDomSelectionMessage,
} from "../project/importedDomInspector";
import type {
  ImportedDomInteractionBinding,
  ImportedDomSelection,
} from "../project/importedDomInspector";
import {
  createDesignTokenCollectorScript,
  parseImportedDesignTokenMessage,
} from "../project/importedDesignTokens";
import type { ImportedDesignTokens } from "../project/importedDesignTokens";
import { IMPORTED_HTML_ICON_REGISTRY } from "./widgetIcons";

export interface ImportedCode {
  html: string;
  css: string;
  javascript: string;
}

interface ImportCodeDialogProps {
  initialCode?: ImportedCode | null;
  screens: Array<{ id: string; name: string }>;
  sourceScreenId: string;
  onClose: () => void;
  onDraftChange?: (code: ImportedCode) => void;
  onRenderOnCanvas: (
    code: Pick<ImportedCode, "html" | "css">,
    tokens: ImportedDesignTokens,
    interactionBinding: ImportedDomInteractionBinding | null,
  ) => void;
}

const INITIAL_HTML = `<main class="card">
  <h1>Welcome to ProtoFlow</h1>
  <p>Edit the code to update this preview.</p>
  <button id="demo-button">Try it</button>
</main>`;

const INITIAL_CSS = `body {
  margin: 0;
  padding: 32px;
  font-family: Arial, sans-serif;
  color: #242033;
  background: #f3f0fa;
}
.card {
  max-width: 420px;
  padding: 28px;
  border-radius: 16px;
  background: white;
  box-shadow: 0 12px 32px #30204a22;
}
button {
  padding: 10px 16px;
  border: 0;
  border-radius: 8px;
  color: white;
  background: #795ed0;
  cursor: pointer;
}`;

const INITIAL_JS = `document.querySelector("#demo-button")?.addEventListener("click", (event) => {
  event.currentTarget.textContent = "It works!";
});`;

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob: https:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");

export function compileSandboxDocument(
  html: string,
  css: string,
  javascript: string,
  tokenNonce = "preview",
): string {
  const extracted = extractImportedCode(html, css, javascript);
  if (extracted.html.length + extracted.css.length + extracted.javascript.length > 300_000) {
    throw new Error("Imported HTML, CSS, and JavaScript are limited to 300 KB.");
  }
  const safeCss = extracted.css.replace(/<\/style/gi, "<\\/style");
  const safeJavascript = extracted.javascript.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
  <meta name="referrer" content="no-referrer">
  <style>${safeCss}</style>
</head>
<body>
${extracted.html}
<script>${createImportedDomInspectorScript(tokenNonce)}</script>
<script>${createDesignTokenCollectorScript(tokenNonce)}</script>
<script>${safeJavascript}</script>
</body>
</html>`;
}

function getExternalCode(
html: string,
css: string,
javascript: string,
): { css: string; javascript: string } {
const documentSources = extractImportedCode(html);
const hasEmbeddedSources = Boolean(documentSources.css || documentSources.javascript);
const isFullDocument = /<!doctype\b|<html(?:\s|>)/i.test(html);
const shouldIgnoreUntouchedDefaults = hasEmbeddedSources || isFullDocument;
return {
  css: shouldIgnoreUntouchedDefaults && css === INITIAL_CSS ? "" : css,
  javascript: shouldIgnoreUntouchedDefaults && javascript === INITIAL_JS ? "" : javascript,
};
}

export function ImportCodeDialog({
  initialCode,
  screens,
  sourceScreenId,
  onClose,
  onDraftChange,
  onRenderOnCanvas,
}: ImportCodeDialogProps) {
  const [activeTab, setActiveTab] = useState<"html" | "css" | "js">("html");
  const [html, setHtml] = useState(initialCode?.html ?? INITIAL_HTML);
  const [css, setCss] = useState(initialCode?.css ?? INITIAL_CSS);
  const [javascript, setJavascript] = useState(initialCode?.javascript ?? INITIAL_JS);
  const [previewDocument, setPreviewDocument] = useState("");
  const [error, setError] = useState("");
  const previewNonce = useMemo(() => crypto.randomUUID(), []);
  const [designTokens, setDesignTokens] = useState<ImportedDesignTokens>({
    colors: [],
    textStyles: [],
  });
  const [inspectorMode, setInspectorMode] = useState(false);
  const [selectedDomNode, setSelectedDomNode] = useState<ImportedDomSelection | null>(null);
  const [interactionBinding, setInteractionBinding] =
    useState<ImportedDomInteractionBinding | null>(null);
  const [targetScreenId, setTargetScreenId] = useState(
    () => screens.find((screen) => screen.id !== sourceScreenId)?.id ?? "",
  );
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const activeEditorRef = useRef<HTMLTextAreaElement>(null);
  const iconAnalysis = useMemo(() => {
    if (html.length > 200_000) {
      return { requiredIcons: [], truncated: false, unavailable: true };
    }
    return { ...findRequiredIcons(html), unavailable: false };
  }, [html]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    activeEditorRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const externalCode = getExternalCode(html, css, javascript);
      setDesignTokens({ colors: [], textStyles: [] });
      setSelectedDomNode(null);
      setInteractionBinding(null);
      setPreviewDocument(compileSandboxDocument(html, externalCode.css, externalCode.javascript, previewNonce));
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [css, html, javascript, previewNonce]);

  useEffect(() => {
    const handlePreviewMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== document.querySelector<HTMLIFrameElement>(
        'iframe[title="Sandboxed code preview"]',
      )?.contentWindow) return;
      const tokens = parseImportedDesignTokenMessage(event.data, previewNonce);
      if (tokens) setDesignTokens(tokens);
      const selectedNode = parseImportedDomSelectionMessage(event.data, previewNonce);
      if (selectedNode) setSelectedDomNode(selectedNode);
    };
    window.addEventListener("message", handlePreviewMessage);
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, [previewNonce]);

  const sendInspectorMode = (enabled: boolean) => {
    previewFrameRef.current?.contentWindow?.postMessage({
      type: "protoflow-dom-inspector-mode",
      nonce: previewNonce,
      enabled,
    }, "*");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), textarea, select:not(:disabled), iframe',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleRender = () => {
    setError("");
    try {
      onRenderOnCanvas(
        { html, css: getExternalCode(html, css, javascript).css },
        designTokens,
        interactionBinding,
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The code could not be rendered on the canvas.");
    }
  };

  const currentValue = activeTab === "html" ? html : activeTab === "css" ? css : javascript;
  const updateCurrentValue = (value: string) => {
    setDesignTokens({ colors: [], textStyles: [] });
    setInspectorMode(false);
    sendInspectorMode(false);
    setSelectedDomNode(null);
    setInteractionBinding(null);
    const hasEmbeddedCode = /<!doctype\b|<html(?:\s|>)|<style\b|<script\b/i.test(value);
    const nextCss = activeTab === "html" && hasEmbeddedCode && css === INITIAL_CSS ? "" : css;
    const nextJavascript = activeTab === "html" && hasEmbeddedCode && javascript === INITIAL_JS
      ? ""
      : javascript;
    const updated = {
      html: activeTab === "html" ? value : html,
      css: activeTab === "css" ? value : nextCss,
      javascript: activeTab === "js" ? value : nextJavascript,
    };
    if (activeTab === "html") setHtml(value);
    else if (activeTab === "css") setCss(value);
    else setJavascript(value);
    if (activeTab === "html") {
      if (nextCss !== css) setCss(nextCss);
      if (nextJavascript !== javascript) setJavascript(nextJavascript);
    }
    onDraftChange?.(updated);
  };

  return (
    <div
      className="import-code-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="import-code-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-code-title"
        onKeyDown={handleKeyDown}
      >
        <header className="import-code-header">
          <div className="import-code-title">
            <span className="import-code-icon"><Code2 size={17} /></span>
            <div>
              <span className="eyebrow">LOCAL CODE SANDBOX</span>
              <h2 id="import-code-title">Import code</h2>
            </div>
          </div>
          <div className="import-code-security"><ShieldCheck size={14} /> Isolated preview</div>
          <button className="icon-button" aria-label="Close Import Code" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="import-code-split">
          <section className="import-code-editor" aria-label="Code editor">
            <div className="import-code-tabs" role="tablist" aria-label="Code language">
              {(["html", "css", "js"] as const).map((tab) => (
                <button
                  key={tab}
                  id={`import-code-tab-${tab}`}
                  className={activeTab === tab ? "is-active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  aria-controls={`import-code-panel-${tab}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab.toUpperCase()}
                </button>
              ))}
            </div>
            <label className="import-code-editor-label" htmlFor={`import-code-input-${activeTab}`}>
              {activeTab.toUpperCase()} source
            </label>
            <div
              id={`import-code-panel-${activeTab}`}
              className="import-code-editor-panel"
              role="tabpanel"
              aria-labelledby={`import-code-tab-${activeTab}`}
            >
              <textarea
                ref={activeEditorRef}
                id={`import-code-input-${activeTab}`}
                aria-label={`${activeTab.toUpperCase()} code`}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={currentValue}
                onChange={(event) => updateCurrentValue(event.currentTarget.value)}
              />
            </div>
            <p className="import-code-hint">
              Embedded styles/scripts are extracted automatically. CSS is mapped to canvas elements; JavaScript runs only in the isolated preview.
            </p>
          </section>

          <section className="import-code-preview" aria-label="Live code preview">
            <div className="import-code-preview-heading">
              <span>LIVE PREVIEW</span>
              <button
                type="button"
                className={`import-code-inspector-toggle${inspectorMode ? " is-active" : ""}`}
                aria-pressed={inspectorMode}
                onClick={() => {
                  const enabled = !inspectorMode;
                  setInspectorMode(enabled);
                  sendInspectorMode(enabled);
                }}
              >
                <Crosshair size={12} /> {inspectorMode ? "Stop inspecting" : "Inspect elements"}
              </button>
            </div>
            <iframe
              key={previewDocument}
              ref={previewFrameRef}
              title="Sandboxed code preview"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={previewDocument}
              onLoad={() => sendInspectorMode(inspectorMode)}
            />
            <section className="import-code-dom-inspector" aria-label="DOM inspector">
              <div className="import-code-dom-inspector-title">
                <strong>DOM INSPECTOR</strong>
                <span>{selectedDomNode ? selectedDomNode.nodeId : "Click an element in the preview"}</span>
              </div>
              {selectedDomNode ? (
                <>
                  <p>
                    <code>&lt;{selectedDomNode.tagName}&gt;</code> {selectedDomNode.label}
                    {selectedDomNode.textContent && ` · ${selectedDomNode.textContent}`}
                  </p>
                  {interactionBinding?.nodeId === selectedDomNode.nodeId ? (
                    <p className="import-code-binding-status" role="status">
                      onClick navigates to {screens.find((screen) =>
                        screen.id === interactionBinding.targetScreenId,
                      )?.name ?? "the selected screen"}
                    </p>
                  ) : (
                    <div className="import-code-binding-controls">
                      <select
                        aria-label="Interaction destination"
                        value={targetScreenId}
                        onChange={(event) => setTargetScreenId(event.currentTarget.value)}
                      >
                        <option value="">Choose destination</option>
                        {screens.filter((screen) => screen.id !== sourceScreenId).map((screen) => (
                          <option key={screen.id} value={screen.id}>{screen.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={!targetScreenId || !screens.some((screen) =>
                          screen.id === targetScreenId && screen.id !== sourceScreenId,
                        )}
                        onClick={() => setInteractionBinding({
                          nodeId: selectedDomNode.nodeId,
                          targetScreenId,
                        })}
                      >
                        Bind onClick navigation
                      </button>
                    </div>
                  )}
                  {interactionBinding && interactionBinding.nodeId !== selectedDomNode.nodeId && (
                    <p className="import-code-binding-status">
                      Another element is already bound. Binding this element will replace it.
                    </p>
                  )}
                </>
              ) : (
                <p>Enable Inspect elements, then click an HTML element to bind a ProtoFlow action.</p>
              )}
              {screens.filter((screen) => screen.id !== sourceScreenId).length === 0 && (
                <p className="import-code-binding-status">Add another screen before binding navigation.</p>
              )}
            </section>
            <div className="import-code-required-icons" aria-label="Required icons">
              <span>REQUIRED ICONS</span>
              <div>
                {iconAnalysis.requiredIcons.length
                  ? iconAnalysis.requiredIcons.map((name) => {
                    const Icon = IMPORTED_HTML_ICON_REGISTRY[name] ?? FileText;
                    return (
                      <span className="import-code-icon-chip" key={name}>
                        <Icon size={12} aria-hidden="true" />
                        {name}
                      </span>
                    );
                  })
                  : <span className="import-code-no-icons">No semantic icons detected</span>}
                {iconAnalysis.truncated && (
                  <span className="import-code-no-icons">Icon scan limited to 2,000 elements</span>
                )}
                {iconAnalysis.unavailable && (
                  <span className="import-code-no-icons">Source exceeds parser limits</span>
                )}
              </div>
            </div>
          </section>
        </div>

        <footer className="import-code-footer">
          {error && <p className="import-code-error" role="alert">{error}</p>}
          <p>Scripts cannot access ProtoFlow or make network requests from this preview.</p>
          <div>
            <button className="button button-secondary" onClick={onClose}>Cancel</button>
            <button className="button button-primary" onClick={handleRender}>Render on Canvas</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

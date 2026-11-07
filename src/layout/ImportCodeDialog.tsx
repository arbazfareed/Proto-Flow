import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Code2, ShieldCheck, X } from "lucide-react";

export interface ImportedCode {
  html: string;
  css: string;
}

interface ImportCodeDialogProps {
  onClose: () => void;
  onRenderOnCanvas: (code: ImportedCode) => void;
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
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");

export function compileSandboxDocument(html: string, css: string, javascript: string): string {
  const safeCss = css.replace(/<\/style/gi, "<\\/style");
  const safeJavascript = javascript.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
  <meta name="referrer" content="no-referrer">
  <style>${safeCss}</style>
</head>
<body>
${html}
<script>${safeJavascript}</script>
</body>
</html>`;
}

export function ImportCodeDialog({ onClose, onRenderOnCanvas }: ImportCodeDialogProps) {
  const [activeTab, setActiveTab] = useState<"html" | "css" | "js">("html");
  const [html, setHtml] = useState(INITIAL_HTML);
  const [css, setCss] = useState(INITIAL_CSS);
  const [javascript, setJavascript] = useState(INITIAL_JS);
  const [previewDocument, setPreviewDocument] = useState("");
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const activeEditorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    activeEditorRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPreviewDocument(compileSandboxDocument(html, css, javascript));
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [css, html, javascript]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), textarea, iframe',
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
      onRenderOnCanvas({ html, css });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The code could not be rendered on the canvas.");
    }
  };

  const currentValue = activeTab === "html" ? html : activeTab === "css" ? css : javascript;
  const updateCurrentValue = activeTab === "html" ? setHtml : activeTab === "css" ? setCss : setJavascript;

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
              HTML and CSS are mapped to editable canvas elements. JavaScript runs only in the isolated preview.
            </p>
          </section>

          <section className="import-code-preview" aria-label="Live code preview">
            <div className="import-code-preview-heading">
              <span>LIVE PREVIEW</span>
              <span>Updates after 300 ms</span>
            </div>
            <iframe
              title="Sandboxed code preview"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={previewDocument}
            />
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

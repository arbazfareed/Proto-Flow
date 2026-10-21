import { useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Check, Download, FileArchive, X } from "lucide-react";
import { useStore } from "../store";
import { embedProjectAssets } from "../preview/exportAssets";
import {
  generateLocalHtmlArchive,
  localHtmlArchiveBase64,
  localHtmlExportFileName,
} from "../preview/htmlExport";

function downloadArchive(bytes: Uint8Array, fileName: string): void {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function HtmlExportDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((state) => state.project);
  const projectPath = useStore((state) => state.filePath);
  const [includeInteractions, setIncludeInteractions] = useState(true);
  const [includeAssets, setIncludeAssets] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const exportBundle = async () => {
    if (isExporting) return;
    setMessage("");
    setIsError(false);
    setIsExporting(true);
    try {
      const exportProject = await embedProjectAssets(project, projectPath, includeAssets);
      const bytes = await generateLocalHtmlArchive(exportProject, {
        includeInteractions,
        includeAssets,
      });
      const fileName = localHtmlExportFileName(project.name);
      if (isTauri()) {
        const savedPath = await invoke<string | null>("save_html_export", {
          defaultFilename: fileName,
          base64: localHtmlArchiveBase64(bytes),
        });
        if (!savedPath) {
          setMessage("Export canceled.");
          return;
        }
        setMessage(`HTML bundle saved to ${savedPath}`);
      } else {
        downloadArchive(bytes, fileName);
        setMessage("Offline HTML bundle downloaded for free.");
      }
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "The HTML bundle could not be exported.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      className="overlay react-export-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isExporting) onClose();
      }}
    >
      <section
        className="dialog-card html-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="html-export-title"
      >
        <button
          className="icon-button dialog-close"
          aria-label="Close HTML export dialog"
          onClick={onClose}
          disabled={isExporting}
        >
          <X size={17} />
        </button>
        <div className="dialog-icon"><FileArchive size={18} /></div>
        <span className="eyebrow">CLIENT-SIDE • OFFLINE • FREE</span>
        <h2 id="html-export-title">Export HTML bundle</h2>
        <p className="html-export-description">
          Creates a ZIP you can extract and open locally. No cloud request or credits are used.
        </p>
        <fieldset className="react-export-toggles">
          <legend>Include in bundle</legend>
          <label>
            <input
              type="checkbox"
              checked={includeInteractions}
              onChange={(event) => setIncludeInteractions(event.currentTarget.checked)}
            />
            Interaction rules
          </label>
          <label>
            <input
              type="checkbox"
              checked={includeAssets}
              onChange={(event) => setIncludeAssets(event.currentTarget.checked)}
            />
            Embed local images
          </label>
        </fieldset>
        <p className="html-export-summary">
          {project.screens.length} screen{project.screens.length === 1 ? "" : "s"} · 0 credits · no upload
        </p>
        <div className="react-export-actions">
          <button
            className="button button-primary"
            onClick={() => void exportBundle()}
            disabled={isExporting}
          >
            {isExporting ? <Download size={14} /> : <FileArchive size={14} />}
            {isExporting ? "Preparing bundle…" : isTauri() ? "Save HTML bundle" : "Download HTML bundle"}
          </button>
        </div>
        {message && (
          <p className="react-export-message" role={isError ? "alert" : "status"}>
            {!isError && !message.startsWith("Export canceled.") && <Check size={14} />}
            {message}
          </p>
        )}
        <p className="react-export-help">
          The ZIP contains <code>index.html</code>, <code>runtime.js</code>, <code>style.css</code>, and an <code>assets/</code> folder.
          Remote images are not downloaded so the export stays offline and private.
        </p>
      </section>
    </div>
  );
}

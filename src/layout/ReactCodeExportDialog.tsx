import { useMemo, useState } from "react";
import { Code2, Download, X } from "lucide-react";
import { useStore } from "../store";
import { embedProjectAssets } from "../preview/exportAssets";
import {
  encodeProjectForCodeExport,
  generateSingleFileJsx,
  prepareExportProject,
  type CodeExportOptions,
} from "../preview/codeExport";
import { useMeteredAction } from "../wallet/meteredActions";
import type { ReactCodeArchive } from "../wallet/api";

const MAX_PROJECT_BYTES = 10 * 1024 * 1024;

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadArchive(archive: ReactCodeArchive): void {
  const binary = atob(archive.zipBase64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength !== archive.sizeBytes) {
    throw new Error("The downloaded archive size did not match the server response.");
  }
  downloadBlob(new Blob([bytes], { type: "application/zip" }), archive.fileName);
}

export function ReactCodeExportDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((state) => state.project);
  const projectPath = useStore((state) => state.filePath);
  const activeScreenId = useStore((state) => state.getActiveScreenId());
  const [options, setOptions] = useState<CodeExportOptions>({
    scope: "all",
    screenId: activeScreenId,
    includeInteractions: true,
    includeVariables: true,
    includeAssets: true,
    tailwindVersion: "4",
  });
  const [message, setMessage] = useState("");
  const encodedProject = useMemo(() => encodeProjectForCodeExport(project), [project]);
  const projectBytes = useMemo(
    () => new TextEncoder().encode(JSON.stringify(project)).byteLength,
    [project],
  );
  const payload = useMemo(
    () => ({ projectJson: encodedProject, options }),
    [encodedProject, options],
  );
  const exporter = useMeteredAction<ReactCodeArchive>("react_tailwind_code_export", payload);
  const statusMessage = message || exporter.error;
  const statusIsError = !message && exporter.error !== null;

  const updateOption = <K extends keyof CodeExportOptions>(
    key: K,
    value: CodeExportOptions[K],
  ) => setOptions((current) => ({ ...current, [key]: value }));

  const exportZip = async () => {
    setMessage("");
    let projectJson: string;
    try {
      const exportProject = await embedProjectAssets(project, projectPath, options.includeAssets);
      projectJson = encodeProjectForCodeExport(exportProject);
      if (Math.floor((projectJson.length * 3) / 4) > MAX_PROJECT_BYTES) {
        setMessage("The project and embedded assets exceed the 10 MiB export limit.");
        return;
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Project assets could not be prepared for export.");
      return;
    }
    const archive = await exporter.run({ projectJson, options });
    if (!archive) return;
    try {
      downloadArchive(archive);
      setMessage("React project ZIP downloaded.");
    } catch (error) {
      console.error("The generated React project could not be downloaded.", error);
      setMessage(error instanceof Error ? error.message : "The React project could not be downloaded.");
    }
  };

  const exportJsx = async () => {
    setMessage("");
    try {
      const projectWithAssets = await embedProjectAssets(project, projectPath, options.includeAssets);
      const selectedProject = prepareExportProject(projectWithAssets, options);
      const screenName = selectedProject.screens.length === 1
        ? selectedProject.screens[0].name
        : selectedProject.name;
      const safeName = screenName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "prototype";
      downloadBlob(new Blob([generateSingleFileJsx(selectedProject)], { type: "text/tsx;charset=utf-8" }), `${safeName}.tsx`);
      setMessage("Single-file JSX downloaded for free.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The JSX file could not be generated.");
    }
  };

  return (
    <div className="overlay react-export-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="dialog-card react-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="react-export-title"
      >
        <button className="icon-button dialog-close" aria-label="Close React export dialog" onClick={onClose}>
          <X size={17} />
        </button>
        <div className="dialog-icon"><Code2 size={18} /></div>
        <span className="eyebrow">GENERATE A RUNNABLE PROJECT</span>
        <h2 id="react-export-title">Export React code</h2>
        <label htmlFor="react-export-scope">Export scope</label>
        <select
          id="react-export-scope"
          value={options.scope}
          onChange={(event) => updateOption("scope", event.currentTarget.value as CodeExportOptions["scope"])}
        >
          <option value="all">All screens</option>
          <option value="current">Current screen only</option>
        </select>
        {options.scope === "current" && (
          <label className="react-export-screen-picker">
            Screen
            <select
              aria-label="Export screen"
              value={options.screenId ?? activeScreenId}
              onChange={(event) => updateOption("screenId", event.currentTarget.value)}
            >
              {project.screens.map((screen) => <option key={screen.id} value={screen.id}>{screen.name}</option>)}
            </select>
          </label>
        )}
        <label htmlFor="react-export-tailwind">Tailwind CSS version</label>
        <select
          id="react-export-tailwind"
          value={options.tailwindVersion}
          onChange={(event) => updateOption("tailwindVersion", event.currentTarget.value as CodeExportOptions["tailwindVersion"])}
        >
          <option value="4">Tailwind CSS 4</option>
          <option value="3">Tailwind CSS 3</option>
        </select>
        <fieldset className="react-export-toggles">
          <legend>Include in export</legend>
          <label><input type="checkbox" checked={options.includeInteractions} onChange={(event) => updateOption("includeInteractions", event.currentTarget.checked)} /> Interactions</label>
          <label><input type="checkbox" checked={options.includeVariables} onChange={(event) => updateOption("includeVariables", event.currentTarget.checked)} /> Variables</label>
          <label><input type="checkbox" checked={options.includeAssets} onChange={(event) => updateOption("includeAssets", event.currentTarget.checked)} /> Embedded assets</label>
        </fieldset>
        <p className="react-export-summary">
          {project.screens.length} screen{project.screens.length === 1 ? "" : "s"} · {(projectBytes / 1024).toFixed(1)} KiB project · ZIP export costs 3 credits
        </p>
        <div className="react-export-actions">
          <button
            className="button button-primary"
            onClick={() => void exportZip()}
            disabled={exporter.isRunning || projectBytes > MAX_PROJECT_BYTES}
          >
            <Download size={14} /> {exporter.isRunning ? "Generating ZIP…" : "Download project ZIP (3 credits)"}
          </button>
          <button className="button button-secondary" onClick={exportJsx} disabled={projectBytes > MAX_PROJECT_BYTES}>
            Export as JSX (free)
          </button>
        </div>
        {projectBytes > MAX_PROJECT_BYTES && <p role="alert">This project exceeds the 10 MiB export limit.</p>}
        {statusMessage && <p className="react-export-message" role={statusIsError ? "alert" : "status"}>{statusMessage}</p>}
        <p className="react-export-help">The ZIP contains a Vite + React + TypeScript + Tailwind project. After extracting it, run <code>npm install</code> and <code>npm run dev</code>.</p>
      </section>
    </div>
  );
}

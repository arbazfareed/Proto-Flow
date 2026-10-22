import { useEffect, useMemo, useRef, useState } from "react";
import { Download, PackagePlus, Puzzle, Trash2, X } from "lucide-react";
import type { Project, Widget } from "../project/schema";
import { useStore } from "../store";
import {
  listInstalledPlugins,
  installPluginArchive,
  readPluginArchive,
  setPluginEnabled,
  uninstallPlugin,
} from "../plugins/storage";
import type { InstalledPlugin } from "../plugins/manifest";
import { PluginSandbox, type PluginExtension } from "../plugins/runtime";

interface ActiveSandbox {
  sandbox: PluginSandbox;
  extensions: PluginExtension[];
  logs: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Plugin operation failed.";
}

function safeFilename(value: string): string {
  const filename = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 120);
  return filename || "plugin-export.txt";
}

function createShape(extension: PluginExtension): void {
  const definition = extension.definition;
  const kind = definition.kind;
  const widgetType = kind === "ellipse" ? "ellipse" : kind === "text" ? "text" : "rectangle";
  const width = typeof definition.width === "number" ? definition.width : 160;
  const height = typeof definition.height === "number" ? definition.height : 100;
  const current = useStore.getState();
  const screenId = current.getActiveScreenId();
  const project: Project = {
    ...current.project,
    updatedAt: new Date().toISOString(),
    screens: current.project.screens.map((screen) => {
      if (screen.id !== screenId) return screen;
      const widget: Widget = {
        id: crypto.randomUUID(),
        type: widgetType,
        name: extension.label,
        x: 60,
        y: 60,
        width,
        height,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: screen.widgets.length,
        style: {
          fill: typeof definition.fill === "string" ? definition.fill : "#282431",
          stroke: typeof definition.stroke === "string" ? definition.stroke : "#a78bfa",
          strokeWidth: 1,
          cornerRadius: 8,
        },
        props: kind === "text"
          ? { text: typeof definition.text === "string" ? definition.text.slice(0, 10_000) : extension.label, fontSize: 24 }
          : {},
      };
      return { ...screen, widgets: [...screen.widgets, widget] };
    }),
  };
  current.setProject(project);
}

export function PluginManagerDialog({ onClose }: { onClose: () => void }) {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [active, setActive] = useState<Record<string, ActiveSandbox>>({});
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingManifest, setPendingManifest] = useState<InstalledPlugin["manifest"] | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiOutput, setAiOutput] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const hostRef = useRef<HTMLDivElement>(null);
  const project = useStore((state) => state.project);

  const reload = () => {
    try {
      setPlugins(listInstalledPlugins());
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  useEffect(() => reload(), []);

  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;
    const sandboxes = new Map<string, PluginSandbox>();
    const publish = (pluginId: string) => {
      const sandbox = sandboxes.get(pluginId);
      if (!sandbox) return;
      setActive((current) => ({
        ...current,
        [pluginId]: {
          sandbox,
          extensions: sandbox.getExtensions(),
          logs: sandbox.getLogs(),
        },
      }));
    };
    for (const plugin of plugins.filter((item) => item.enabled)) {
      const sandbox = new PluginSandbox(
        plugin,
        container,
        () => publish(plugin.manifest.id),
        (eventName, callback) => {
          if (eventName !== "project:changed") return () => {};
          return useStore.subscribe((state, previous) => {
            if (state.project !== previous.project) callback(state.project);
          });
        },
      );
      sandboxes.set(plugin.manifest.id, sandbox);
      sandbox.subscribe(() => publish(plugin.manifest.id));
    }
    setActive({});
    return () => {
      sandboxes.forEach((sandbox) => sandbox.close());
      container.replaceChildren();
    };
  }, [plugins]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const availableExtensions = useMemo(
    () => Object.entries(active).flatMap(([pluginId, runtime]) =>
      runtime.extensions.map((extension) => ({ pluginId, runtime, extension })),
    ),
    [active],
  );

  const choosePlugin = async (file: File | undefined) => {
    if (!file) return;
    setNotice("");
    setPendingFile(file);
    try {
      const plugin = await readPluginArchive(file);
      setPendingManifest(plugin.manifest);
    } catch (error) {
      setPendingFile(null);
      setPendingManifest(null);
      setNotice(errorMessage(error));
    }
  };

  const install = async () => {
    if (!pendingFile || !pendingManifest) return;
    setBusy("install");
    try {
      await installPluginArchive(pendingFile);
      setPendingFile(null);
      setPendingManifest(null);
      reload();
      setNotice(`Installed ${pendingManifest.name}. Enable it to start its sandbox.`);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy("");
    }
  };

  const changeEnabled = (plugin: InstalledPlugin, enabled: boolean) => {
    try {
      setPluginEnabled(plugin.manifest.id, enabled);
      reload();
      setNotice(enabled ? `${plugin.manifest.name} enabled.` : `${plugin.manifest.name} disabled.`);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  const removePlugin = (plugin: InstalledPlugin) => {
    try {
      uninstallPlugin(plugin.manifest.id);
      reload();
      setNotice(`${plugin.manifest.name} uninstalled.`);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  const invokeExtension = async (
    pluginId: string,
    runtime: PluginSandbox,
    extension: PluginExtension,
  ) => {
    setBusy(`${pluginId}:${extension.id}`);
    setNotice("");
    try {
      if (extension.kind === "shape") {
        createShape(extension);
      } else if (extension.kind === "exporter") {
        const result = await runtime.invoke(extension.kind, extension.id, project);
        if (
          typeof result !== "object" || result === null ||
          !("content" in result) || typeof result.content !== "string" ||
          !("filename" in result) || typeof result.filename !== "string"
        ) throw new Error("Exporter must return a filename and text content.");
        if (new TextEncoder().encode(result.content).byteLength > 5 * 1024 * 1024) {
          throw new Error("Plugin exports cannot exceed 5 MiB.");
        }
        const mime = "mimeType" in result && typeof result.mimeType === "string"
          ? result.mimeType.slice(0, 100)
          : "text/plain";
        const blobUrl = URL.createObjectURL(new Blob([result.content], { type: mime }));
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = safeFilename(result.filename);
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        setNotice(`Exported ${link.download}.`);
      } else if (extension.kind === "aiProvider") {
        const result = await runtime.invoke(extension.kind, extension.id, { prompt: aiPrompt });
        if (typeof result !== "object" || result === null || !("text" in result) || typeof result.text !== "string") {
          throw new Error("AI providers must return a text result.");
        }
        setAiOutput(result.text.slice(0, 20_000));
      } else {
        await runtime.invoke(extension.kind, extension.id, undefined);
        setNotice(`Ran ${extension.label}.`);
      }
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="plugin-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="plugin-dialog" role="dialog" aria-modal="true" aria-labelledby="plugin-dialog-title">
        <header className="plugin-dialog-header">
          <div className="plugin-dialog-icon"><Puzzle size={18} /></div>
          <div>
            <span className="eyebrow">EXTENSIONS</span>
            <h2 id="plugin-dialog-title">Plugin manager</h2>
          </div>
          <button className="icon-button dialog-close" aria-label="Close plugin manager" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="plugin-dialog-content">
          <p>Plugins run in an isolated iframe. They cannot access wallet credentials, JWTs, native APIs, or network connections. Only explicitly granted project data is sent to an extension.</p>
          <label className="button button-secondary plugin-install-button">
            <PackagePlus size={14} /> Choose .pflow-plugin
            <input
              type="file"
              accept=".pflow-plugin,application/zip"
              aria-label="Choose a .pflow-plugin archive"
              onChange={(event) => void choosePlugin(event.currentTarget.files?.[0])}
            />
          </label>
          {pendingManifest && (
            <section className="plugin-consent" aria-label="Plugin permissions">
              <strong>Install {pendingManifest.name}?</strong>
              <span>By {pendingManifest.author} · version {pendingManifest.version}</span>
              <span>Requested permissions: {pendingManifest.permissions.length
                ? pendingManifest.permissions.join(", ")
                : "none"}</span>
              <div className="dialog-actions">
                <button className="button button-quiet" onClick={() => { setPendingFile(null); setPendingManifest(null); }}>Cancel</button>
                <button className="button button-primary" disabled={busy === "install"} onClick={() => void install()}>Install</button>
              </div>
            </section>
          )}
          <div className="plugin-list">
            {plugins.length === 0 && <p className="plugin-empty">No plugins installed.</p>}
            {plugins.map((plugin) => (
              <article className="plugin-card" key={plugin.manifest.id}>
                <div className="plugin-card-heading">
                  <div><strong>{plugin.manifest.name}</strong><span>{plugin.manifest.id} · v{plugin.manifest.version}</span></div>
                  <label className="plugin-toggle">
                    <input
                      type="checkbox"
                      checked={plugin.enabled}
                      onChange={(event) => changeEnabled(plugin, event.currentTarget.checked)}
                      aria-label={`${plugin.enabled ? "Disable" : "Enable"} ${plugin.manifest.name}`}
                    />
                    <span>{plugin.enabled ? "Enabled" : "Disabled"}</span>
                  </label>
                </div>
                <div className="plugin-permissions">
                  {plugin.manifest.permissions.length
                    ? plugin.manifest.permissions.map((permission) => <span key={permission}>{permission}</span>)
                    : <span>No permissions</span>}
                </div>
                <button className="button button-quiet plugin-uninstall" onClick={() => removePlugin(plugin)}>
                  <Trash2 size={13} /> Uninstall
                </button>
                {active[plugin.manifest.id] && (
                  <div className="plugin-log" role="log" aria-label={`${plugin.manifest.name} plugin activity`}>
                    {active[plugin.manifest.id].logs.slice(-5).map((line, index) => <span key={`${line}:${index}`}>{line}</span>)}
                  </div>
                )}
              </article>
            ))}
          </div>
          {availableExtensions.map(({ pluginId, runtime, extension }) => (
            <div className="plugin-extension" key={`${pluginId}:${extension.kind}:${extension.id}`}>
              <span><strong>{extension.label}</strong><small>{extension.kind} · {pluginId}</small></span>
              {extension.kind === "aiProvider" && (
                <input aria-label={`${extension.label} prompt`} value={aiPrompt} onChange={(event) => setAiPrompt(event.currentTarget.value)} placeholder="Prompt" />
              )}
              <button
                className="button button-secondary"
                disabled={Boolean(busy)}
                onClick={() => void invokeExtension(pluginId, runtime.sandbox, extension)}
              >
                {extension.kind === "shape" ? "Add to canvas" : extension.kind === "exporter" ? <><Download size={13} /> Export</> : extension.kind === "aiProvider" ? "Generate" : "Run"}
              </button>
            </div>
          ))}
          {aiOutput && <pre className="plugin-ai-output">{aiOutput}</pre>}
          <p className="plugin-security-note">Unsigned plugins can only be installed during development. Production signing keys, package publishing, and the Cloudflare revocation list require deployment configuration and are not enabled.</p>
          {notice && <p className="plugin-notice" role="status">{notice}</p>}
        </div>
        <div ref={hostRef} className="plugin-sandbox-host" aria-hidden="true" />
      </section>
    </div>
  );
}

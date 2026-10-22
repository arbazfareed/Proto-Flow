import type { InstalledPlugin, PluginPermission } from "./manifest";

export type PluginExtensionKind = "shape" | "exporter" | "aiProvider" | "command";

export interface PluginExtension {
  kind: PluginExtensionKind;
  id: string;
  label: string;
  definition: Record<string, unknown>;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: number;
}

const MESSAGE_CHANNEL = "protoflow-plugin-v1";
const MAX_PLUGIN_MESSAGE_BYTES = 5 * 1024 * 1024;
const MAX_PLUGIN_EXTENSIONS = 50;
const EXTENSION_PERMISSIONS: Record<PluginExtensionKind, PluginPermission> = {
  shape: "canvas:write",
  exporter: "export:write",
  aiProvider: "ai:generate",
  command: "commands:run",
};

export function hasPluginPermission(
  plugin: InstalledPlugin,
  extension: PluginExtension,
): boolean {
  return plugin.manifest.permissions.includes(EXTENSION_PERMISSIONS[extension.kind]);
}

function toBase64(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function makeSandboxDocument(source: string): string {
  const encodedSource = toBase64(source);
  const bootstrap = `
    const channel = ${JSON.stringify(MESSAGE_CHANNEL)};
    try {
      const source = new TextDecoder().decode(Uint8Array.from(atob(${JSON.stringify(encodedSource)}), (c) => c.charCodeAt(0)));
      new Function(source)();
      parent.postMessage({ channel, type: "ready" }, "*");
    } catch (error) {
      parent.postMessage({ channel, type: "error", message: String(error?.message || "Plugin startup failed.").slice(0, 500) }, "*");
    }
  `;
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'"><script>${bootstrap}</script>`;
}

function parseSerializedBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return 0;
  return new TextEncoder().encode(serialized).byteLength;
}

export function parsePluginExtension(kind: unknown, definition: unknown): PluginExtension {
  if (!["shape", "exporter", "aiProvider", "command"].includes(String(kind))) {
    throw new Error("Plugin registered an unsupported extension type.");
  }
  if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
    throw new Error("Plugin registered an invalid extension definition.");
  }
  const record = definition as Record<string, unknown>;
  const allowedKeys = kind === "shape"
    ? new Set(["id", "label", "kind", "width", "height", "fill", "stroke", "text"])
    : new Set(["id", "label"]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new Error("Plugin extension contains unsupported fields.");
  }
  if (
    typeof record.id !== "string" ||
    !/^[a-z0-9][a-z0-9.-]{0,79}$/.test(record.id) ||
    typeof record.label !== "string" ||
    record.label.trim().length === 0 ||
    record.label.length > 80
  ) throw new Error("Plugin extension IDs and labels must be valid.");
  if (kind === "shape") {
    if (!["rectangle", "ellipse", "text"].includes(String(record.kind))) {
      throw new Error("Custom shapes must use rectangle, ellipse, or text primitives.");
    }
    for (const dimension of ["width", "height"]) {
      const value = record[dimension];
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 4096)) {
        throw new Error(`Custom shape ${dimension} must be between 1 and 4096.`);
      }
    }
    for (const color of ["fill", "stroke"]) {
      const value = record[color];
      if (
        value !== undefined &&
        (typeof value !== "string" || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value))
      ) {
        throw new Error(`Custom shape ${color} must be a hex color.`);
      }
    }
    if (record.text !== undefined && (typeof record.text !== "string" || record.text.length > 10_000)) {
      throw new Error("Custom shape text must be 10,000 characters or fewer.");
    }
  }
  return {
    kind: kind as PluginExtensionKind,
    id: record.id,
    label: record.label.trim(),
    definition: record,
  };
}

export class PluginSandbox {
  private readonly frame: HTMLIFrameElement;
  private readonly pending = new Map<string, PendingCall>();
  private readonly extensions = new Map<string, PluginExtension>();
  private readonly listeners = new Set<() => void>();
  private readonly logs: string[] = [];
  private readonly subscriptions = new Set<string>();
  private snapshot: PluginExtension[] = [];
  private readonly onLog: (message: string) => void;
  private readonly onEvent: (event: string, callback: (payload: unknown) => void) => () => void;
  private readonly eventUnsubscribers: Array<() => void> = [];
  private disposed = false;
  readonly plugin: InstalledPlugin;

  constructor(
    plugin: InstalledPlugin,
    container: HTMLElement,
    onLog: (message: string) => void,
    onEvent: (event: string, callback: (payload: unknown) => void) => () => void,
  ) {
    this.plugin = plugin;
    this.onLog = onLog;
    this.onEvent = onEvent;
    this.frame = document.createElement("iframe");
    this.frame.title = `Plugin sandbox: ${plugin.manifest.name}`;
    this.frame.setAttribute("sandbox", "allow-scripts");
    this.frame.setAttribute("aria-hidden", "true");
    this.frame.tabIndex = -1;
    this.frame.style.cssText = "position:absolute;width:1px;height:1px;border:0;left:-10000px";
    this.frame.srcdoc = makeSandboxDocument(plugin.source);
    this.frame.addEventListener("load", this.onLoad);
    window.addEventListener("message", this.onMessage);
    container.append(this.frame);
  }

  private readonly onLoad = (): void => {
    this.record("Sandbox loaded.");
    this.frame.contentWindow?.postMessage(
      { channel: MESSAGE_CHANNEL, type: "event", name: "app:ready", payload: {} },
      "*",
    );
  };

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== this.frame.contentWindow || typeof event.data !== "object" || event.data === null) return;
    const message = event.data as Record<string, unknown>;
    if (message.channel !== MESSAGE_CHANNEL || typeof message.type !== "string") return;
    try {
      if (parseSerializedBytes(message) > MAX_PLUGIN_MESSAGE_BYTES) {
        throw new Error("Plugin message exceeded the 5 MiB limit.");
      }
    } catch (error) {
      const pending = typeof message.requestId === "string" ? this.pending.get(message.requestId) : undefined;
      if (pending && typeof message.requestId === "string") {
        window.clearTimeout(pending.timeout);
        this.pending.delete(message.requestId);
        pending.reject(error instanceof Error ? error : new Error("Plugin sent an invalid response."));
      }
      this.record(error instanceof Error ? error.message : "Plugin sent an invalid message.", true);
      return;
    }
    if (message.type === "register") {
      try {
        const extension = parsePluginExtension(message.kind, message.definition);
        const permission = EXTENSION_PERMISSIONS[extension.kind];
        if (!hasPluginPermission(this.plugin, extension)) {
          throw new Error(`Missing "${permission}" permission for ${extension.kind}.`);
        }
        const key = `${extension.kind}:${extension.id}`;
        if (this.extensions.has(key)) throw new Error(`Duplicate extension "${extension.id}".`);
        if (this.extensions.size >= MAX_PLUGIN_EXTENSIONS) throw new Error("Plugins may register at most 50 extensions.");
        this.extensions.set(key, extension);
        this.snapshot = [...this.extensions.values()];
        this.record(`Registered ${extension.kind}: ${extension.label}`);
        this.listeners.forEach((listener) => listener());
      } catch (error) {
        this.record(error instanceof Error ? error.message : "Plugin registration failed.", true);
      }
    } else if (message.type === "subscribe" && typeof message.event === "string") {
      if (message.event === "app:ready" && !this.subscriptions.has(message.event)) {
        this.subscriptions.add(message.event);
      } else if (
        message.event === "project:changed" &&
        this.plugin.manifest.permissions.includes("project:read") &&
        !this.subscriptions.has(message.event)
      ) {
        this.subscriptions.add(message.event);
        this.eventUnsubscribers.push(this.onEvent(message.event, (payload) => this.sendEvent(message.event as string, payload)));
      } else if (!["app:ready", "project:changed"].includes(message.event)) {
        this.record(`Unsupported event subscription: ${message.event}`, true);
      }
    } else if (message.type === "result" && typeof message.requestId === "string") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      window.clearTimeout(pending.timeout);
      this.pending.delete(message.requestId);
      if (typeof message.error === "string") pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    } else if (message.type === "error") {
      this.record(typeof message.message === "string" ? message.message : "Plugin startup failed.", true);
    } else if (message.type === "ready") {
      this.record("Plugin ready.");
    }
  };

  private record(message: string, isError = false): void {
    const entry = `${new Date().toLocaleTimeString()} ${isError ? "ERROR " : ""}${message}`;
    this.logs.push(entry);
    if (this.logs.length > 100) this.logs.shift();
    this.onLog(entry);
  }

  private sendEvent(name: string, payload: unknown): void {
    if (parseSerializedBytes(payload) > MAX_PLUGIN_MESSAGE_BYTES) {
      this.record("Project change event exceeded the 5 MiB limit.", true);
      return;
    }
    this.frame.contentWindow?.postMessage({ channel: MESSAGE_CHANNEL, type: "event", name, payload }, "*");
  }

  getExtensions(): PluginExtension[] {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  invoke(kind: PluginExtensionKind, id: string, payload: unknown): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error("Plugin sandbox is closed."));
    if (!this.extensions.has(`${kind}:${id}`)) {
      return Promise.reject(new Error("This plugin extension is not registered."));
    }
    if (parseSerializedBytes(payload) > MAX_PLUGIN_MESSAGE_BYTES) {
      return Promise.reject(new Error("Data sent to a plugin cannot exceed 5 MiB."));
    }
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Plugin did not respond within 15 seconds."));
      }, 15_000);
      this.pending.set(requestId, { resolve, reject, timeout });
      this.frame.contentWindow?.postMessage({
        channel: MESSAGE_CHANNEL,
        type: "invoke",
        requestId,
        kind,
        id,
        payload,
      }, "*");
    });
  }

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("message", this.onMessage);
    this.frame.removeEventListener("load", this.onLoad);
    this.eventUnsubscribers.forEach((unsubscribe) => unsubscribe());
    this.pending.forEach((pending) => {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error("Plugin sandbox was closed."));
    });
    this.pending.clear();
    this.frame.remove();
  }
}

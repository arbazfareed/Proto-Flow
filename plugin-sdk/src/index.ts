export type PluginPermission =
  | "canvas:write"
  | "export:write"
  | "ai:generate"
  | "commands:run"
  | "project:read";

export type PluginShapeKind = "rectangle" | "ellipse" | "text";

export interface PluginShape {
  id: string;
  label: string;
  kind: PluginShapeKind;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  text?: string;
}

export interface PluginExporter {
  id: string;
  label: string;
}

export interface PluginAIProvider {
  id: string;
  label: string;
}

export interface PluginCommand {
  id: string;
  label: string;
}

export interface PluginProject {
  id: string;
  name: string;
  screens: Array<{
    id: string;
    name: string;
    widgets: Array<Record<string, unknown>>;
  }>;
}

export interface PluginExportResult {
  filename: string;
  content: string;
  mimeType?: string;
}

type PluginHandler<TInput, TOutput> = (input: TInput) => TOutput | Promise<TOutput>;

type PluginMessage =
  | { type: "register"; kind: string; definition: Record<string, unknown> }
  | { type: "result"; requestId: string; result?: unknown; error?: string }
  | { type: "event"; name: string; payload: unknown };

const handlers = new Map<string, PluginHandler<unknown, unknown>>();
const eventHandlers = new Map<string, Set<(payload: unknown) => void>>();

function send(message: Record<string, unknown>): void {
  if (typeof window === "undefined" || window.parent === window) {
    throw new Error("ProtoFlow plugins must run inside the ProtoFlow sandbox.");
  }
  window.parent.postMessage({ channel: "protoflow-plugin-v1", ...message }, "*");
}

function register<TInput, TOutput>(
  kind: string,
  definition: { id: string } & object,
  handler?: PluginHandler<TInput, TOutput>,
): void {
  if (!definition.id) throw new Error("Plugin extension IDs are required.");
  if (handler) {
    if (handlers.has(`${kind}:${definition.id}`)) throw new Error(`Duplicate ${kind} ID "${definition.id}".`);
    handlers.set(`${kind}:${definition.id}`, handler as PluginHandler<unknown, unknown>);
  }
  send({ type: "register", kind, definition: { ...definition } });
}

if (typeof window !== "undefined" && window.parent !== window) {
  window.addEventListener("message", (event: MessageEvent<PluginMessage | Record<string, unknown>>) => {
    const message = event.data as Record<string, unknown>;
    if (event.source !== window.parent || message.channel !== "protoflow-plugin-v1") return;
    if (message.type === "invoke") {
      const handler = handlers.get(`${message.kind}:${message.id}`);
      if (!handler) {
        send({ type: "result", requestId: message.requestId, error: "Extension handler is unavailable." });
        return;
      }
      void Promise.resolve(handler(message.payload)).then(
        (result) => send({ type: "result", requestId: message.requestId, result }),
        (error: unknown) => send({
          type: "result",
          requestId: message.requestId,
          error: error instanceof Error ? error.message.slice(0, 500) : "Plugin handler failed.",
        }),
      );
    } else if (message.type === "event" && typeof message.name === "string") {
      eventHandlers.get(message.name)?.forEach((handler) => handler(message.payload));
    }
  });
}

export function registerShape(shape: PluginShape): void {
  register("shape", shape);
}

export function registerExporter(
  exporter: PluginExporter,
  handler: PluginHandler<PluginProject, PluginExportResult>,
): void {
  register("exporter", exporter, handler);
}

export function registerAIProvider(
  provider: PluginAIProvider,
  handler: PluginHandler<{ prompt: string }, { text: string }>,
): void {
  register("aiProvider", provider, handler);
}

export function registerCommand(
  command: PluginCommand,
  handler: PluginHandler<void, void>,
): void {
  register("command", command, handler);
}

export function on(
  event: "app:ready" | "project:changed",
  handler: (payload: unknown) => void,
): () => void {
  const handlersForEvent = eventHandlers.get(event) ?? new Set();
  handlersForEvent.add(handler);
  eventHandlers.set(event, handlersForEvent);
  send({ type: "subscribe", event });
  return () => handlersForEvent.delete(handler);
}

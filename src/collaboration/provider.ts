import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { parseProject, type Project } from "../project/schema";

export interface Collaborator {
  clientId: number;
  accountId: string;
  name: string;
  color: string;
  role: "host" | "editor" | "viewer";
  cursor: { x: number; y: number } | null;
  cursorUpdatedAt: number;
  selection: { screenId: string | null; widgetIds: string[] };
  lastUpdated: number;
}

export interface CollaborationProviderOptions {
  displayName: string;
  accountId: string;
  color: string;
  isHost: boolean;
  getSocketUrl: () => Promise<string>;
  onProject: (project: Project) => void;
  onPresence: (collaborators: Collaborator[]) => void;
  onStatus: (status: "connecting" | "connected" | "disconnected" | "ended") => void;
  onPermissions: (viewOnly: boolean) => void;
  setPermissions: (viewOnly: boolean) => Promise<void>;
  onError: (error: Error) => void;
}

const LOCAL_PROJECT_ORIGIN = Symbol("local-project");
const REMOTE_SOCKET_ORIGIN = Symbol("remote-socket");
const MAX_RECONNECT_DELAY_MS = 30_000;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function createYValue(value: unknown): unknown {
  if (Array.isArray(value)) return new Y.Array<unknown>();
  if (typeof value === "object" && value !== null) return new Y.Map<unknown>();
  return value;
}

function syncYMap(target: Y.Map<unknown>, source: Record<string, unknown>): void {
  for (const key of target.keys()) {
    if (!Object.hasOwn(source, key)) target.delete(key);
  }
  for (const [key, value] of Object.entries(source)) {
    const current = target.get(key);
    if (Array.isArray(value)) {
      const array = current instanceof Y.Array ? current : new Y.Array<unknown>();
      if (array !== current) target.set(key, array);
      syncYArray(array, value);
    } else if (typeof value === "object" && value !== null) {
      const map = current instanceof Y.Map ? current : new Y.Map<unknown>();
      if (map !== current) target.set(key, map);
      syncYMap(map, value as Record<string, unknown>);
    } else if (current !== value) {
      target.set(key, value);
    }
  }
}

function syncYArray(target: Y.Array<unknown>, source: unknown[]): void {
  const current = target.toArray();
  if (source.every((value) => typeof value === "object" && value !== null && "id" in value)) {
    const byId = new Map(current.map((value) => [
      value instanceof Y.Map ? value.get("id") : undefined,
      value,
    ] as const));
    const next = source.map((value) => {
      const item = byId.get((value as { id: unknown }).id);
      return item instanceof Y.Map ? item : new Y.Map<unknown>();
    });
    if (current.length !== next.length || current.some((item, index) => item !== next[index])) {
      if (current.length > 0) target.delete(0, current.length);
      if (next.length > 0) target.insert(0, next);
    }
    source.forEach((value, index) => {
      const item = target.get(index);
      if (item instanceof Y.Map) syncYMap(item, value as Record<string, unknown>);
    });
    return;
  }
  if (current.length !== source.length) {
    if (current.length > 0) target.delete(0, current.length);
    if (source.length > 0) target.insert(0, source.map(createYValue));
  }
  source.forEach((value, index) => {
    let existing = target.get(index);
    const needsArray = Array.isArray(value);
    const needsMap = typeof value === "object" && value !== null && !Array.isArray(value);
    if ((needsArray && !(existing instanceof Y.Array)) || (needsMap && !(existing instanceof Y.Map))) {
      const next = createYValue(value);
      target.delete(index);
      target.insert(index, [next]);
      existing = next;
    }
    if (existing instanceof Y.Array && Array.isArray(value)) {
      syncYArray(existing, value);
    } else if (
      existing instanceof Y.Map &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      syncYMap(existing, value as Record<string, unknown>);
    } else if (!needsArray && !needsMap && existing !== value) {
      target.delete(index);
      target.insert(index, [value]);
    }
  });
}

function awarenessMessage(update: Uint8Array): Uint8Array {
  return encoding.encode((encoder) => {
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint8Array(encoder, update);
  });
}

export function syncSharedProject(doc: Y.Doc, project: Project): void {
  const shared = doc.getMap("project");
  doc.transact(() => syncYMap(shared, structuredClone(project)), LOCAL_PROJECT_ORIGIN);
}

export function readSharedProject(doc: Y.Doc): Project {
  return parseProject(doc.getMap("project").toJSON());
}

export class CollaborationProvider {
  private readonly doc = new Y.Doc();
  private readonly awareness = new awarenessProtocol.Awareness(this.doc);
  private readonly project = this.doc.getMap("project");
  private readonly options: CollaborationProviderOptions;
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private closed = false;
  private latestProject = "";
  private viewOnly = false;
  private readonly localUser: Record<string, unknown>;

  constructor(options: CollaborationProviderOptions, initialProject?: Project) {
    this.options = options;
    this.localUser = {
      accountId: options.accountId,
      name: options.displayName,
      color: options.color,
      role: options.isHost ? "host" : "editor",
    };
    if (initialProject) this.updateProject(initialProject);
    this.awareness.setLocalStateField("user", this.localUser);
    this.awareness.setLocalStateField("cursor", null);
    this.awareness.setLocalStateField("selection", { screenId: null, widgetIds: [] });
    this.doc.on("update", (update, origin) => {
      if (origin !== REMOTE_SOCKET_ORIGIN) this.sendSyncUpdate(update);
      const snapshot = this.project.toJSON();
      const serialized = stableJson(snapshot);
      if (serialized === this.latestProject) return;
      try {
        const nextProject = parseProject(snapshot);
        this.latestProject = serialized;
        this.options.onProject(nextProject);
      } catch (error) {
        this.options.onError(
          error instanceof Error ? error : new Error("A collaborator sent an invalid project update."),
        );
      }
    });
    this.awareness.on(
      "update",
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        this.publishPresence();
        if (origin === REMOTE_SOCKET_ORIGIN) return;
        const changed = added.concat(updated, removed);
        if (changed.length > 0) {
          this.send(awarenessMessage(awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)));
        }
      },
    );
    void this.connect();
  }

  updateProject(project: Project): void {
    if (this.viewOnly && !this.options.isHost) {
      try {
        const snapshot = this.project.toJSON();
        const serialized = stableJson(snapshot);
        if (serialized !== stableJson(project)) {
          this.latestProject = serialized;
          this.options.onProject(parseProject(snapshot));
        }
      } catch (error) {
        this.options.onError(
          error instanceof Error ? error : new Error("The view-only project snapshot is invalid."),
        );
      }
      return;
    }
    const nextProject = structuredClone(project);
    this.latestProject = stableJson(nextProject);
    syncSharedProject(this.doc, nextProject);
  }

  updateCursor(cursor: { x: number; y: number } | null): void {
    this.awareness.setLocalStateField("cursor", cursor);
    this.awareness.setLocalStateField("cursorUpdatedAt", Date.now());
  }

  refreshPresence(): void {
    this.awareness.setLocalStateField("heartbeat", Date.now());
  }

  updateSelection(selection: { screenId: string | null; widgetIds: string[] }): void {
    this.awareness.setLocalStateField("selection", selection);
  }

  async setViewOnly(viewOnly: boolean): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Connect to the collaboration session before changing permissions.");
    }
    await this.options.setPermissions(viewOnly);
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.awareness.setLocalState(null);
    clearInterval(this.awareness._checkInterval);
    this.socket?.close(1000, "Collaboration panel closed.");
    this.doc.destroy();
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    this.options.onStatus("connecting");
    try {
      const socket = new WebSocket(await this.options.getSocketUrl());
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      socket.addEventListener("open", () => {
        this.reconnectAttempts = 0;
        this.options.onStatus("connected");
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        syncProtocol.writeSyncStep1(encoder, this.doc);
        this.send(encoding.toUint8Array(encoder));
        const clients = [...this.awareness.getStates().keys()];
        if (clients.length > 0) {
          this.send(awarenessMessage(awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients)));
        }
      });
      socket.addEventListener("message", (event: MessageEvent<ArrayBuffer | string>) => {
        if (typeof event.data === "string") {
          this.handleControlMessage(event.data);
          return;
        }
        this.handleSyncMessage(new Uint8Array(event.data));
      });
      socket.addEventListener("close", () => {
        if (this.closed) return;
        this.options.onStatus("disconnected");
        this.scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        this.options.onError(new Error("The collaboration connection encountered a network error."));
      });
    } catch (error) {
      this.options.onError(error instanceof Error ? error : new Error("Could not connect to collaboration."));
      this.scheduleReconnect();
    }
  }

  private handleSyncMessage(bytes: Uint8Array): void {
    try {
      const decoder = decoding.createDecoder(bytes);
      const messageType = decoding.readVarUint(decoder);
      if (messageType === 0) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, REMOTE_SOCKET_ORIGIN);
        if (encoding.length(encoder) > 1) this.send(encoding.toUint8Array(encoder));
      } else if (messageType === 1) {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          REMOTE_SOCKET_ORIGIN,
        );
      }
    } catch (error) {
      this.options.onError(error instanceof Error ? error : new Error("Received an invalid collaboration update."));
    }
  }

  private handleControlMessage(value: string): void {
    let message: unknown;
    try {
      message = JSON.parse(value);
    } catch {
      this.options.onError(new Error("The collaboration server sent an invalid message."));
      return;
    }
    if (typeof message !== "object" || message === null) return;
    if ("type" in message && message.type === "permissions" && "viewOnly" in message && typeof message.viewOnly === "boolean") {
      this.viewOnly = message.viewOnly;
      this.awareness.setLocalStateField("user", {
        ...this.localUser,
        role: this.options.isHost ? "host" : this.viewOnly ? "viewer" : "editor",
      });
      this.options.onPermissions(this.viewOnly);
    } else if ("type" in message && message.type === "ended") {
      this.options.onStatus("ended");
      this.close();
    }
  }

  private sendSyncUpdate(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  }

  private send(message: Uint8Array | string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    if (typeof message === "string") {
      this.socket.send(message);
      return;
    }
    const buffer = new ArrayBuffer(message.byteLength);
    new Uint8Array(buffer).set(message);
    this.socket.send(buffer);
  }

  private publishPresence(): void {
    const now = Date.now();
    const collaborators = [...this.awareness.getStates()].flatMap(([clientId, state]) => {
      if (clientId === this.doc.clientID || typeof state.user !== "object" || state.user === null) return [];
      const user = state.user as Record<string, unknown>;
      if (
        typeof user.accountId !== "string" ||
        typeof user.name !== "string" ||
        typeof user.color !== "string"
      ) return [];
      const cursor = state.cursor;
      const cursorUpdatedAt = typeof state.cursorUpdatedAt === "number" ? state.cursorUpdatedAt : 0;
      const selection = state.selection;
      const role: Collaborator["role"] =
        user.role === "host" || user.role === "viewer" ? user.role : "editor";
      return [{
        clientId,
        accountId: user.accountId,
        name: user.name,
        color: user.color,
        role,
        cursor:
          typeof cursor === "object" &&
          cursor !== null &&
          "x" in cursor &&
          "y" in cursor &&
          typeof cursor.x === "number" &&
          typeof cursor.y === "number" &&
          now - cursorUpdatedAt < 30_000
            ? { x: cursor.x, y: cursor.y }
            : null,
        cursorUpdatedAt,
        selection:
          typeof selection === "object" &&
          selection !== null &&
          "screenId" in selection &&
          typeof selection.screenId === "string" &&
          "widgetIds" in selection &&
          Array.isArray(selection.widgetIds)
            ? {
                screenId: selection.screenId,
                widgetIds: selection.widgetIds.filter((id: unknown): id is string => typeof id === "string"),
              }
            : { screenId: null, widgetIds: [] },
        lastUpdated: this.awareness.meta.get(clientId)?.lastUpdated ?? now,
      }];
    });
    this.options.onPresence(collaborators);
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}

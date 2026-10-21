import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type { WorkerEnv } from "./env";

const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const SNAPSHOT_INTERVAL_MS = 60_000;
const INACTIVITY_MS = 4 * 60 * 60 * 1000;

interface RoomIdentity {
  accountId: string;
  displayName: string;
  role: "host" | "editor" | "viewer";
}

function identityFor(socket: WebSocket): RoomIdentity {
  const [role, accountId, displayName] = socket.deserializeAttachment() as [
    RoomIdentity["role"],
    string,
    string,
  ];
  return { accountId, displayName, role };
}

export class CollaborationRoom {
  private readonly doc = new Y.Doc();
  private readonly awareness = new awarenessProtocol.Awareness(this.doc);
  private readonly project = this.doc.getMap("project");
  private readonly state: DurableObjectState;
  private readonly env: WorkerEnv;
  private readonly roomId: string;
  private viewOnly = false;
  private loaded = false;
  private lastActivity = Date.now();
  private lastSnapshot = 0;
  private lastActivityWrite = 0;

  constructor(state: DurableObjectState, env: WorkerEnv) {
    this.state = state;
    this.env = env;
    this.roomId = state.id.name ?? "";
    clearInterval(this.awareness._checkInterval);
    this.doc.on("update", (update, origin) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      for (const socket of this.state.getWebSockets()) {
        if (socket !== origin) this.send(socket, message);
      }
    });
    this.awareness.on(
      "update",
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const changed = added.concat(updated, removed);
        if (changed.length === 0) return;
        const message = encoding.encode((encoder) => {
          encoding.writeVarUint(encoder, 1);
          encoding.writeVarUint8Array(
            encoder,
            awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
          );
        });
        for (const socket of this.state.getWebSockets()) {
          if (socket !== origin) this.send(socket, message);
        }
      },
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/connect") return this.connect(request);
    if (url.pathname === "/permissions" && request.method === "POST") {
      return this.updatePermissions(request);
    }
    if (url.pathname === "/end" && request.method === "POST") {
      return this.endSession();
    }
    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message === "string") {
      socket.close(1003, "Invalid collaboration control message.");
      return;
    }
    const bytes =
      new Uint8Array(message);
    if (bytes.byteLength > MAX_MESSAGE_BYTES) {
      socket.close(1009, "Collaboration message is too large.");
      return;
    }
    this.lastActivity = Date.now();
    await this.touchSession();
    await this.state.storage.setAlarm(this.lastActivity + SNAPSHOT_INTERVAL_MS);

    try {
      const decoder = decoding.createDecoder(bytes);
      const messageType = decoding.readVarUint(decoder);
      if (messageType === 0) {
        const syncType = decoding.peekVarUint(decoder);
        const identity = identityFor(socket);
        if (
          syncType === syncProtocol.messageYjsUpdate &&
          this.viewOnly &&
          identity.role !== "host"
        ) {
          this.sendSyncStep1(socket);
          return;
        }
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, socket);
        await this.state.storage.put("documentUpdate", Y.encodeStateAsUpdate(this.doc));
        if (encoding.length(encoder) > 1) this.send(socket, encoding.toUint8Array(encoder));
      } else if (messageType === 1) {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          socket,
        );
      }
    } catch (error) {
      console.warn("Rejected an invalid collaboration message.", {
        roomId: this.roomId,
        message: error instanceof Error ? error.message : "Invalid message.",
      });
      socket.close(1003, "Invalid collaboration message.");
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    this.removePresence(socket);
    try {
      socket.close(1000, "Connection closed.");
    } catch {
      // The peer may already have closed the connection.
    }
    this.lastActivity = Date.now();
    await this.touchSession();
    await this.state.storage.setAlarm(this.lastActivity + SNAPSHOT_INTERVAL_MS);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    this.removePresence(socket);
    try {
      socket.close(1011, "Collaboration connection error.");
    } catch {
      // The peer may already have closed the connection.
    }
  }

  async alarm(): Promise<void> {
    const session = await this.env.DB.prepare(
      "SELECT object_key, ended_at FROM collaboration_sessions WHERE id = ?",
    ).bind(this.roomId).first<{ object_key: string; ended_at: string | null }>();
    if (!session || session.ended_at) return;

    if (Date.now() - this.lastActivity >= INACTIVITY_MS) {
      await this.endSession();
      return;
    }
    await this.writeSnapshot(session.object_key);
    await this.state.storage.setAlarm(this.lastActivity + SNAPSHOT_INTERVAL_MS);
  }

  private async connect(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required.", { status: 426 });
    }
    const room = await this.loadRoom(request.headers.get("X-Collab-Object-Key"));
    if (!room) return new Response("Collaboration session has expired.", { status: 410 });
    const accountId = request.headers.get("X-Collab-Account");
    const role = request.headers.get("X-Collab-Role");
    const displayName = request.headers.get("X-Collab-Name")?.slice(0, 40);
    if (
      !accountId ||
      !displayName ||
      (role !== "host" && role !== "editor" && role !== "viewer")
    ) {
      return new Response("Collaboration identity is invalid.", { status: 401 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment([role, accountId, displayName]);
    this.state.acceptWebSocket(server, [accountId]);
    this.lastActivity = Date.now();
    await this.touchSession();
    await this.state.storage.setAlarm(this.lastActivity + SNAPSHOT_INTERVAL_MS);
    this.send(server, JSON.stringify({ type: "permissions", viewOnly: this.viewOnly }));
    return new Response(null, { status: 101, webSocket: client });
  }

  private async loadRoom(objectKey: string | null): Promise<boolean> {
    if (this.loaded) return true;
    if (!objectKey || !objectKey.startsWith(`collaboration/${this.roomId}/`)) return false;
    const session = await this.env.DB.prepare(
      "SELECT view_only, ended_at, last_activity_at FROM collaboration_sessions WHERE id = ? AND object_key = ?",
    ).bind(this.roomId, objectKey).first<{
      view_only: number;
      ended_at: string | null;
      last_activity_at: string;
    }>();
    if (!session || session.ended_at) return false;

    this.viewOnly = session.view_only === 1;
    this.lastActivity = Date.parse(session.last_activity_at) || Date.now();
    this.lastActivityWrite = this.lastActivity;
    const storedViewOnly = await this.state.storage.get<boolean>("viewOnly");
    if (typeof storedViewOnly === "boolean") this.viewOnly = storedViewOnly;
    const update = await this.state.storage.get<Uint8Array>("documentUpdate");
    if (update) {
      Y.applyUpdate(this.doc, update);
    } else {
      const initial = await this.env.ASSETS.get(objectKey);
      if (!initial) return false;
      const project = await initial.json<unknown>();
      if (typeof project !== "object" || project === null || Array.isArray(project)) return false;
      this.doc.transact(() => setYMap(this.project, project as Record<string, unknown>), "initial");
    }
    this.loaded = true;
    return true;
  }

  private async updatePermissions(request: Request): Promise<Response> {
    if (request.headers.get("X-Collab-Role") !== "host") return new Response("Forbidden.", { status: 403 });
    const body = await request.json<{ viewOnly?: unknown }>().catch(() => null);
    if (!body || typeof body.viewOnly !== "boolean") return new Response("Invalid permissions.", { status: 400 });
    await this.applyPermissions(body.viewOnly);
    return Response.json({ viewOnly: this.viewOnly });
  }

  private async applyPermissions(viewOnly: boolean): Promise<void> {
    this.viewOnly = viewOnly;
    await this.state.storage.put("viewOnly", this.viewOnly);
    const message = JSON.stringify({ type: "permissions", viewOnly: this.viewOnly });
    for (const socket of this.state.getWebSockets()) this.send(socket, message);
  }

  private async endSession(): Promise<Response> {
    const session = await this.env.DB.prepare(
      "SELECT object_key, ended_at FROM collaboration_sessions WHERE id = ?",
    ).bind(this.roomId).first<{ object_key: string; ended_at: string | null }>();
    if (!session) return new Response("Not found.", { status: 404 });
    if (session.ended_at) return Response.json({ ended: true });
    if (!this.loaded && !(await this.loadRoom(session.object_key))) {
      throw new Error("The collaboration project could not be restored for its final snapshot.");
    }
    await this.writeSnapshot(session.object_key, true);
    const endedAt = new Date().toISOString();
    const result = await this.env.DB.prepare(
      "UPDATE collaboration_sessions SET ended_at = ?, last_activity_at = ? WHERE id = ? AND ended_at IS NULL",
    ).bind(endedAt, endedAt, this.roomId).run();
    if (!result.success) throw new Error("Could not end the collaboration session.");
    for (const socket of this.state.getWebSockets()) {
      this.send(socket, JSON.stringify({ type: "ended" }));
      socket.close(1000, "Collaboration session ended.");
    }
    await this.state.storage.deleteAlarm();
    return Response.json({ ended: true });
  }

  private async writeSnapshot(initialObjectKey: string, force = false): Promise<void> {
    if (!this.loaded || (!force && this.lastSnapshot > 0 && Date.now() - this.lastSnapshot < SNAPSHOT_INTERVAL_MS)) return;
    const snapshot = JSON.stringify(this.project.toJSON());
    const objectKey = `${initialObjectKey.replace(/\/initial\.json$/, "")}/versions/${crypto.randomUUID()}.json`;
    await this.env.ASSETS.put(objectKey, snapshot, {
      httpMetadata: { contentType: "application/json" },
    });
    const createdAt = new Date().toISOString();
    const inserted = await this.env.DB.prepare(
      "INSERT INTO collaboration_versions (id, session_id, object_key, created_at, size_bytes) VALUES (?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), this.roomId, objectKey, createdAt, new TextEncoder().encode(snapshot).byteLength).run();
    if (!inserted.success) {
      await this.env.ASSETS.delete(objectKey);
      throw new Error("Could not record the collaboration snapshot.");
    }
    this.lastSnapshot = Date.now();
  }

  private async touchSession(): Promise<void> {
    if (Date.now() - this.lastActivityWrite < 30_000) return;
    const activityAt = new Date(this.lastActivity).toISOString();
    const expiresAt = new Date(this.lastActivity + INACTIVITY_MS).toISOString();
    const result = await this.env.DB.prepare(
      "UPDATE collaboration_sessions SET last_activity_at = ?, expires_at = ? WHERE id = ? AND ended_at IS NULL",
    ).bind(activityAt, expiresAt, this.roomId).run();
    if (!result.success) throw new Error("Could not refresh collaboration session activity.");
    this.lastActivityWrite = Date.now();
  }

  private sendSyncStep1(socket: WebSocket): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(socket, encoding.toUint8Array(encoder));
  }

  private send(socket: WebSocket, message: ArrayBuffer | ArrayBufferView | string): void {
    try {
      socket.send(message);
    } catch {
      // A closed connection is removed by the Durable Object WebSocket lifecycle.
    }
  }

  private removePresence(socket: WebSocket): void {
    const { accountId } = identityFor(socket);
    const clients = [...this.awareness.getStates()].filter(
      ([, state]) => state.user?.accountId === accountId,
    ).map(([clientId]) => clientId);
    if (clients.length > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, clients, socket);
    }
  }
}

function setYMap(target: Y.Map<unknown>, source: Record<string, unknown>): void {
  for (const key of target.keys()) {
    if (!Object.hasOwn(source, key)) target.delete(key);
  }
  for (const [key, value] of Object.entries(source)) {
    const current = target.get(key);
    if (Array.isArray(value)) {
      const array = current instanceof Y.Array ? current : new Y.Array<unknown>();
      if (array !== current) target.set(key, array);
      setYArray(array, value);
    } else if (typeof value === "object" && value !== null) {
      const map = current instanceof Y.Map ? current : new Y.Map<unknown>();
      if (map !== current) target.set(key, map);
      setYMap(map, value as Record<string, unknown>);
    } else if (current !== value) {
      target.set(key, value);
    }
  }
}

function createYValue(value: unknown): unknown {
  if (Array.isArray(value)) return new Y.Array<unknown>();
  if (typeof value === "object" && value !== null) return new Y.Map<unknown>();
  return value;
}

function syncYValue(current: unknown, value: unknown): unknown {
  if (Array.isArray(value)) {
    const array = current instanceof Y.Array ? current : new Y.Array<unknown>();
    setYArray(array, value);
    return array;
  }
  if (typeof value === "object" && value !== null) {
    const map = current instanceof Y.Map ? current : new Y.Map<unknown>();
    setYMap(map, value as Record<string, unknown>);
    return map;
  }
  return value;
}

function setYArray(target: Y.Array<unknown>, source: unknown[]): void {
  const existing = target.toArray();
  if (source.every((value) => typeof value === "object" && value !== null && "id" in value)) {
    const byId = new Map(existing.map((value) => {
      const id = value instanceof Y.Map ? value.get("id") : undefined;
      return [id, value] as const;
    }));
    const next = source.map((value) => {
      const id = (value as { id: unknown }).id;
      const current = byId.get(id);
      return current instanceof Y.Map ? current : new Y.Map<unknown>();
    });
    if (existing.length !== next.length || existing.some((value, index) => value !== next[index])) {
      if (existing.length > 0) target.delete(0, existing.length);
      if (next.length > 0) target.insert(0, next);
    }
    source.forEach((value, index) => {
      const item = target.get(index);
      if (item instanceof Y.Map) setYMap(item, value as Record<string, unknown>);
    });
    return;
  }
  if (existing.length !== source.length) {
    if (existing.length > 0) target.delete(0, existing.length);
    if (source.length > 0) target.insert(0, source.map(createYValue));
  }
  source.forEach((value, index) => {
    const current = target.get(index);
    const next = syncYValue(current, value);
    if (next !== current) {
      target.delete(index);
      target.insert(index, [next]);
    }
  });
}

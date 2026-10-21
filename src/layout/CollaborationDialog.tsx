import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CircleAlert,
  Copy,
  Eye,
  EyeOff,
  LoaderCircle,
  Square,
  UsersRound,
  X,
} from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { CollaborationProvider, type Collaborator } from "../collaboration/provider";
import { useStore } from "../store";
import {
  collaborationSocketUrl,
  createCollaborationConnectTicket,
  endCollaborationSession,
  updateCollaborationPermissions,
  type CollaborationSession,
} from "../wallet/api";
import { useMeteredAction } from "../wallet/meteredActions";
import { useWalletStore } from "../wallet/store";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const COLLABORATOR_COLORS = ["#ef6a6a", "#7b6cf6", "#24a879", "#d58c17", "#2f8fd0", "#d04eaf"];

function collaboratorColor(accountId: string): string {
  let hash = 0;
  for (const character of accountId) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return COLLABORATOR_COLORS[Math.abs(hash) % COLLABORATOR_COLORS.length];
}

function isCollaborationSession(value: unknown): value is CollaborationSession {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const session = value as Partial<CollaborationSession>;
  return typeof session.id === "string" &&
    SESSION_ID_PATTERN.test(session.id) &&
    typeof session.projectName === "string" &&
    typeof session.createdAt === "string" &&
    typeof session.expiresAt === "string" &&
    typeof session.viewOnly === "boolean";
}

export function CollaborationDialog({
  open,
  initialSessionId,
  onClose,
  onSessionActive,
}: {
  open: boolean;
  initialSessionId: string | null;
  onClose: () => void;
  onSessionActive: (sessionId: string | null) => void;
}) {
  const project = useStore((state) => state.project);
  const selectedIds = useStore((state) => state.selectedIds);
  const activeScreenId = useStore((state) => state.activeScreenId);
  const token = useWalletStore((state) => state.jwt);
  const accountId = useWalletStore((state) => state.accountId);
  const [displayName, setDisplayName] = useState("Designer");
  const [sessionId, setSessionId] = useState("");
  const [joinSessionId, setJoinSessionId] = useState(initialSessionId ?? "");
  const [isHost, setIsHost] = useState(false);
  const [viewOnly, setViewOnly] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "disconnected" | "ended">("idle");
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const providerRef = useRef<CollaborationProvider | null>(null);
  const latestCursor = useRef<{ x: number; y: number } | null>(null);
  const lastJoinedId = useRef("");
  const payload = useMemo(
    () => ({ projectJson: JSON.stringify(project), projectName: project.name, viewOnly }),
    [project, viewOnly],
  );
  const creator = useMeteredAction<CollaborationSession>(
    "collaboration_session",
    payload,
  );

  useEffect(() => {
    if (initialSessionId) setJoinSessionId(initialSessionId);
  }, [initialSessionId]);

  useEffect(() => {
    providerRef.current?.updateProject(project);
  }, [project]);

  useEffect(() => {
    if (!providerRef.current) return;
    providerRef.current.updateSelection({
      screenId: activeScreenId,
      widgetIds: selectedIds,
    });
  }, [activeScreenId, selectedIds]);

  useEffect(() => {
    if (!providerRef.current) return;
    const updateCursor = (event: PointerEvent) => {
      const point = { x: event.clientX, y: event.clientY };
      latestCursor.current = point;
      providerRef.current?.updateCursor(point);
    };
    window.addEventListener("pointermove", updateCursor);
    const heartbeat = window.setInterval(() => providerRef.current?.refreshPresence(), 15_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.removeEventListener("pointermove", updateCursor);
      window.clearInterval(heartbeat);
      window.clearInterval(clock);
    };
  }, [status]);

  const connect = useCallback(async (targetSessionId: string, host: boolean) => {
    if (!token || !accountId) {
      setIsError(true);
      setMessage("Sync your wallet before joining a collaboration session.");
      return;
    }
    if (!SESSION_ID_PATTERN.test(targetSessionId)) {
      setIsError(true);
      setMessage("Enter a valid 24-character collaboration ID.");
      return;
    }
    providerRef.current?.close();
    providerRef.current = null;
    setIsHost(host);
    setSessionId(targetSessionId);
    setStatus("connecting");
    setMessage("");
    setIsError(false);
    onSessionActive(targetSessionId);
    const identityColor = collaboratorColor(accountId);
    try {
      const provider = new CollaborationProvider({
        displayName: displayName.trim() || "Designer",
        accountId,
        color: identityColor,
        isHost: host,
        getSocketUrl: async () => {
          const ticket = await createCollaborationConnectTicket(
            useWalletStore.getState().jwt ?? token,
            targetSessionId,
            displayName.trim() || "Designer",
          );
          return collaborationSocketUrl(targetSessionId, ticket);
        },
        onProject: (nextProject) => {
          useStore.setState({ project: nextProject, isDirty: true });
        },
        onPresence: setCollaborators,
        onStatus: setStatus,
        onPermissions: (nextViewOnly) => {
          setViewOnly(nextViewOnly);
          setMessage(nextViewOnly ? "Participants are in view-only mode." : "Participants can edit this project.");
          setIsError(false);
        },
        setPermissions: async (nextViewOnly) => {
          const currentToken = useWalletStore.getState().jwt;
          if (!currentToken) throw new Error("Sync your wallet before changing session permissions.");
          await updateCollaborationPermissions(currentToken, targetSessionId, nextViewOnly);
        },
        onError: (error) => {
          setMessage(error.message);
          setIsError(true);
        },
      });
      providerRef.current = provider;
      provider.updateSelection({ screenId: activeScreenId, widgetIds: selectedIds });
    } catch (error) {
      setStatus("disconnected");
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Could not connect to the collaboration session.");
    }
  }, [accountId, activeScreenId, displayName, onSessionActive, selectedIds, token]);

  useEffect(() => {
    if (
      !open ||
      !initialSessionId ||
      !token ||
      lastJoinedId.current === initialSessionId ||
      status === "connecting" ||
      status === "connected"
    ) return;
    lastJoinedId.current = initialSessionId;
    void connect(initialSessionId, false);
  }, [connect, initialSessionId, open, status, token]);

  useEffect(() => () => {
    providerRef.current?.close();
  }, []);

  useEffect(() => {
    const readOnly = status === "connected" && viewOnly && !isHost;
    document.body.classList.toggle("protoflow-collaboration-view-only", readOnly);
    return () => document.body.classList.remove("protoflow-collaboration-view-only");
  }, [isHost, status, viewOnly]);

  const startSession = async () => {
    if (creator.isRunning || !displayName.trim()) return;
    setMessage("");
    setIsError(false);
    const result = await creator.run();
    if (!result) return;
    if (!isCollaborationSession(result)) {
      setIsError(true);
      setMessage("The cloud service returned an invalid collaboration session.");
      return;
    }
    setViewOnly(result.viewOnly);
    await connect(result.id, true);
  };

  const joinSession = async () => {
    await connect(joinSessionId.trim(), false);
  };

  const shareUrl = useMemo(() => {
    if (!sessionId) return "";
    if (isTauri()) return `protoflow://collaboration/${sessionId}`;
    const url = new URL(window.location.href);
    url.searchParams.set("collab", sessionId);
    return url.toString();
  }, [sessionId]);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setMessage("Collaboration link copied. Participants need an online ProtoFlow wallet to join.");
      setIsError(false);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setMessage("Copy was blocked. Select and copy the collaboration link instead.");
      setIsError(true);
    }
  };

  const changePermissions = async (nextViewOnly: boolean) => {
    const provider = providerRef.current;
    if (!provider) return;
    setMessage("");
    setIsError(false);
    try {
      await provider.setViewOnly(nextViewOnly);
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Could not update session permissions.");
    }
  };

  const endSession = async () => {
    if (!token || !sessionId) return;
    try {
      await endCollaborationSession(token, sessionId);
      setMessage("Session ended and the final project version was saved.");
      setIsError(false);
      providerRef.current?.close();
      providerRef.current = null;
      setSessionId("");
      setStatus("ended");
      onSessionActive(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not end the collaboration session.");
      setIsError(true);
    }
  };

  const dismiss = () => {
    if (!sessionId) onSessionActive(null);
    onClose();
  };

  return (
    <>
      {open && (
        <section
          className={`collaboration-panel${status === "connected" ? " collaboration-panel-active" : ""}`}
          role={status === "connected" ? "region" : "dialog"}
          aria-modal={status === "connected" ? undefined : true}
          aria-labelledby="collaboration-title"
        >
          <header className="collaboration-heading">
            <div className="collaboration-title-icon"><UsersRound size={18} /></div>
            <div>
              <span className="eyebrow">REAL-TIME COLLABORATION</span>
              <h2 id="collaboration-title">{sessionId ? "Collaboration session" : "Start a session"}</h2>
            </div>
            <button className="icon-button" aria-label="Close collaboration panel" onClick={dismiss}>
              <X size={16} />
            </button>
          </header>

          {!sessionId && (
            <>
              <label className="collaboration-label" htmlFor="collaboration-display-name">Display name</label>
              <input
                id="collaboration-display-name"
                className="collaboration-input"
                value={displayName}
                maxLength={40}
                onChange={(event) => setDisplayName(event.currentTarget.value)}
              />
              <label className="collaboration-toggle">
                <input
                  type="checkbox"
                  checked={viewOnly}
                  onChange={(event) => setViewOnly(event.currentTarget.checked)}
                />
                <span>Start in view-only mode</span>
              </label>
              <p className="collaboration-cost">1 credit once to start · joining is free · sessions end after 4 hours of inactivity</p>
              <button
                className="button button-primary collaboration-full-button"
                onClick={() => void startSession()}
                disabled={!displayName.trim() || creator.isRunning || !token}
              >
                {creator.isRunning ? <LoaderCircle size={15} className="collaboration-spin" /> : <UsersRound size={15} />}
                {creator.isRunning ? "Starting session…" : "Start collaboration (1 credit)"}
              </button>
              {!token && <p className="collaboration-message collaboration-error" role="alert">Sync your wallet to create or join a session.</p>}
              <div className="collaboration-join">
                <label className="collaboration-label" htmlFor="collaboration-session-id">Join a session</label>
                <div className="collaboration-join-row">
                  <input
                    id="collaboration-session-id"
                    className="collaboration-input"
                    value={joinSessionId}
                    maxLength={24}
                    placeholder="Paste a collaboration ID"
                    onChange={(event) => setJoinSessionId(event.currentTarget.value)}
                  />
                  <button
                    className="button button-secondary"
                    onClick={() => void joinSession()}
                    disabled={!token || !SESSION_ID_PATTERN.test(joinSessionId.trim())}
                  >
                    Join
                  </button>
                </div>
              </div>
            </>
          )}

          {sessionId && (
            <>
              <div className="collaboration-status">
                <span className={`collaboration-status-dot collaboration-status-${status}`} />
                {status === "connected" ? "Connected" : status === "connecting" ? "Connecting…" : status === "disconnected" ? "Reconnecting…" : "Session ended"}
                <span className="collaboration-session-cost">{isHost ? "Host" : "Participant"}</span>
              </div>
              <label className="collaboration-label" htmlFor="collaboration-invite">Invite link</label>
              <div className="collaboration-link-row">
                <input id="collaboration-invite" className="collaboration-input" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />
                <button className="button button-secondary" onClick={() => void copyInvite()}>
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="collaboration-presence">
                <div className="collaboration-presence-heading">
                  <span>Participants</span>
                  <span>{collaborators.length + (status === "connected" ? 1 : 0)}</span>
                </div>
                <ul>
                  <li>
                    <span className="collaboration-avatar" style={{ backgroundColor: collaboratorColor(accountId ?? "") }}>
                      {(displayName.trim() || "D").slice(0, 1).toUpperCase()}
                    </span>
                    <span>{displayName || "Designer"} <small>(you)</small></span>
                    <span className="collaboration-role">{isHost ? "Host" : viewOnly ? "View only" : "Editor"}</span>
                  </li>
                  {collaborators.map((collaborator) => (
                    <li key={collaborator.clientId}>
                      <span className="collaboration-avatar" style={{ backgroundColor: collaborator.color }}>
                        {collaborator.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span>{collaborator.name}</span>
                      <span className="collaboration-role">{collaborator.role === "host" ? "Host" : collaborator.role === "viewer" ? "View only" : "Editor"}</span>
                    </li>
                  ))}
                </ul>
                {collaborators.length === 0 && <p className="collaboration-empty">Waiting for collaborators to join.</p>}
              </div>
              {isHost && status === "connected" && (
                <div className="collaboration-session-controls">
                  <label className="collaboration-toggle">
                    <input type="checkbox" checked={viewOnly} onChange={(event) => void changePermissions(event.currentTarget.checked)} />
                    <span>{viewOnly ? <Eye size={14} /> : <EyeOff size={14} />} View-only for participants</span>
                  </label>
                  <button className="button button-danger" onClick={() => void endSession()}>
                    <Square size={14} /> End session
                  </button>
                </div>
              )}
              <p className="collaboration-expiry">Sessions automatically end after 4 hours without activity.</p>
            </>
          )}
          {message && (
            <p className={`collaboration-message${isError ? " collaboration-error" : ""}`} role={isError ? "alert" : "status"}>
              {isError ? <CircleAlert size={14} /> : <Check size={14} />}
              {message}
            </p>
          )}
          {creator.error && <p className="collaboration-message collaboration-error" role="alert">{creator.error}</p>}
        </section>
      )}
      {status === "connected" && collaborators.map((collaborator) => {
        const activeCursor = collaborator.cursor && now - collaborator.cursorUpdatedAt < 5000;
        return activeCursor ? (
          <div
            key={`cursor-${collaborator.clientId}`}
            className="collaboration-cursor"
            style={{
              left: collaborator.cursor!.x,
              top: collaborator.cursor!.y,
              color: collaborator.color,
              opacity: Math.max(0.2, 1 - (now - collaborator.cursorUpdatedAt - 2500) / 2500),
            }}
            aria-hidden="true"
          >
            <span className="collaboration-cursor-pointer" />
            <span className="collaboration-cursor-name" style={{ backgroundColor: collaborator.color }}>
              {collaborator.name}
            </span>
          </div>
        ) : null;
      })}
    </>
  );
}

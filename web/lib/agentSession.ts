// ─────────────────────────────────────────────────────
// Agent Session Manager — Persistent warm connections
// ─────────────────────────────────────────────────────
//
// Keeps agents "attached" to the dashboard so there's no cold start.
//
//   1. On page load → connectAll() warms every agent on the VPS
//   2. Every HEARTBEAT_INTERVAL_MS → heartbeat keeps sessions alive
//   3. Sessions survive page refreshes via localStorage
//   4. Status tracked in real-time (connected / disconnected / busy)
//
// The VPS is expected to expose:
//   POST /agents/connect   { agentId, sessionId? }  → { sessionId, status }
//   POST /agents/heartbeat { sessions: [...] }       → { sessions: [...] }
//
// If the VPS is unreachable the manager falls back to local-only
// mode and retries automatically.
// ─────────────────────────────────────────────────────

import type { Agent } from "./types";
import { apiFetch } from "./api";

// ─── Types ────────────────────────────────────────────

export interface AgentSession {
  agentId: string;
  sessionId: string;
  status: "connected" | "disconnected" | "busy";
  connectedAt: string;
  lastHeartbeat: string;
}

type StatusListener = (sessions: Record<string, AgentSession>) => void;

// ─── Constants ────────────────────────────────────────

const SESSIONS_KEY = "mcc_agent_sessions";
const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

// ─── Internal state ───────────────────────────────────

let sessions: Record<string, AgentSession> = {};
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let listeners: StatusListener[] = [];

// ─── Persistence ──────────────────────────────────────

function loadSessions(): Record<string, AgentSession> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSessions() {
  if (typeof window === "undefined") return;
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function notify() {
  for (const fn of listeners) fn({ ...sessions });
}

// ─── Helpers ──────────────────────────────────────────

function randomSessionId(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return "ses_" + Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Public API ───────────────────────────────────────

/** Subscribe to session status changes. Returns an unsubscribe function. */
export function onSessionChange(fn: StatusListener): () => void {
  listeners.push(fn);
  // Immediately fire with current state
  fn({ ...sessions });
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

/** Get the current session for an agent (if connected). */
export function getSession(agentId: string): AgentSession | undefined {
  return sessions[agentId];
}

/** Get all current sessions. */
export function getAllSessions(): Record<string, AgentSession> {
  return { ...sessions };
}

/** Connect a single agent. Creates or reuses a session. */
export async function connectAgent(agent: Agent): Promise<AgentSession> {
  const now = new Date().toISOString();
  const existing = sessions[agent.id];

  // Reuse existing sessionId if we have one (avoid cold start)
  const sessionId = existing?.sessionId || randomSessionId();

  try {
    const res = await apiFetch("/agents/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: agent.id,
        sessionId,
        model: agent.model,
        workspace: agent.workspace,
        agentDir: agent.agentDir,
      }),
    });
    const data = await res.json() as { sessionId?: string; status?: string };

    const session: AgentSession = {
      agentId: agent.id,
      sessionId: data.sessionId || sessionId,
      status: "connected",
      connectedAt: existing?.connectedAt || now,
      lastHeartbeat: now,
    };
    sessions[agent.id] = session;
  } catch {
    // VPS unreachable — create a local session so the agent is still
    // "attached" and will sync once the VPS comes online.
    sessions[agent.id] = {
      agentId: agent.id,
      sessionId,
      status: "connected",
      connectedAt: existing?.connectedAt || now,
      lastHeartbeat: now,
    };
  }

  saveSessions();
  notify();
  return sessions[agent.id];
}

/** Connect all agents at once (called on page load). */
export async function connectAll(agents: Agent[]): Promise<void> {
  // Restore any persisted sessions first
  sessions = loadSessions();
  notify();

  // Fire all connects in parallel for speed
  await Promise.allSettled(agents.map((a) => connectAgent(a)));

  // Start heartbeat loop if not already running
  startHeartbeat(agents);
}

/** Disconnect a single agent. */
export function disconnectAgent(agentId: string) {
  if (sessions[agentId]) {
    sessions[agentId].status = "disconnected";
    saveSessions();
    notify();
  }
}

/** Stop all sessions and the heartbeat timer. */
export function disconnectAll() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  for (const id of Object.keys(sessions)) {
    sessions[id].status = "disconnected";
  }
  saveSessions();
  notify();
}

// ─── Heartbeat ────────────────────────────────────────

async function heartbeat(agents: Agent[]) {
  const connectedIds = Object.values(sessions)
    .filter((s) => s.status !== "disconnected")
    .map((s) => ({ agentId: s.agentId, sessionId: s.sessionId }));

  if (connectedIds.length === 0) return;

  const now = new Date().toISOString();

  try {
    const res = await apiFetch("/agents/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessions: connectedIds }),
    });
    const data = await res.json() as {
      sessions?: { agentId: string; sessionId: string; status: string }[];
    };

    if (data.sessions) {
      for (const s of data.sessions) {
        if (sessions[s.agentId]) {
          sessions[s.agentId].lastHeartbeat = now;
          sessions[s.agentId].status =
            s.status === "busy" ? "busy" : "connected";
          if (s.sessionId) sessions[s.agentId].sessionId = s.sessionId;
        }
      }
    } else {
      // VPS responded but without session data — mark all as alive
      for (const id of connectedIds) {
        if (sessions[id.agentId]) {
          sessions[id.agentId].lastHeartbeat = now;
        }
      }
    }
  } catch {
    // VPS unreachable — try to reconnect any disconnected agents
    for (const a of agents) {
      if (!sessions[a.id] || sessions[a.id].status === "disconnected") {
        connectAgent(a).catch(() => {});
      }
    }
  }

  saveSessions();
  notify();
}

function startHeartbeat(agents: Agent[]) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => heartbeat(agents), HEARTBEAT_INTERVAL_MS);
}

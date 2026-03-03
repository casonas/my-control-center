// ─────────────────────────────────────────────────────
// Active Workspace — single source of truth for tab ↔ agent sync
// ─────────────────────────────────────────────────────
//
// When the user clicks an agent, the tab switches to the agent's
// mapped tab. When the user clicks a tab, the agent switches to
// the tab's default agent.
//
// Persistence: localStorage (MVP). D1 upgrade planned later.
// ─────────────────────────────────────────────────────

import type { TabKey } from "./types";

// ─── Workspace shape ──────────────────────────────────

export interface ActiveWorkspace {
  tab: TabKey;
  agentId: string;
  sessionId: string | null;
}

// ─── Agent ↔ Tab mapping (editable constants) ─────────

const AGENT_TO_TAB: Record<string, TabKey> = {
  "main":        "home",
  "school-work": "school",
  "job-search":  "jobs",
  "career":      "skills",
  "sports":      "sports",
  "stocks":      "stocks",
  "research":    "research",
};

const TAB_TO_AGENT: Record<TabKey, string> = {
  home:     "main",
  school:   "school-work",
  jobs:     "job-search",
  skills:   "career",
  sports:   "sports",
  stocks:   "stocks",
  research: "research",
  notes:    "main",
  settings: "main",
};

/** Map an agent id to its default tab. Unknown agents fall back to "home". */
export function mapAgentToTab(agentId: string): TabKey {
  return AGENT_TO_TAB[agentId] ?? "home";
}

/** Map a tab to its default agent. */
export function mapTabToAgent(tab: TabKey): string {
  return TAB_TO_AGENT[tab] ?? "main";
}

// ─── localStorage persistence ─────────────────────────

const LS_KEY = "mcc_workspace";
const LS_AGENT_SESSIONS_KEY = "mcc_workspace_agent_sessions";

const DEFAULT_WORKSPACE: ActiveWorkspace = {
  tab: "home",
  agentId: "main",
  sessionId: null,
};

/** Read the persisted workspace (or return default). */
export function getWorkspace(): ActiveWorkspace {
  if (typeof window === "undefined") return DEFAULT_WORKSPACE;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_WORKSPACE;
    const parsed = JSON.parse(raw) as Partial<ActiveWorkspace>;
    return {
      tab: parsed.tab ?? DEFAULT_WORKSPACE.tab,
      agentId: parsed.agentId ?? DEFAULT_WORKSPACE.agentId,
      sessionId: parsed.sessionId ?? DEFAULT_WORKSPACE.sessionId,
    };
  } catch {
    return DEFAULT_WORKSPACE;
  }
}

/** Persist workspace state to localStorage. */
function persistWorkspace(ws: ActiveWorkspace) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ws));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

// ─── Per-agent last-session tracking ──────────────────

function getAgentSessionMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_AGENT_SESSIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setAgentSessionMap(map: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_AGENT_SESSIONS_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

/** Get the last sessionId for a given agent (or null). */
export function getLastSessionForAgent(agentId: string): string | null {
  return getAgentSessionMap()[agentId] ?? null;
}

/** Store the current sessionId for a given agent. */
export function setLastSessionForAgent(agentId: string, sessionId: string | null) {
  const map = getAgentSessionMap();
  if (sessionId) {
    map[agentId] = sessionId;
  } else {
    delete map[agentId];
  }
  setAgentSessionMap(map);
}

// ─── Core API ─────────────────────────────────────────

/**
 * Apply a partial workspace update and persist it.
 * Returns the full, resolved workspace.
 */
export function setWorkspace(partial: Partial<ActiveWorkspace>): ActiveWorkspace {
  const current = getWorkspace();
  const next: ActiveWorkspace = {
    tab: partial.tab ?? current.tab,
    agentId: partial.agentId ?? current.agentId,
    sessionId: partial.sessionId !== undefined ? partial.sessionId : current.sessionId,
  };
  persistWorkspace(next);

  // Also track the per-agent session
  if (next.sessionId) {
    setLastSessionForAgent(next.agentId, next.sessionId);
  }

  if (process.env.NODE_ENV === "development") {
    console.log("[workspace]", { tab: next.tab, agentId: next.agentId, sessionId: next.sessionId });
  }

  return next;
}

/**
 * Switch workspace by selecting an agent.
 * Resolves the corresponding tab and last session automatically.
 */
export function switchToAgent(agentId: string): ActiveWorkspace {
  const tab = mapAgentToTab(agentId);
  const sessionId = getLastSessionForAgent(agentId);
  return setWorkspace({ tab, agentId, sessionId });
}

/**
 * Switch workspace by selecting a tab.
 * Resolves the default agent for that tab (unless overridden).
 */
export function switchToTab(tab: TabKey): ActiveWorkspace {
  const agentId = mapTabToAgent(tab);
  const sessionId = getLastSessionForAgent(agentId);
  return setWorkspace({ tab, agentId, sessionId });
}

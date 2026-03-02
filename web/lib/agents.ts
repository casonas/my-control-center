// ─────────────────────────────────────────────────────
// Agent Registry — Single source of truth for all agents
// ─────────────────────────────────────────────────────
//
// This module defines the OpenClaw agents available in the system.
// Add new agents here; the API and UI will pick them up automatically.
//
// Sub-agents: set `parentId` to the parent agent's `id`.
// Collaboration: agents listed here can be selected together for
//   multi-agent tasks via the collaboration mode in the chat UI.
// ─────────────────────────────────────────────────────

import type { Agent } from "./types";

// ─── Built-in OpenClaw agents ─────────────────────────
export const BUILTIN_AGENTS: Agent[] = [
  {
    id: "main",
    name: "Meh",
    emoji: "🤷",
    model: "moonshot/kimi-k2.5",
    workspace: "~/.openclaw/workspace",
    agentDir: "~/.openclaw/agents/main/agent",
    description: "Your default assistant — general tasks, planning & daily ops",
    capabilities: ["general", "planning", "daily-ops", "triage", "web-search"],
    status: "online",
  },
  {
    id: "sports",
    name: "Sports Analyst",
    emoji: "🏀",
    model: "openai-codex/gpt-5.3-codex",
    workspace: "~/.openclaw/agents/sports/agent",
    agentDir: "~/.openclaw/agents/sports/agent",
    description: "Scores, stats & analysis — Knicks (NBA), Chargers (NFL), Tottenham (EPL), Gamecocks (NCAA), Padres (MLB)",
    capabilities: ["scores", "stats", "projections", "game-analysis", "player-research", "web-search",
      "knicks", "chargers", "tottenham", "gamecocks", "padres"],
    status: "online",
  },
  {
    id: "school-work",
    name: "Academic Researcher",
    emoji: "🎓",
    model: "openai-codex/gpt-5.3-codex",
    workspace: "~/.openclaw/workspace-school-work",
    agentDir: "~/.openclaw/agents/school-work/agent",
    description: "Assignments, research, study planning & tutoring",
    capabilities: ["assignments", "research", "study-plans", "tutoring", "citations", "web-search"],
    status: "online",
  },
  {
    id: "career",
    name: "Cyber Career Coach",
    emoji: "🛡️",
    model: "openai-codex/gpt-5.3-codex",
    workspace: "~/.openclaw/workspace-career",
    agentDir: "~/.openclaw/agents/career/agent",
    description: "Career strategy, certifications, skill roadmaps & mentorship",
    capabilities: ["career-planning", "certifications", "skill-roadmaps", "resume-review", "interview-prep", "web-search"],
    status: "online",
  },
  {
    id: "job-search",
    name: "Job Hunter",
    emoji: "💼",
    model: "openai-codex/gpt-5.3-codex",
    workspace: "~/.openclaw/workspace-job-search",
    agentDir: "~/.openclaw/agents/job-search/agent",
    description: "Job postings, applications, outreach & networking",
    capabilities: ["job-search", "applications", "cover-letters", "outreach", "networking", "web-search"],
    status: "online",
  },
  {
    id: "stocks",
    name: "Stock Market Analyst",
    emoji: "📈",
    model: "openai-codex/gpt-5.3-codex",
    workspace: "~/.openclaw/workspace-stocks",
    agentDir: "~/.openclaw/agents/stocks/agent",
    description: "Market analysis, watchlist monitoring & trading insights",
    capabilities: ["market-analysis", "watchlists", "trading-signals", "portfolio-review", "sector-analysis", "web-search"],
    status: "online",
  },
];

// ─── localStorage key for user-added agents ───────────
const CUSTOM_AGENTS_KEY = "mcc_custom_agents";

function getCustomAgents(): Agent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_AGENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setCustomAgents(agents: Agent[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CUSTOM_AGENTS_KEY, JSON.stringify(agents));
}

// ─── Public API ───────────────────────────────────────

/** All agents (built-in + custom). */
export function getAllAgents(): Agent[] {
  return [...BUILTIN_AGENTS, ...getCustomAgents()];
}

/** Top-level agents (no parentId). */
export function getRootAgents(): Agent[] {
  return getAllAgents().filter((a) => !a.parentId);
}

/** Direct sub-agents of a given parent. */
export function getSubAgents(parentId: string): Agent[] {
  return getAllAgents().filter((a) => a.parentId === parentId);
}

/** Lookup a single agent by id. */
export function getAgent(id: string): Agent | undefined {
  return getAllAgents().find((a) => a.id === id);
}

/** Add a new custom agent (or sub-agent if parentId is set). Returns the new agent. */
export function addAgent(agent: Omit<Agent, "status"> & { status?: Agent["status"] }): Agent {
  const custom = getCustomAgents();
  const created: Agent = { ...agent, status: agent.status || "online" };
  custom.push(created);
  setCustomAgents(custom);
  return created;
}

/** Remove a custom agent by id (built-in agents cannot be removed). */
export function removeAgent(id: string): boolean {
  const custom = getCustomAgents();
  const filtered = custom.filter((a) => a.id !== id);
  if (filtered.length === custom.length) return false;
  // Also remove any sub-agents whose parent is being removed
  const withoutChildren = filtered.filter((a) => a.parentId !== id);
  setCustomAgents(withoutChildren);
  return true;
}

/** Build a tree structure: root agents with nested children. */
export function getAgentTree(): (Agent & { children: Agent[] })[] {
  const all = getAllAgents();
  const roots = all.filter((a) => !a.parentId);
  return roots.map((root) => ({
    ...root,
    children: all.filter((a) => a.parentId === root.id),
  }));
}

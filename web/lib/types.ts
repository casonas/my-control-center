// Shared TypeScript types for My Control Center

export type TabKey =
  | "home"
  | "school"
  | "jobs"
  | "skills"
  | "sports"
  | "stocks"
  | "research"
  | "notes"
  | "settings";

export interface TabMeta {
  key: TabKey;
  label: string;
  icon: string;
  color: string;
  gradient: string;
  description: string;
}

export const TABS: TabMeta[] = [
  {
    key: "home",
    label: "Home",
    icon: "🏠",
    color: "cyan",
    gradient: "from-cyan-500 to-blue-500",
    description: "Your daily command center",
  },
  {
    key: "school",
    label: "School",
    icon: "🎓",
    color: "violet",
    gradient: "from-violet-500 to-purple-500",
    description: "Assignments, notes & Blackboard",
  },
  {
    key: "jobs",
    label: "Jobs",
    icon: "💼",
    color: "emerald",
    gradient: "from-emerald-500 to-green-500",
    description: "Postings, applications & outreach",
  },
  {
    key: "skills",
    label: "Skills",
    icon: "🧠",
    color: "amber",
    gradient: "from-amber-500 to-orange-500",
    description: "Cybersecurity lessons & progress",
  },
  {
    key: "sports",
    label: "Sports",
    icon: "🏀",
    color: "rose",
    gradient: "from-rose-500 to-red-500",
    description: "Scores, stats & projections",
  },
  {
    key: "stocks",
    label: "Stocks",
    icon: "📈",
    color: "lime",
    gradient: "from-lime-500 to-green-500",
    description: "Markets, watchlist & analysis",
  },
  {
    key: "research",
    label: "Research",
    icon: "🔬",
    color: "indigo",
    gradient: "from-indigo-500 to-blue-500",
    description: "News, tech & deep dives",
  },
  {
    key: "notes",
    label: "Notes",
    icon: "📝",
    color: "teal",
    gradient: "from-teal-500 to-cyan-500",
    description: "All your notes in one place",
  },
  {
    key: "settings",
    label: "Settings",
    icon: "⚙️",
    color: "zinc",
    gradient: "from-zinc-500 to-gray-500",
    description: "Preferences & connectors",
  },
];

export interface Agent {
  id: string;
  name: string;
  emoji: string;
}

export interface Msg {
  role: "user" | "agent";
  content: string;
}

// Local storage data models

export interface Note {
  id: string;
  tab: TabKey;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Assignment {
  id: string;
  title: string;
  course: string;
  dueDate: string;
  completed: boolean;
  priority: "low" | "medium" | "high";
}

export interface Skill {
  id: string;
  name: string;
  category: string;
  progress: number;
  lessons: Lesson[];
}

export interface Lesson {
  id: string;
  title: string;
  completed: boolean;
  description: string;
}

export interface JobPosting {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  savedAt: string;
  applied: boolean;
  tags: string[];
}

export interface WatchItem {
  id: string;
  symbol: string;
  name: string;
  type: "stock" | "team";
}

export interface ResearchArticle {
  id: string;
  title: string;
  source: string;
  url: string;
  category: "world" | "tech" | "cyber" | "deep";
  savedAt: string;
  read: boolean;
  notes: string;
}

export interface PomodoroState {
  running: boolean;
  seconds: number;
  mode: "work" | "break";
}

// "Think Like Me" engine types

export interface NextAction {
  id: string;
  title: string;
  reasoning: string;
  sourceType: "deadline" | "skill_gap" | "unread" | "job_apply" | "pattern";
  sourceId: string | null;
  confidence: number;
  priority: number;
  tab: string;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  channel: "in_app" | "push" | "email";
  priority: "low" | "normal" | "high" | "urgent";
  read: boolean;
  createdAt: string;
  readAt: string | null;
}

export interface Connector {
  id: string;
  type: "rss" | "email_imap" | "calendar_ics" | "webhook" | "api";
  name: string;
  enabled: boolean;
  lastSyncAt: string | null;
}

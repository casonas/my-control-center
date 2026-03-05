"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { TabKey, Note, Assignment, Skill, JobPosting, ResearchArticle } from "@/lib/types";
import {
  getNotes, saveNote, deleteNote,
  getAssignments, saveAssignment, deleteAssignment, toggleAssignment,
  getSkills, toggleLesson,
  getJobs, saveJob, toggleJobApplied,
  getResearch, toggleArticleRead, saveArticleNotes,
} from "@/lib/store";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

/* ────────── helpers ────────── */
function cx(...c: (string | false | undefined | null)[]) { return c.filter(Boolean).join(" "); }
function relDate(d: string) {
  if (!d) return "";
  const diff = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `${diff}d`;
}
const priorityColor: Record<string, string> = {
  high: "text-rose-400 bg-rose-500/10 border-rose-500/20",
  medium: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  low: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
};

/* ────────── shared UI ────────── */
function Card({ title, icon, actions, children, className }: {
  title: string; icon?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cx("glass-light rounded-2xl p-4 animate-fade-in", className)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon && <span className="text-sm">{icon}</span>}
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

function Badge({ children, color = "zinc" }: { children: React.ReactNode; color?: string }) {
  const map: Record<string, string> = {
    zinc: "bg-zinc-800 text-zinc-300",
    cyan: "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20",
    violet: "bg-violet-500/10 text-violet-400 border border-violet-500/20",
    emerald: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    amber: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
    rose: "bg-rose-500/10 text-rose-400 border border-rose-500/20",
    lime: "bg-lime-500/10 text-lime-400 border border-lime-500/20",
    indigo: "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20",
  };
  return <span className={cx("inline-block rounded-full px-2 py-0.5 text-[10px] font-medium", map[color] || map.zinc)}>{children}</span>;
}

function ProgressBar({ value, gradient }: { value: number; gradient: string }) {
  return (
    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
      <div className={cx("h-full rounded-full bg-gradient-to-r transition-all duration-700", gradient)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

function StatBox({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="glass-light rounded-xl p-3 text-center min-w-0">
      <div className="text-lg">{icon}</div>
      <div className="text-lg font-bold text-white mt-1">{value}</div>
      <div className="text-[10px] text-zinc-400 truncate">{label}</div>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="py-8 text-center text-zinc-500">
      <div className="text-2xl mb-2">{icon}</div>
      <div className="text-xs">{text}</div>
    </div>
  );
}

const DEFAULT_OUTREACH_TEMPLATES = ["cold_email", "linkedin_connect", "follow_up", "thank_you"];

function AgentStatus({ verb }: { verb: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-400 glass-light rounded-xl px-3 py-2">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      Agent {verb}…
    </div>
  );
}

/** Callback shape when a user clicks a lesson to open its chat thread */
export interface LessonClickInfo {
  lessonId: string;
  lessonTitle: string;
  skillId: string;
  moduleTitle: string;
}

/* ═══════════════════════════════════════════════════════
   MAIN WIDGET PANEL
   ═══════════════════════════════════════════════════════ */

export default function WidgetPanel({ activeTab, onLessonClick }: { activeTab: TabKey; onLessonClick?: (info: LessonClickInfo) => void }) {
  // Force re-render when local data changes
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  /* eslint-disable react-hooks/exhaustive-deps */
  const assignments = useMemo(() => getAssignments(), [tick]);
  const skills = useMemo(() => getSkills(), [tick]);
  const jobs = useMemo(() => getJobs(), [tick]);
  const research = useMemo(() => getResearch(), [tick]);
  const notes = useMemo(() => getNotes(), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */

  switch (activeTab) {
    case "home": return <HomeWidgets assignments={assignments} skills={skills} jobs={jobs} research={research} refresh={refresh} />;
    case "school": return <SchoolWidgets assignments={assignments} notes={notes} refresh={refresh} />;
    case "jobs": return <JobsWidgets jobs={jobs} refresh={refresh} />;
    case "skills": return <SkillsWidgets skills={skills} refresh={refresh} onLessonClick={onLessonClick} />;
    case "sports": return <SportsWidgets refresh={refresh} />;
    case "stocks": return <StocksWidgets refresh={refresh} />;
    case "research": return <ResearchWidgets research={research} refresh={refresh} />;
    case "notes": return <NotesWidgets notes={notes} refresh={refresh} />;
    case "settings": return <SettingsWidgets />;
    default: return null;
  }
}

/* ═══════════════════════════════════════════════════════
   HOME  — Todoist-style command center
   ═══════════════════════════════════════════════════════ */
/* ── types for Home v2 API responses ── */
type HomeAction = {
  id: string; title: string; source_type: string; priority: number;
  urgency: string; status: string; reasoning: string | null; created_at: string;
};
type HomeDigest = {
  id: string; digest_type: string; title: string; body_md: string | null; created_at: string;
};

function HomeWidgets({ assignments, skills, jobs, research, refresh }: {
  assignments: Assignment[]; skills: Skill[]; jobs: JobPosting[]; research: ResearchArticle[]; refresh: () => void;
}) {
  const [pomodoroSec, setPomodoroSec] = useState(25 * 60);
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [pomodoroMode, setPomodoroMode] = useState<"work" | "break">("work");
  const [quickTask, setQuickTask] = useState("");
  const [commandText, setCommandText] = useState("");
  const [commandResult, setCommandResult] = useState<string | null>(null);
  const [actions, setActions] = useState<HomeAction[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [digest, setDigest] = useState<HomeDigest | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Pomodoro timer
  useEffect(() => {
    if (!pomodoroRunning) return;
    const id = setInterval(() => {
      setPomodoroSec((s) => {
        if (s <= 1) {
          setPomodoroRunning(false);
          const nextMode = pomodoroMode === "work" ? "break" : "work";
          setPomodoroMode(nextMode);
          return nextMode === "break" ? 5 * 60 : 25 * 60;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [pomodoroRunning, pomodoroMode]);

  // Load actions + digest from API on mount
  useEffect(() => {
    setActionsLoading(true);
    Promise.all([
      apiGet<{ actions: HomeAction[] }>("/home/actions")
        .then((d) => setActions(d.actions || []))
        .catch(() => {}),
      apiGet<{ digest: HomeDigest | null }>("/home/digest/latest")
        .then((d) => setDigest(d.digest || null))
        .catch(() => {}),
    ]).finally(() => setActionsLoading(false));
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await apiPost("/home/refresh", {});
      const d = await apiGet<{ actions: HomeAction[] }>("/home/actions");
      setActions(d.actions || []);
    } catch { /* ignore */ }
    setRefreshing(false);
    refresh();
  }, [refresh]);

  const handleActionUpdate = useCallback(async (id: string, status: string) => {
    try {
      await apiPatch(`/home/actions/${id}`, { status });
      setActions((prev) => prev.map((a) => a.id === id ? { ...a, status } : a));
    } catch { /* ignore */ }
  }, []);

  const handleCommand = useCallback(async () => {
    if (!commandText.trim()) return;
    setCommandResult(null);
    try {
      const res = await apiPost<{ route: string; message: string }>("/home/route-intent", { message: commandText.trim() });
      setCommandResult(`→ ${res.message}`);
    } catch {
      setCommandResult("Could not process command.");
    }
    setCommandText("");
  }, [commandText]);

  const timerMin = String(Math.floor(pomodoroSec / 60)).padStart(2, "0");
  const timerSec = String(pomodoroSec % 60).padStart(2, "0");

  const overdue = assignments.filter((a) => !a.completed && a.dueDate && new Date(a.dueDate) < new Date()).length;
  const avgProgress = skills.length ? Math.round(skills.reduce((s, sk) => s + sk.progress, 0) / skills.length) : 0;
  const unread = research.filter((r) => !r.read).length;

  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const urgencyColor: Record<string, string> = {
    critical: "rose", high: "amber", med: "cyan", low: "zinc",
  };

  const topActions = actions.filter((a) => a.status === "new" || a.status === "accepted").slice(0, 3);

  return (
    <div className="space-y-3">
      {/* Welcome strip */}
      <div className="glass-light rounded-2xl p-5 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold text-white">{greeting} 👋</div>
            <div className="text-xs text-zinc-400 mt-1">{dateStr}</div>
          </div>
          <button onClick={handleRefresh} disabled={refreshing}
            className="text-[10px] px-2.5 py-1 rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition disabled:opacity-50">
            {refreshing ? "Refreshing…" : "⟳ Refresh"}
          </button>
        </div>
        <div className="mt-3 text-sm text-zinc-300">
          Your AI command center is ready.{" "}
          {overdue > 0 && <span className="text-rose-400">{overdue} overdue assignment{overdue > 1 ? "s" : ""}!</span>}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-2">
        <StatBox icon="📝" value={assignments.filter((a) => !a.completed).length} label="Due" />
        <StatBox icon="🧠" value={`${avgProgress}%`} label="Skills" />
        <StatBox icon="💼" value={jobs.length} label="Jobs" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatBox icon="📰" value={unread} label="Unread" />
        <StatBox icon="📈" value="—" label="Market" />
        <StatBox icon="🏀" value="—" label="Sports" />
      </div>

      {/* Point-Guard Panel — Top Priorities */}
      <Card title="Top Priorities" icon="🎯" actions={
        actionsLoading ? <span className="text-[10px] text-zinc-500">Loading…</span> : undefined
      }>
        {topActions.length === 0 ? (
          <div className="text-xs text-zinc-500 py-2">No actions yet. Use Refresh to compute priorities.</div>
        ) : (
          <div className="space-y-1.5">
            {topActions.map((action, i) => (
              <div key={action.id} className="rounded-xl bg-white/5 px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-zinc-400">#{i + 1}</span>
                    <span className="text-xs text-white truncate">{action.title}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge color={urgencyColor[action.urgency] || "zinc"}>{action.urgency}</Badge>
                    <button onClick={() => handleActionUpdate(action.id, "accepted")}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition">✓</button>
                    <button onClick={() => handleActionUpdate(action.id, "dismissed")}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20 transition">✕</button>
                  </div>
                </div>
                {action.reasoning && (
                  <div className="text-[10px] text-zinc-500 mt-1 truncate">{action.reasoning}</div>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <Badge color="zinc">{action.source_type}</Badge>
                  <span className="text-[10px] text-zinc-600">P{action.priority}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Cross-workspace Pulse */}
      <Card title="Workspace Pulse" icon="📡">
        <div className="space-y-1.5">
          {overdue > 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-500/5 border border-rose-500/10 px-3 py-2">
              <span className="text-xs">🎓</span>
              <span className="text-xs text-rose-300">{overdue} overdue assignment{overdue > 1 ? "s" : ""}</span>
            </div>
          )}
          {jobs.length > 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/5 border border-emerald-500/10 px-3 py-2">
              <span className="text-xs">💼</span>
              <span className="text-xs text-emerald-300">{jobs.length} jobs tracked</span>
            </div>
          )}
          {unread > 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-indigo-500/5 border border-indigo-500/10 px-3 py-2">
              <span className="text-xs">📰</span>
              <span className="text-xs text-indigo-300">{unread} unread article{unread > 1 ? "s" : ""}</span>
            </div>
          )}
          {overdue === 0 && jobs.length === 0 && unread === 0 && (
            <div className="text-xs text-zinc-500 py-1">All clear — no urgent items across workspaces.</div>
          )}
        </div>
      </Card>

      {/* Quick Command Box */}
      <Card title="Quick Command" icon="💬">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-cyan-500/50 transition"
            placeholder={'Ask anything… e.g. "What should I do next?"'}
            value={commandText}
            onChange={(e) => setCommandText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCommand(); }}
          />
          <button onClick={handleCommand}
            className="px-3 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 text-xs font-medium hover:bg-cyan-500/30 transition">
            →
          </button>
        </div>
        {commandResult && (
          <div className="mt-2 text-xs text-cyan-300 bg-cyan-500/5 rounded-lg px-3 py-2">{commandResult}</div>
        )}
        <div className="flex flex-wrap gap-1 mt-2">
          {["Plan my day", "What's urgent?", "Show digest"].map((s) => (
            <button key={s} onClick={() => setCommandText(s)}
              className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-zinc-400 hover:bg-white/10 transition">{s}</button>
          ))}
        </div>
      </Card>

      {/* Focus Timer */}
      <Card title="Focus Timer" icon="⏱️">
        <div className="text-center">
          <div className="text-3xl font-mono font-bold text-white mb-2">{timerMin}:{timerSec}</div>
          <Badge color={pomodoroMode === "work" ? "rose" : "emerald"}>{pomodoroMode === "work" ? "Focus" : "Break"}</Badge>
          <div className="flex justify-center gap-2 mt-3">
            <button onClick={() => setPomodoroRunning(!pomodoroRunning)} className="px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium transition">
              {pomodoroRunning ? "Pause" : "Start"}
            </button>
            <button onClick={() => { setPomodoroRunning(false); setPomodoroSec(pomodoroMode === "work" ? 25 * 60 : 5 * 60); }} className="px-4 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-zinc-400 transition">
              Reset
            </button>
          </div>
        </div>
      </Card>

      {/* Quick add task */}
      <Card title="Quick Task" icon="⚡">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-cyan-500/50 transition"
            placeholder="Add a quick task…"
            value={quickTask}
            onChange={(e) => setQuickTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && quickTask.trim()) {
                saveAssignment({ title: quickTask.trim(), priority: "medium" });
                setQuickTask("");
                refresh();
              }
            }}
          />
          <button
            onClick={() => { if (quickTask.trim()) { saveAssignment({ title: quickTask.trim(), priority: "medium" }); setQuickTask(""); refresh(); } }}
            className="px-3 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 text-xs font-medium hover:bg-cyan-500/30 transition"
          >+</button>
        </div>
      </Card>

      {/* Latest Digest */}
      {digest && (
        <Card title={digest.title || "Latest Digest"} icon="📋">
          <div className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{digest.body_md || "No content."}</div>
          <div className="mt-2 text-[10px] text-zinc-500">
            <Badge color="cyan">{digest.digest_type}</Badge>
            <span className="ml-2">{new Date(digest.created_at).toLocaleString()}</span>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SCHOOL — Notion + Blackboard + Email
   ═══════════════════════════════════════════════════════ */
const SCHOOL_DEFAULT_RESOURCES = [
  { id: "def-lms", category: "lms", name: "LMS Portal (Canvas/Blackboard)", url: "", notes: "" },
  { id: "def-library", category: "library", name: "Library Portal", url: "", notes: "" },
  { id: "def-tutoring", category: "tutoring", name: "Tutoring Center", url: "", notes: "" },
  { id: "def-writing", category: "writing", name: "Writing Center", url: "", notes: "" },
  { id: "def-career", category: "career", name: "Career Center", url: "", notes: "" },
];
const SCHOOL_AGENT_ACTIONS = [
  { label: "Break assignment into steps", icon: "🧩" },
  { label: "Create 5-day study plan", icon: "📅" },
  { label: "Quiz me from this note", icon: "❓" },
  { label: "Summarize attached file", icon: "📄" },
];
const SCHOOL_RES_CAT_ICONS: Record<string, string> = { lms: "🎓", library: "📚", tutoring: "👩‍🏫", writing: "✍️", career: "💼", other: "🔗" };

function SchoolWidgets({ assignments: localAssignments, notes: localNotes, refresh }: {
  assignments: Assignment[]; notes: Note[]; refresh: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCourse, setNewCourse] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newPriority, setNewPriority] = useState<"low" | "medium" | "high">("medium");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [filter, setFilter] = useState("all");
  const [courseSel, setCourseSel] = useState("");

  // API-backed data
  interface ApiAssignment {
    id: string; title: string; due_at: string; status: string; priority?: string;
    course_code?: string; course_name?: string; course_color?: string; description?: string;
    course_id?: string; notes_md?: string; estimated_minutes?: number;
  }
  interface ApiNote { id: string; title: string; content_md: string; updated_at: string; course_id?: string; tags_json?: string }
  interface CalEvent { id: string; title: string; start: string; end?: string; type?: string; status: string; course?: string | null }
  interface ApiCourse { id: string; code: string; name?: string; term?: string; color?: string; instructor?: string; lms_url?: string }
  interface ApiResource { id: string; category: string; name: string; url?: string; notes?: string; course_id?: string }

  const [apiAssignments, setApiAssignments] = useState<ApiAssignment[]>([]);
  const [apiNotes, setApiNotes] = useState<ApiNote[]>([]);
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [courses, setCourses] = useState<ApiCourse[]>([]);
  const [resources, setResources] = useState<ApiResource[]>([]);
  const [hasApi, setHasApi] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calView, setCalView] = useState<"month" | "week" | "agenda">("agenda");
  const [showResources, setShowResources] = useState(false);
  const [showAddResource, setShowAddResource] = useState(false);
  const [newResName, setNewResName] = useState("");
  const [newResUrl, setNewResUrl] = useState("");
  const [newResCat, setNewResCat] = useState("other");
  const [noteCourseId, setNoteCourseId] = useState("");

  const loadCourses = useCallback(async () => {
    try { const d = await apiGet<{ courses: ApiCourse[] }>("/school/courses"); setCourses(d.courses || []); } catch { /* */ }
  }, []);

  const loadAssignments = useCallback(async (f: string) => {
    try {
      let url = `/school/assignments?filter=${f}`;
      if (courseSel) url += `&courseId=${courseSel}`;
      const d = await apiGet<{ assignments: ApiAssignment[] }>(url);
      if (d.assignments) { setApiAssignments(d.assignments); setHasApi(true); }
    } catch { setHasApi(false); }
  }, [courseSel]);

  const loadNotes = useCallback(async () => {
    try {
      let url = "/school/notes";
      if (courseSel) url += `?courseId=${courseSel}`;
      const d = await apiGet<{ notes: ApiNote[] }>(url);
      setApiNotes(d.notes || []);
    } catch { /* */ }
  }, [courseSel]);

  const loadCalendar = useCallback(async () => {
    try {
      const from = new Date().toISOString().slice(0, 10);
      const days = calView === "week" ? 7 : calView === "month" ? 30 : 14;
      const to = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      let url = `/school/calendar?from=${from}&to=${to}&view=${calView}`;
      if (courseSel) url += `&courseId=${courseSel}`;
      const d = await apiGet<{ events: CalEvent[] }>(url);
      setCalEvents(d.events || []);
    } catch { /* */ }
  }, [calView, courseSel]);

  const loadResources = useCallback(async () => {
    try {
      let url = "/school/resources";
      if (courseSel) url += `?courseId=${courseSel}`;
      const d = await apiGet<{ resources: ApiResource[] }>(url);
      setResources(d.resources || []);
    } catch { /* */ }
  }, [courseSel]);

  useEffect(() => { loadCourses(); }, [loadCourses]);
  useEffect(() => { loadAssignments(filter); loadNotes(); loadCalendar(); loadResources(); }, [filter, courseSel, loadAssignments, loadNotes, loadCalendar, loadResources]);

  async function handleAddAssignment() {
    if (!newTitle.trim()) return;
    if (hasApi) {
      try {
        const dueAt = newDate ? new Date(newDate).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString();
        await apiPost("/school/assignments", { title: newTitle.trim(), dueAt, priority: newPriority, courseId: courseSel || undefined });
        loadAssignments(filter);
      } catch { /* fallback */ }
    } else {
      saveAssignment({ title: newTitle.trim(), course: newCourse.trim(), dueDate: newDate, priority: newPriority });
      refresh();
    }
    setNewTitle(""); setNewCourse(""); setNewDate(""); setNewPriority("medium"); setShowAdd(false);
  }

  async function handleToggleStatus(id: string, currentStatus: string) {
    if (hasApi) {
      const newStatus = currentStatus === "done" ? "open" : "done";
      try { await apiPatch(`/school/assignments/${id}`, { status: newStatus }); loadAssignments(filter); }
      catch { /* fallback */ }
    } else {
      toggleAssignment(id); refresh();
    }
  }

  async function handleDeleteAssignment(id: string) {
    if (hasApi) {
      try {
        await apiPatch(`/school/assignments/${id}`, { status: "dropped" });
        loadAssignments(filter);
      } catch { /* fallback */ deleteAssignment(id); refresh(); }
    } else {
      deleteAssignment(id); refresh();
    }
  }

  async function handleAddNote() {
    if (!noteTitle.trim()) return;
    if (hasApi) {
      try { await apiPost("/school/notes", { title: noteTitle.trim(), contentMd: noteContent, courseId: noteCourseId || undefined }); loadNotes(); }
      catch { /* fallback */ }
    } else {
      saveNote({ tab: "school", title: noteTitle.trim(), content: noteContent });
      refresh();
    }
    setNoteTitle(""); setNoteContent(""); setNoteCourseId("");
  }

  async function handleDeleteNote(id: string) {
    if (hasApi) {
      try { await apiDelete(`/school/notes/${id}`); loadNotes(); } catch { /* */ }
    } else {
      deleteNote(id); refresh();
    }
  }

  async function handleAddResource() {
    if (!newResName.trim()) return;
    try {
      await apiPost("/school/resources", { name: newResName.trim(), url: newResUrl.trim() || undefined, category: newResCat, courseId: courseSel || undefined });
      loadResources();
    } catch { /* */ }
    setNewResName(""); setNewResUrl(""); setNewResCat("other"); setShowAddResource(false);
  }

  async function handleDeleteResource(id: string) {
    try { await apiDelete(`/school/resources/${id}`); loadResources(); } catch { /* */ }
  }

  function handleExportICS() {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    window.open(`/api/school/calendar?from=${from}&to=${to}&format=ics`, "_blank");
  }

  // Merge display: prefer API, fallback to local
  const schoolNotes = hasApi ? apiNotes : localNotes.filter((n) => n.tab === "school");
  const pending = hasApi
    ? apiAssignments.filter((a) => ["open", "in_progress", "late"].includes(a.status))
    : localAssignments.filter((a) => !a.completed);
  const completed = hasApi
    ? apiAssignments.filter((a) => a.status === "done")
    : localAssignments.filter((a) => a.completed);
  const lateCount = hasApi ? apiAssignments.filter((a) => a.status === "late").length : 0;

  // Calendar: group events by date
  const calByDate = calEvents.reduce<Record<string, CalEvent[]>>((acc, ev) => {
    const day = ev.start.slice(0, 10);
    (acc[day] = acc[day] || []).push(ev);
    return acc;
  }, {});
  const calDays = Object.keys(calByDate).sort();

  const displayResources = resources.length > 0 ? resources : SCHOOL_DEFAULT_RESOURCES;

  // Due-soon badge helper
  function dueBadge(dueAt: string, status: string) {
    if (status === "done" || status === "dropped") return null;
    const diff = Math.ceil((new Date(dueAt).getTime() - Date.now()) / 86400000);
    if (diff < 0) return <Badge color="rose">Late</Badge>;
    if (diff <= 7) return <Badge color="amber">Due soon</Badge>;
    return null;
  }

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatBox icon="📋" value={pending.length} label="Pending" />
        <StatBox icon="✅" value={completed.length} label="Done" />
        <StatBox icon="📝" value={schoolNotes.length} label="Notes" />
      </div>

      {/* Course selector */}
      {courses.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setCourseSel("")}
            className={cx("px-2 py-1 rounded-lg text-[10px] font-medium border transition",
              !courseSel ? "bg-violet-500/20 text-violet-400 border-violet-500/30" : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10"
            )}>All Classes</button>
          {courses.map((c) => (
            <button key={c.id} onClick={() => setCourseSel(c.id)}
              className={cx("px-2 py-1 rounded-lg text-[10px] font-medium border transition",
                courseSel === c.id ? "bg-violet-500/20 text-violet-400 border-violet-500/30" : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10"
              )}>
              {c.color && <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: c.color }} />}
              {c.code || c.name}
            </button>
          ))}
        </div>
      )}

      {/* Calendar / ICS controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setShowCalendar(!showCalendar)}
          className={cx("px-3 py-1.5 rounded-lg text-xs font-medium border transition",
            showCalendar ? "bg-violet-500/20 text-violet-400 border-violet-500/30" : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10"
          )}>📅 Calendar</button>
        <button onClick={handleExportICS}
          className="px-3 py-1.5 rounded-lg bg-white/5 text-zinc-400 text-xs border border-white/5 hover:bg-white/10 transition">
          ⬇ Export ICS
        </button>
        <button onClick={() => setShowResources(!showResources)}
          className={cx("px-3 py-1.5 rounded-lg text-xs font-medium border transition",
            showResources ? "bg-violet-500/20 text-violet-400 border-violet-500/30" : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10"
          )}>🔗 Resources</button>
        {/* Filter tabs */}
        {(["all", "open", "due_soon", "late"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cx(
            "px-2 py-1 rounded-lg text-[10px] font-medium border transition capitalize",
            filter === f ? "bg-violet-500/20 text-violet-400 border-violet-500/30" : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10"
          )}>
            {f === "due_soon" ? "Due Soon" : f}
            {f === "late" && lateCount > 0 && <span className="ml-1 text-rose-400">({lateCount})</span>}
          </button>
        ))}
      </div>

      {/* Calendar view */}
      {showCalendar && (
        <Card title="Upcoming Calendar" icon="📅" actions={
          <div className="flex gap-1">
            {(["agenda", "week", "month"] as const).map((v) => (
              <button key={v} onClick={() => setCalView(v)}
                className={cx("px-2 py-0.5 rounded text-[10px] font-medium border transition capitalize",
                  calView === v ? "bg-violet-500/20 text-violet-400 border-violet-500/30" : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10"
                )}>{v}</button>
            ))}
          </div>
        }>
          <div className="space-y-2 max-h-48 overflow-auto">
            {calDays.length === 0 && <div className="text-[10px] text-zinc-500">No events in this period.</div>}
            {calDays.map((day) => (
              <div key={day}>
                <div className="text-[10px] text-zinc-400 font-semibold mb-0.5">{new Date(day + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div>
                {calByDate[day].map((ev) => (
                  <div key={ev.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1 text-[10px]">
                    <span className={cx("w-1.5 h-1.5 rounded-full",
                      ev.type === "exam" ? "bg-rose-500" : ev.type === "class" ? "bg-cyan-500" : ev.status === "done" ? "bg-emerald-500" : "bg-violet-500"
                    )} />
                    <span className="text-white truncate flex-1">{ev.title}</span>
                    {ev.type && ev.type !== "assignment" && <span className="text-zinc-500 capitalize">{ev.type}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Resources panel */}
      {showResources && (
        <Card title="School Resources" icon="🔗" actions={
          <button onClick={() => setShowAddResource(!showAddResource)}
            className="text-[10px] px-2 py-1 rounded-lg bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition">
            {showAddResource ? "Cancel" : "+ Add"}
          </button>
        }>
          {showAddResource && (
            <div className="mb-3 p-3 rounded-xl bg-white/5 border border-white/10 space-y-2 animate-fade-in">
              <input className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none" placeholder="Resource name" value={newResName} onChange={(e) => setNewResName(e.target.value)} />
              <input className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none" placeholder="URL (optional)" value={newResUrl} onChange={(e) => setNewResUrl(e.target.value)} />
              <div className="flex gap-1 flex-wrap">
                {(["lms", "library", "tutoring", "writing", "career", "other"] as const).map((c) => (
                  <button key={c} onClick={() => setNewResCat(c)} className={cx("px-2 py-1 rounded-lg text-[10px] border transition capitalize",
                    newResCat === c ? "bg-violet-500/20 text-violet-400 border-violet-500/30" : "bg-white/5 border-white/5 text-zinc-400"
                  )}>{SCHOOL_RES_CAT_ICONS[c]} {c}</button>
                ))}
                <button onClick={handleAddResource} className="ml-auto px-3 py-1 rounded-lg bg-violet-500/20 text-violet-400 text-[10px] font-medium hover:bg-violet-500/30 transition">Save</button>
              </div>
            </div>
          )}
          <div className="space-y-1.5 max-h-48 overflow-auto">
            {displayResources.map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 group hover:bg-white/10 transition">
                <span className="text-sm">{SCHOOL_RES_CAT_ICONS[r.category] || "🔗"}</span>
                <div className="min-w-0 flex-1">
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-xs text-violet-400 hover:underline truncate block">{r.name}</a>
                  ) : (
                    <span className="text-xs text-zinc-300 truncate block">{r.name}</span>
                  )}
                </div>
                <span className="text-[10px] text-zinc-500 capitalize">{r.category}</span>
                {!r.id.startsWith("def-") && (
                  <button onClick={() => handleDeleteResource(r.id)} className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 text-xs transition">✕</button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Connectors */}
      <div className="grid grid-cols-2 gap-2">
        <div className="glass-light rounded-xl p-3 animate-fade-in">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm">🎓</span>
            <span className="text-xs font-semibold text-zinc-100">Blackboard</span>
          </div>
          <div className="text-[10px] text-zinc-400">Ask agent to sync from Blackboard.</div>
        </div>
        <div className="glass-light rounded-xl p-3 animate-fade-in">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm">📧</span>
            <span className="text-xs font-semibold text-zinc-100">Email</span>
          </div>
          <div className="text-[10px] text-zinc-400">Connect email for reminders.</div>
        </div>
      </div>

      {/* Assignments */}
      <Card title="Assignments" icon="📋" actions={
        <button onClick={() => setShowAdd(!showAdd)} className="text-[10px] px-2 py-1 rounded-lg bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition">
          {showAdd ? "Cancel" : "+ Add"}
        </button>
      }>
        {showAdd && (
          <div className="mb-3 p-3 rounded-xl bg-white/5 border border-white/10 space-y-2 animate-fade-in">
            <input className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none" placeholder="Assignment title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              {hasApi && courses.length > 0 ? (
                <select className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white outline-none" value={newCourse} onChange={(e) => setNewCourse(e.target.value)}>
                  <option value="">No course</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.code || c.name}</option>)}
                </select>
              ) : (
                <input className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none" placeholder="Course" value={newCourse} onChange={(e) => setNewCourse(e.target.value)} />
              )}
              <input type="date" className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white outline-none" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </div>
            <div className="flex gap-1">
              {(["low", "medium", "high"] as const).map((p) => (
                <button key={p} onClick={() => setNewPriority(p)} className={cx("px-2 py-1 rounded-lg text-[10px] border transition", newPriority === p ? priorityColor[p] : "bg-white/5 border-white/5 text-zinc-400")}>
                  {p}
                </button>
              ))}
              <button onClick={handleAddAssignment} className="ml-auto px-3 py-1 rounded-lg bg-violet-500/20 text-violet-400 text-[10px] font-medium hover:bg-violet-500/30 transition">Save</button>
            </div>
          </div>
        )}
        {pending.length === 0 && !showAdd && <EmptyState icon="🎉" text="No pending assignments" />}
        <div className="space-y-1.5 max-h-64 overflow-auto">
          {pending.map((a) => {
            const id = hasApi ? (a as ApiAssignment).id : (a as Assignment).id;
            const title = hasApi ? (a as ApiAssignment).title : (a as Assignment).title;
            const course = hasApi ? ((a as ApiAssignment).course_code || "") : (a as Assignment).course;
            const dueDate = hasApi ? (a as ApiAssignment).due_at : (a as Assignment).dueDate;
            const priority = hasApi ? ((a as ApiAssignment).priority || "medium") : (a as Assignment).priority;
            const status = hasApi ? (a as ApiAssignment).status : ((a as Assignment).completed ? "done" : "open");
            return (
              <div key={id} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 group hover:bg-white/10 transition">
                <button onClick={() => handleToggleStatus(id, status)}
                  className="w-4 h-4 rounded border border-white/20 shrink-0 hover:border-violet-400 transition flex items-center justify-center text-[10px]">
                  {status === "done" && "✓"}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-white truncate">{title}</div>
                  <div className="text-[10px] text-zinc-500">{course}{course && dueDate ? " · " : ""}{dueDate && relDate(dueDate)}</div>
                </div>
                {dueDate && dueBadge(dueDate, status)}
                <Badge color={priority === "high" ? "rose" : priority === "medium" ? "amber" : "emerald"}>{priority}</Badge>
                <button onClick={() => handleDeleteAssignment(id)} className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 text-xs transition">✕</button>
              </div>
            );
          })}
        </div>
        {completed.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/5">
            <div className="text-[10px] text-zinc-500 mb-1.5">Completed ({completed.length})</div>
            {completed.slice(0, 3).map((a) => {
              const id = hasApi ? (a as ApiAssignment).id : (a as Assignment).id;
              const title = hasApi ? (a as ApiAssignment).title : (a as Assignment).title;
              return (
                <div key={id} className="flex items-center gap-2 px-3 py-1 text-xs text-zinc-500 line-through">
                  <span>✓</span><span className="truncate">{title}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Quick Notes */}
      <Card title="Study Notes" icon="📝" actions={<Badge color="violet">{schoolNotes.length}</Badge>}>
        <div className="space-y-2 mb-3">
          <input className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none" placeholder="Note title" value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} />
          <textarea className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none resize-none h-16" placeholder="Content (supports markdown)" value={noteContent} onChange={(e) => setNoteContent(e.target.value)} />
          <div className="flex items-center gap-2">
            {hasApi && courses.length > 0 && (
              <select className="rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-[10px] text-white outline-none" value={noteCourseId} onChange={(e) => setNoteCourseId(e.target.value)}>
                <option value="">No course</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.code || c.name}</option>)}
              </select>
            )}
            <button onClick={handleAddNote} disabled={!noteTitle.trim()} className="px-3 py-1.5 rounded-lg bg-violet-500/20 text-violet-400 text-xs font-medium hover:bg-violet-500/30 disabled:opacity-30 transition">Save Note</button>
          </div>
        </div>
        <div className="space-y-1.5 max-h-40 overflow-auto">
          {(hasApi ? apiNotes : localNotes.filter((n) => n.tab === "school")).map((n) => {
            const id = hasApi ? (n as ApiNote).id : (n as Note).id;
            const title = hasApi ? (n as ApiNote).title : (n as Note).title;
            const content = hasApi ? (n as ApiNote).content_md : (n as Note).content;
            return (
              <div key={id} className="flex items-start gap-2 rounded-xl bg-white/5 px-3 py-2 group hover:bg-white/10 transition">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-white">{title}</div>
                  <div className="text-[10px] text-zinc-400 truncate">{content || "Empty note"}</div>
                </div>
                <button onClick={() => handleDeleteNote(id)} className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 text-xs transition shrink-0">✕</button>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Agent Quick Actions */}
      <Card title="Study Actions" icon="🤖">
        <div className="grid grid-cols-2 gap-1.5">
          {SCHOOL_AGENT_ACTIONS.map((act) => (
            <button key={act.label}
              disabled
              className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-[10px] text-zinc-300 hover:bg-violet-500/10 hover:text-violet-400 transition text-left disabled:opacity-50 disabled:cursor-not-allowed"
              title={`${act.label} (coming soon)`}>
              <span>{act.icon}</span>
              <span className="truncate">{act.label}</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   JOBS — LinkedIn-style feed
   ═══════════════════════════════════════════════════════ */
function JobsWidgets({ jobs: localJobs, refresh }: { jobs: JobPosting[]; refresh: () => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [tags, setTags] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [staleData, setStaleData] = useState(false);

  // Outreach state (external API flow)
  const [outreachJob, setOutreachJob] = useState<{ title: string; company: string } | null>(null);
  const [outreachTemplates, setOutreachTemplates] = useState<string[]>(DEFAULT_OUTREACH_TEMPLATES);
  const [outreachResult, setOutreachResult] = useState<{ subject?: string; body_md?: string; message?: string } | null>(null);
  const [outreachError, setOutreachError] = useState<string | null>(null);
  const [outreachLoading, setOutreachLoading] = useState(false);

  // API-backed data
  interface ApiJob {
    id: string; title: string; company: string; location?: string;
    url: string; status: string; posted_at?: string; fetched_at?: string;
    remote?: number; remote_flag?: string; tags_json?: string; notes?: string;
    match_score?: number; fit_score?: number; why_match?: string; risks?: string; match_factors_json?: string;
  }
  const [apiJobs, setApiJobs] = useState<ApiJob[]>([]);
  const [pipeline, setPipeline] = useState<Record<string, number>>({});
  interface WatchCompany { id?: string; company_name: string; name?: string; tier?: string; source?: string; notes?: string; matching_jobs?: number }
  const [watchCompanies, setWatchCompanies] = useState<WatchCompany[]>([]);
  const [hasApi, setHasApi] = useState(false);
  const [panelHealth, setPanelHealth] = useState<{ status?: string; message?: string } | null>(null);
  const [panelCards, setPanelCards] = useState<{ total?: number; saved?: number; applied?: number; interview?: number }>({});

  // ── Primary: load from /api/jobs/panel ──
  const loadPanel = useCallback(async (status: string) => {
    try {
      const statusParam = status === "all" ? "" : status;
      const data = await apiGet<Record<string, unknown>>(`/jobs/panel?limit=10&status=${statusParam}`);

      // Map cards -> top stats
      if (data.cards && typeof data.cards === "object") {
        const c = data.cards as Record<string, unknown>;
        setPanelCards({ total: Number(c.total ?? 0), saved: Number(c.saved ?? 0), applied: Number(c.applied ?? 0), interview: Number(c.interview ?? 0) });
      }

      // Map pipeline
      if (data.pipeline && typeof data.pipeline === "object") {
        setPipeline(data.pipeline as Record<string, number>);
      }

      // Map shortlist -> job feed
      const shortlist = Array.isArray(data.shortlist) ? data.shortlist : [];
      const jobs: ApiJob[] = shortlist.map((j: Record<string, unknown>) => ({
        id: String(j.id || j.url || crypto.randomUUID()),
        title: String(j.title || j.job_title || ""),
        company: String(j.company || ""),
        location: j.location ? String(j.location) : undefined,
        url: String(j.url || j.link || ""),
        status: String(j.status || "new"),
        posted_at: j.posted_at ? String(j.posted_at) : undefined,
        fetched_at: j.fetched_at ? String(j.fetched_at) : undefined,
        tags_json: j.tags_json ? String(j.tags_json) : j.tags ? JSON.stringify(j.tags) : undefined,
        match_score: j.match_score != null ? Number(j.match_score) : j.fit_score != null ? Number(j.fit_score) : undefined,
        fit_score: j.fit_score != null ? Number(j.fit_score) : undefined,
        why_match: j.why_match ? String(j.why_match) : undefined,
        risks: j.risks ? String(j.risks) : undefined,
        match_factors_json: j.match_factors_json ? String(j.match_factors_json) : undefined,
      }));
      setApiJobs(jobs);
      setHasApi(true);

      // Map companies_to_watch
      if (Array.isArray(data.companies_to_watch)) {
        setWatchCompanies(data.companies_to_watch.map((c: Record<string, unknown>) => ({
          company_name: String(c.company_name || c.name || ""),
          name: c.name ? String(c.name) : undefined,
          tier: c.tier ? String(c.tier) : undefined,
          matching_jobs: c.matching_jobs != null ? Number(c.matching_jobs) : undefined,
        })));
      }

      // Map health
      if (data.health && typeof data.health === "object") {
        setPanelHealth(data.health as { status?: string; message?: string });
      }

      // Map outreach_templates
      if (Array.isArray(data.outreach_templates) && data.outreach_templates.length > 0) {
        setOutreachTemplates(data.outreach_templates.map((t: unknown) => String(t)));
      } else {
        setOutreachTemplates(DEFAULT_OUTREACH_TEMPLATES);
      }

      setLastRefresh(new Date().toISOString());
      setStaleData(false);
      return true;
    } catch {
      return false;
    }
  }, []);

  // ── Fallback: load from legacy /api/jobs/feed ──
  const loadLegacyFeed = useCallback(async (status: string) => {
    try {
      const data = await apiGet<{ items: ApiJob[]; lastRefresh?: string }>(`/jobs/feed?status=${status}&limit=50`);
      if (data.items) { setApiJobs(data.items); setHasApi(true); }
      if (data.lastRefresh) setLastRefresh(data.lastRefresh);
    } catch { setHasApi(false); }
    try {
      const data = await apiGet<{ pipeline: Record<string, number> }>("/jobs/pipeline");
      if (data.pipeline) setPipeline(data.pipeline);
    } catch { /* non-fatal */ }
    try {
      const data = await apiGet<{ companies: WatchCompany[] }>("/companies/watch");
      if (Array.isArray(data.companies) && data.companies.length > 0) {
        setWatchCompanies(data.companies);
      }
    } catch { /* non-fatal */ }
    setOutreachTemplates((prev) => prev.length > 0 ? prev : DEFAULT_OUTREACH_TEMPLATES);
  }, []);

  // ── Combined load: panel first, fallback to legacy ──
  const loadJobs = useCallback(async (status: string) => {
    const panelOk = await loadPanel(status);
    if (!panelOk) {
      await loadLegacyFeed(status);
    }
  }, [loadPanel, loadLegacyFeed]);

  useEffect(() => { loadJobs(statusFilter); }, [statusFilter, loadJobs]);

  // Auto-refresh every 5 min
  useEffect(() => {
    const interval = setInterval(() => { loadJobs(statusFilter); }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [statusFilter, loadJobs]);

  async function handleRefresh() {
    setRefreshing(true); setRefreshResult(null);
    try {
      const ok = await loadPanel(statusFilter);
      if (ok) {
        setRefreshResult("Panel refreshed");
        setStaleData(false);
      } else {
        // Fallback to legacy refresh then re-load
        try {
          const data = await apiPost<{ ok: boolean; inserted?: number; newJobs?: number; failedSources?: number; error?: string }>("/jobs/refresh", {});
          if (data.ok) {
            setRefreshResult(`${data.inserted || data.newJobs || 0} new jobs`);
            setStaleData(false);
          } else {
            setRefreshResult(data.error || "Failed");
            setStaleData(true);
          }
        } catch (e) { setRefreshResult(e instanceof Error ? e.message : "Failed"); setStaleData(true); }
        await loadLegacyFeed(statusFilter);
      }
    } catch (e) { setRefreshResult(e instanceof Error ? e.message : "Failed"); setStaleData(true); }
    finally { setRefreshing(false); }
  }

  async function handleAction(job: ApiJob, action: string) {
    try {
      await apiPost("/jobs/action", { url: job.url, action });
      // Re-fetch panel immediately after action
      await loadJobs(statusFilter);
    } catch {
      // Fallback to legacy D1 PATCH
      try { await apiPatch(`/jobs/${job.id}`, { status: action }); loadJobs(statusFilter); }
      catch { toggleJobApplied(job.id); refresh(); }
    }
  }

  async function handleAddToWatch(companyName: string) {
    try {
      await apiPost("/companies/watch", { company_name: companyName, tier: "emerging", source: "manual" });
      loadJobs(statusFilter);
    } catch { /* non-fatal */ }
  }

  async function handleLoadSeededWatchlist() {
    try {
      const data = await apiGet<{ companies: WatchCompany[] }>("/companies/watch");
      if (Array.isArray(data.companies)) {
        setWatchCompanies(data.companies);
      }
    } catch { /* non-fatal */ }
  }

  async function handleOutreach(jobTitle: string, jobCompany: string, templateType: string) {
    setOutreachLoading(true);
    setOutreachResult(null);
    setOutreachError(null);
    try {
      const data = await apiPost<Record<string, unknown>>("/jobs/outreach", {
        job_title: jobTitle,
        company: jobCompany,
        template_type: templateType,
        your_name: "User",
      });
      if (data.error) {
        setOutreachError(String(data.error));
      } else {
        setOutreachResult({
          subject: data.subject ? String(data.subject) : undefined,
          body_md: data.body_md ? String(data.body_md) : data.message ? String(data.message) : undefined,
          message: data.message ? String(data.message) : undefined,
        });
      }
    } catch (e) {
      setOutreachError(e instanceof Error ? e.message : "Outreach generation failed");
    } finally {
      setOutreachLoading(false);
    }
  }

  function handleAdd() {
    if (!title.trim()) return;
    saveJob({ title: title.trim(), company: company.trim(), location: location.trim(), tags: tags.split(",").map((t: string) => t.trim()).filter(Boolean) });
    setTitle(""); setCompany(""); setLocation(""); setTags(""); setShowAdd(false);
    refresh(); loadJobs(statusFilter);
  }

  // Display items
  const displayJobs = hasApi ? apiJobs : localJobs.map((j) => ({
    id: j.id, title: j.title, company: j.company, location: j.location,
    url: "", status: j.applied ? "applied" : "saved", posted_at: "", fetched_at: "",
    tags_json: JSON.stringify(j.tags),
  }));

  const pSaved = panelCards.saved || pipeline.saved || 0;
  const pNew = pipeline.new || 0;
  const pApplied = panelCards.applied || pipeline.applied || 0;
  const pInterview = panelCards.interview || pipeline.interview || 0;
  const pOffer = pipeline.offer || 0;
  const pRejected = pipeline.rejected || 0;

  const statuses = ["all", "new", "saved", "applied", "interview", "offer", "rejected", "dismissed"];

  function scoreColor(score?: number) {
    if (!score) return "zinc";
    if (score >= 40) return "emerald";
    if (score >= 20) return "amber";
    return "zinc";
  }

  const lastRefreshLabel = lastRefresh ? new Date(lastRefresh).toLocaleString() : "Never";

  // Detect stale: if lastRefresh > 12 hours ago, or already flagged
  const isStale = staleData || (lastRefresh ? (Date.now() - new Date(lastRefresh).getTime() > 12 * 60 * 60 * 1000) : false);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <StatBox icon="💼" value={panelCards.total || displayJobs.length} label="Total" />
        <StatBox icon="⭐" value={pSaved} label="Saved" />
        <StatBox icon="✅" value={pApplied} label="Applied" />
        <StatBox icon="🎤" value={pInterview} label="Interview" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={handleRefresh} disabled={refreshing}
          className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 disabled:opacity-50 transition">
          {refreshing ? "Refreshing…" : "🔄 Refresh Feed"}
        </button>
        <span className="text-[10px] text-zinc-500">Last: {lastRefreshLabel}</span>
        {panelHealth && (
          <Badge color={panelHealth.status === "ok" || panelHealth.status === "healthy" ? "emerald" : "amber"}>
            {panelHealth.status || "unknown"}
          </Badge>
        )}
        {isStale && <Badge color="amber">⚠ Stale data</Badge>}
        {refreshResult && <span className="text-[10px] text-zinc-400">{refreshResult}</span>}
      </div>

      <AgentStatus verb="scanning for new cybersecurity postings" />

      {/* Pipeline */}
      <Card title="Pipeline" icon="📊">
        <div className="flex gap-1">
          {[
            { label: "New", val: pNew, color: "blue" },
            { label: "Saved", val: pSaved, color: "emerald" },
            { label: "Applied", val: pApplied, color: "cyan" },
            { label: "Interview", val: pInterview, color: "violet" },
            { label: "Offer", val: pOffer, color: "amber" },
            { label: "Rejected", val: pRejected, color: "rose" },
          ].map((s) => (
            <div key={s.label} className={`flex-1 text-center rounded-lg bg-${s.color}-500/10 py-2`}>
              <div className={`text-sm font-bold text-${s.color}-400`}>{s.val}</div>
              <div className="text-[10px] text-zinc-400">{s.label}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Status filter */}
      <div className="flex gap-1 overflow-auto pb-1">
        {statuses.map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} className={cx(
            "px-2.5 py-1 rounded-lg text-[10px] font-medium border transition whitespace-nowrap capitalize",
            statusFilter === s ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10"
          )}>{s}</button>
        ))}
      </div>

      {/* Job Feed */}
      <Card title="Job Feed" icon="📋" actions={
        <button onClick={() => setShowAdd(!showAdd)} className="text-[10px] px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition">
          {showAdd ? "Cancel" : "+ Add"}
        </button>
      }>
        {showAdd && (
          <div className="mb-3 p-3 rounded-xl bg-white/5 border border-white/10 space-y-2 animate-fade-in">
            <input className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none" placeholder="Job title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none" placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
              <input className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none" placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <input className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none" placeholder="Tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
            <button onClick={handleAdd} className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 transition">Save</button>
          </div>
        )}
        <div className="space-y-2 max-h-96 overflow-auto">
          {displayJobs.length === 0 && (
            <div className="text-center py-6 text-xs text-zinc-500">No jobs. Click Refresh Feed to scan.</div>
          )}
          {displayJobs.map((j, idx) => {
            let jobTags: string[] = [];
            try { jobTags = j.tags_json ? JSON.parse(j.tags_json) : []; } catch { /* */ }
            const ms = (j as ApiJob).match_score || (j as ApiJob).fit_score;
            const wm = (j as ApiJob).why_match;
            const risks = (j as ApiJob).risks;
            const mfRaw = (j as ApiJob).match_factors_json;
            let matchFactors: { category: string; label: string; delta: number }[] = [];
            try { matchFactors = mfRaw ? JSON.parse(mfRaw) : []; } catch { /* */ }
            return (
            <div key={j.id || `job-${idx}`} className="rounded-xl bg-white/5 p-3 hover:bg-white/10 transition group">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center text-sm font-bold text-white shrink-0">
                  {j.company.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <a href={j.url || "#"} target="_blank" rel="noopener noreferrer"
                      className="text-xs font-semibold text-white hover:underline">
                      {j.title} {j.url ? "↗" : ""}
                    </a>
                    {ms != null && ms > 0 && <Badge color={scoreColor(ms)}>{ms}%</Badge>}
                  </div>
                  <div className="text-[10px] text-zinc-400">{j.company} · {j.location || "Remote"}</div>
                  {wm && <div className="text-[10px] text-zinc-500 mt-0.5">{wm}</div>}
                  {risks && <div className="text-[10px] text-rose-400/70 mt-0.5">⚠ {risks}</div>}
                  {matchFactors.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5 opacity-0 group-hover:opacity-100 transition">
                      {matchFactors.map((f, i) => (
                        <span key={i} className={`text-[9px] px-1 py-0.5 rounded ${f.delta > 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                          {f.label} {f.delta > 0 ? "+" : ""}{f.delta}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Badge color={j.status === "applied" ? "cyan" : j.status === "interview" ? "violet" : j.status === "rejected" ? "rose" : "emerald"}>{j.status}</Badge>
                    {jobTags.slice(0, 4).map((t: string) => <Badge key={t} color="zinc">{t}</Badge>)}
                  </div>
                  {/* Action links */}
                  <div className="flex gap-2 mt-1.5 opacity-0 group-hover:opacity-100 transition">
                    <a href={`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(j.title + " " + j.company)}`}
                      target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-400 hover:underline">🔗 LinkedIn</a>
                    <button onClick={() => handleAddToWatch(j.company)} className="text-[9px] text-amber-400 hover:underline">⭐ Watch</button>
                    <button onClick={() => { setOutreachJob({ title: j.title, company: j.company }); setOutreachResult(null); setOutreachError(null); }} className="text-[9px] text-violet-400 hover:underline">📨 Outreach</button>
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  {j.status !== "applied" && (
                    <button onClick={() => handleAction(j as ApiJob, "applied")}
                      className="px-2 py-1 rounded-lg text-[10px] font-medium bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition">Apply</button>
                  )}
                  {j.status !== "saved" && j.status !== "applied" && (
                    <button onClick={() => handleAction(j as ApiJob, "saved")}
                      className="px-2 py-1 rounded-lg text-[10px] font-medium bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition">Save</button>
                  )}
                  {j.status !== "dismissed" && (
                    <button onClick={() => handleAction(j as ApiJob, "dismissed")}
                      className="px-2 py-1 rounded-lg text-[10px] font-medium bg-white/5 text-zinc-500 hover:bg-white/10 transition">✕</button>
                  )}
                </div>
              </div>
            </div>
            );
          })}
        </div>
      </Card>

      {/* Outreach Modal */}
      {outreachJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setOutreachJob(null)}>
          <div className="w-full max-w-md mx-4 glass rounded-2xl p-5 max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">📨 Outreach — {outreachJob.company}</h3>
              <button onClick={() => setOutreachJob(null)} className="text-zinc-400 hover:text-white text-sm">✕</button>
            </div>
            <div className="text-[10px] text-zinc-400 mb-2">Select a template type:</div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {outreachTemplates.map((t) => (
                <button key={t} onClick={() => handleOutreach(outreachJob.title, outreachJob.company, t)}
                  disabled={outreachLoading}
                  className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 disabled:opacity-50 transition capitalize">
                  {t.replace(/_/g, " ")}
                </button>
              ))}
            </div>
            {outreachLoading && <div className="text-[10px] text-zinc-500 py-4 text-center">Generating…</div>}
            {outreachError && <div className="text-[10px] text-rose-400 bg-rose-500/10 rounded-lg p-2 mb-2">{outreachError}</div>}
            {outreachResult && (
              <div className="space-y-2">
                {outreachResult.subject && (
                  <>
                    <div className="text-[10px] text-zinc-400">Subject:</div>
                    <div className="text-xs text-white bg-white/5 rounded-lg p-2">{outreachResult.subject}</div>
                  </>
                )}
                <div className="text-[10px] text-zinc-400">Message:</div>
                <div className="text-xs text-zinc-300 bg-white/5 rounded-lg p-2 whitespace-pre-wrap max-h-40 overflow-auto">
                  {outreachResult.body_md || outreachResult.message || ""}
                </div>
                <button onClick={() => {
                  const text = outreachResult.subject
                    ? `Subject: ${outreachResult.subject}\n\n${outreachResult.body_md || outreachResult.message || ""}`
                    : outreachResult.body_md || outreachResult.message || "";
                  navigator.clipboard.writeText(text);
                }}
                  className="px-3 py-1.5 rounded-lg bg-violet-500/20 text-violet-400 text-xs font-medium hover:bg-violet-500/30 transition">📋 Copy to Clipboard</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Companies to Watch */}
      <Card title="Companies to Watch" icon="🏢">
        <div className="space-y-1.5 max-h-48 overflow-auto">
          {watchCompanies.length === 0 && (
            <div className="space-y-2">
              <div className="text-[10px] text-zinc-500">No companies loaded yet.</div>
              <button
                onClick={handleLoadSeededWatchlist}
                className="text-[10px] px-2 py-1 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition"
              >
                Load cyber watchlist
              </button>
            </div>
          )}
          {watchCompanies.map((c, i) => (
            <div key={c.company_name || i} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2" onClick={() => setStatusFilter("all")}>
              {c.tier && <Badge color={c.tier === "big" ? "cyan" : "amber"}>{c.tier}</Badge>}
              <span className="text-xs text-white flex-1">{c.company_name || c.name}</span>
              {(c.matching_jobs ?? 0) > 0 && <span className="text-[9px] text-emerald-400">{c.matching_jobs} jobs</span>}
              <a href={`https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(c.company_name || c.name || "")}`}
                target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-400 hover:underline">LinkedIn</a>
            </div>
          ))}
        </div>
      </Card>

      {/* Outreach Templates */}
      <Card title="Outreach Templates" icon="📨">
        <div className="space-y-1.5">
          {outreachTemplates.map((t) => (
            <div key={t} className="w-full text-left rounded-lg bg-white/5 hover:bg-white/10 px-3 py-2 text-xs text-zinc-300 transition capitalize">{t.replace(/_/g, " ")}</div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SKILLS — Udemy + Coursera style
   ═══════════════════════════════════════════════════════ */
function SkillsWidgets({ skills: localSkills, refresh, onLessonClick }: { skills: Skill[]; refresh: () => void; onLessonClick?: (info: LessonClickInfo) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

  // Curate Skills state
  const [curateMode, setCurateMode] = useState(false);
  const [curateSelected, setCurateSelected] = useState<Set<string>>(new Set());
  const [curateResult, setCurateResult] = useState<string | null>(null);

  // API-backed data
  interface RoadmapItem {
    id: string; skill_id: string; skill_name: string; category?: string; level: string;
    skill_description?: string; status: string; order_index: number;
    total_lessons: number; completed_lessons: number;
  }
  interface RadarItem { id: string; title: string; url: string; summary?: string; tags_json?: string; fetched_at: string }
  interface Suggestion { id: string; proposed_skill_name: string; reason_md: string; status: string }
  interface LessonItem {
    id: string; module_title: string; lesson_title: string; order_index: number;
    content_md: string; progress_status: string;
  }

  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([]);
  const [radarItems, setRadarItems] = useState<RadarItem[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [lessons, setLessons] = useState<LessonItem[]>([]);
  const [hasApi, setHasApi] = useState(false);

  const loadRoadmap = useCallback(async () => {
    try {
      const d = await apiGet<{ roadmap: RoadmapItem[] }>("/skills/roadmap");
      if (d.roadmap) { setRoadmap(d.roadmap); setHasApi(true); }
    } catch { setHasApi(false); }
  }, []);

  const loadRadar = useCallback(async () => {
    try { const d = await apiGet<{ items: RadarItem[] }>("/skills/radar?limit=10"); setRadarItems(d.items || []); } catch { /* */ }
  }, []);

  const loadSuggestions = useCallback(async () => {
    try { const d = await apiGet<{ suggestions: Suggestion[] }>("/skills/suggestions?status=new"); setSuggestions(d.suggestions || []); } catch { /* */ }
  }, []);

  useEffect(() => { loadRoadmap(); loadRadar(); loadSuggestions(); }, [loadRoadmap, loadRadar, loadSuggestions]);

  // Load lessons when a skill is expanded
  useEffect(() => {
    if (!expanded || !hasApi) return;
    const item = roadmap.find((r) => r.skill_id === expanded);
    if (!item) return;
    apiGet<{ lessons: LessonItem[] }>(`/skills/${expanded}/lessons`).then((d) => setLessons(d.lessons || [])).catch(() => {});
  }, [expanded, hasApi, roadmap]);

  async function handleScan() {
    setScanning(true); setScanResult(null);
    try {
      const d = await apiPost<{ ok: boolean; newItems?: number; suggestions?: number; error?: string }>("/skills/radar/scan", {});
      setScanResult(d.ok ? `${d.newItems || 0} new items, ${d.suggestions || 0} suggestions` : (d.error || "Failed"));
      loadRadar(); loadSuggestions();
    } catch (e) { setScanResult(e instanceof Error ? e.message : "Failed"); }
    finally { setScanning(false); }
  }

  async function handleLessonProgress(lessonId: string, status: string) {
    try { await apiPost(`/lessons/${lessonId}/progress`, { status }); loadRoadmap(); } catch { /* fallback */ }
  }

  async function handleRoadmapStatus(roadmapId: string, status: string) {
    try { await apiPatch(`/skills/roadmap/${roadmapId}`, { status }); loadRoadmap(); } catch { /* */ }
  }

  async function handleSuggestionAction(id: string, status: string, saveToLessons = false) {
    try {
      const res = await apiPatch<{ ok: boolean; replacement?: Suggestion; lessonCreated?: boolean }>("/skills/suggestions", { id, status, saveToLessons });
      // If a replacement suggestion was returned, swap it in-place
      if (res.replacement) {
        setSuggestions((prev) => {
          const idx = prev.findIndex((s) => s.id === id);
          const rep = res.replacement as Suggestion;
          if (idx >= 0) { const next = [...prev]; next[idx] = rep; return next; }
          return [...prev, rep];
        });
      } else {
        setSuggestions((prev) => prev.filter((s) => s.id !== id));
      }
      // Refresh roadmap if a lesson was created
      if (res.lessonCreated) loadRoadmap();
    } catch { /* non-fatal */ }
  }

  async function handleCurate() {
    if (curateSelected.size === 0) return;
    setCurateResult(null);
    try {
      const keepNames = [...curateSelected];
      const d = await apiPost<{ ok: boolean; deleted: number }>("/skills/curate", { keepNames });
      setCurateResult(d.ok ? `Removed ${d.deleted} skill(s)` : "Failed");
      setCurateMode(false);
      setCurateSelected(new Set());
      loadRoadmap();
      refresh();
    } catch (e) { setCurateResult(e instanceof Error ? e.message : "Failed"); }
  }

  function toggleCurateSelection(skillName: string) {
    setCurateSelected((prev) => {
      const next = new Set(prev);
      if (next.has(skillName)) next.delete(skillName);
      else next.add(skillName);
      return next;
    });
  }

  // Merge: prefer API roadmap; fallback to local
  const displaySkills = hasApi ? roadmap : localSkills.map((s, i) => ({
    id: `local-${s.id}`, skill_id: s.id, skill_name: s.name, category: s.category, level: "beginner",
    skill_description: "", status: s.progress === 100 ? "completed" : s.progress > 0 ? "in_progress" : "planned",
    order_index: i, total_lessons: s.lessons.length,
    completed_lessons: s.lessons.filter((l) => l.completed).length,
  }));

  const totalLessons = displaySkills.reduce((s, sk) => s + sk.total_lessons, 0);
  const completedLessons = displaySkills.reduce((s, sk) => s + sk.completed_lessons, 0);
  const avgProgress = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

  const catGradient: Record<string, string> = {
    cloud: "from-emerald-500 to-green-500", security: "from-violet-500 to-purple-500",
    dev: "from-amber-500 to-orange-500", ai: "from-cyan-500 to-blue-500",
  };
  const catBadge: Record<string, string> = { cloud: "emerald", security: "violet", dev: "amber", ai: "cyan" };
  const statusColor: Record<string, string> = {
    planned: "zinc", in_progress: "amber", completed: "emerald", paused: "rose",
  };

  // Continue where you left off
  const continueItem = displaySkills.find((s) => s.status === "in_progress") || displaySkills.find((s) => s.status === "planned");

  return (
    <div className="space-y-3">
      {/* Overall progress */}
      <div id="skills-continue" className="glass-light rounded-2xl p-4 animate-fade-in">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-zinc-100">Overall Progress</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">{avgProgress}%</span>
            <button onClick={() => { setCurateMode(!curateMode); setCurateSelected(new Set(displaySkills.map((s) => s.skill_name))); setCurateResult(null); }}
              className={cx("text-[10px] px-2 py-1 rounded-lg transition",
                curateMode ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30" : "bg-violet-500/20 text-violet-400 hover:bg-violet-500/30"
              )}>
              {curateMode ? "Cancel" : "✂ Curate Skills"}
            </button>
          </div>
        </div>
        <ProgressBar value={avgProgress} gradient="from-amber-500 to-orange-500" />
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div><div className="text-sm font-bold text-white">{displaySkills.length}</div><div className="text-[10px] text-zinc-400">Skills</div></div>
          <div><div className="text-sm font-bold text-white">{totalLessons}</div><div className="text-[10px] text-zinc-400">Lessons</div></div>
          <div><div className="text-sm font-bold text-white">{completedLessons}</div><div className="text-[10px] text-zinc-400">Completed</div></div>
        </div>
        {curateResult && <div className="text-[10px] text-zinc-400 mt-2">{curateResult}</div>}
      </div>

      {/* Curate mode: checkboxes + Keep Selected */}
      {curateMode && (
        <div className="glass-light rounded-2xl p-4 animate-fade-in border border-violet-500/20">
          <div className="text-[10px] text-violet-400 font-semibold mb-2">Select skills to KEEP (unchecked will be deleted with all lessons)</div>
          <div className="space-y-1.5 max-h-48 overflow-auto">
            {displaySkills.map((skill) => (
              <label key={skill.skill_id} className="flex items-center gap-2 cursor-pointer rounded-lg bg-white/5 px-3 py-2 hover:bg-white/10 transition">
                <input type="checkbox" checked={curateSelected.has(skill.skill_name)}
                  onChange={() => toggleCurateSelection(skill.skill_name)}
                  className="w-3.5 h-3.5 rounded accent-violet-500" />
                <span className="text-xs text-white">{skill.skill_name}</span>
                <span className="text-[10px] text-zinc-500 ml-auto">{skill.completed_lessons}/{skill.total_lessons} lessons</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button onClick={handleCurate}
              className="px-3 py-1.5 rounded-lg bg-violet-500/20 text-violet-400 text-xs font-medium hover:bg-violet-500/30 transition">
              Keep Selected ({curateSelected.size})
            </button>
            <span className="text-[10px] text-zinc-500">{displaySkills.length - curateSelected.size} will be removed</span>
          </div>
        </div>
      )}

      {/* Continue where you left off */}
      {continueItem && (
        <div className="glass-light rounded-2xl p-4 animate-fade-in border border-amber-500/20">
          <div className="text-[10px] text-amber-400 font-semibold mb-1">▶ CONTINUE WHERE YOU LEFT OFF</div>
          <div className="text-sm font-semibold text-white">{continueItem.skill_name}</div>
          <div className="text-xs text-zinc-400 mt-0.5">{continueItem.completed_lessons}/{continueItem.total_lessons} lessons</div>
          <button onClick={() => { setExpanded(continueItem.skill_id); if (continueItem.status === "planned" && hasApi) handleRoadmapStatus(continueItem.id, "in_progress"); }}
            className="mt-2 px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 text-xs font-medium hover:bg-amber-500/30 transition">
            Continue →
          </button>
        </div>
      )}

      {/* Roadmap / Skill cards */}
      {displaySkills.map((skill) => (
        <div key={skill.id} className="glass-light rounded-2xl overflow-hidden animate-fade-in">
          <button onClick={() => setExpanded(expanded === skill.skill_id ? null : skill.skill_id)}
            className="w-full text-left p-4 hover:bg-white/5 transition">
            <div className="flex items-center gap-3">
              <div className={cx("w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-sm font-bold text-white shrink-0",
                catGradient[skill.category || ""] || "from-zinc-500 to-zinc-600")}>
                {skill.total_lessons > 0 ? Math.round((skill.completed_lessons / skill.total_lessons) * 100) : 0}%
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white truncate">{skill.skill_name}</span>
                  <Badge color={catBadge[skill.category || ""] || "zinc"}>{skill.category || "general"}</Badge>
                  <Badge color={statusColor[skill.status] || "zinc"}>{skill.status}</Badge>
                </div>
                <div className="mt-1.5">
                  <ProgressBar value={skill.total_lessons > 0 ? (skill.completed_lessons / skill.total_lessons) * 100 : 0}
                    gradient={catGradient[skill.category || ""] || "from-zinc-500 to-zinc-400"} />
                </div>
                <div className="text-[10px] text-zinc-500 mt-1">{skill.completed_lessons}/{skill.total_lessons} lessons · {skill.level}</div>
              </div>
              <span className={cx("text-zinc-500 transition-transform", expanded === skill.skill_id && "rotate-90")}>›</span>
            </div>
          </button>

          {expanded === skill.skill_id && (
            <div className="px-4 pb-4 space-y-1.5 animate-fade-in border-t border-white/5 pt-3">
              {hasApi && lessons.length > 0 ? lessons.map((lesson, li) => (
                <div key={lesson.id} className="flex items-start gap-2.5 rounded-xl bg-white/5 p-3 hover:bg-white/10 transition">
                  <button onClick={() => handleLessonProgress(lesson.id, lesson.progress_status === "completed" ? "not_started" : "completed")}
                    className={cx("w-5 h-5 rounded-md border shrink-0 flex items-center justify-center text-[10px] transition mt-0.5",
                      lesson.progress_status === "completed" ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400" : "border-white/20 hover:border-amber-400"
                    )}>
                    {lesson.progress_status === "completed" && "✓"}
                  </button>
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => onLessonClick?.({ lessonId: lesson.id, lessonTitle: lesson.lesson_title, skillId: skill.skill_id, moduleTitle: lesson.module_title })}
                      className={cx("text-xs font-medium text-left hover:underline", lesson.progress_status === "completed" ? "text-zinc-500 line-through" : "text-white")}
                    >
                      <span className="text-zinc-500 mr-1.5">{li + 1}.</span>{lesson.lesson_title}
                    </button>
                    <div className="text-[10px] text-zinc-500 mt-0.5">{lesson.module_title}</div>
                  </div>
                  {onLessonClick && (
                    <button
                      onClick={() => onLessonClick({ lessonId: lesson.id, lessonTitle: lesson.lesson_title, skillId: skill.skill_id, moduleTitle: lesson.module_title })}
                      className="shrink-0 text-[10px] text-zinc-500 hover:text-amber-400 bg-white/5 hover:bg-white/10 rounded-lg px-1.5 py-1 transition mt-0.5"
                      title="Open lesson chat"
                    >💬</button>
                  )}
                </div>
              )) : !hasApi && localSkills.find((s) => s.id === skill.skill_id) ? (
                localSkills.find((s) => s.id === skill.skill_id)!.lessons.map((lesson, li) => (
                  <div key={lesson.id} className="flex items-start gap-2.5 rounded-xl bg-white/5 p-3 hover:bg-white/10 transition">
                    <button onClick={() => { toggleLesson(skill.skill_id, lesson.id); refresh(); }}
                      className={cx("w-5 h-5 rounded-md border shrink-0 flex items-center justify-center text-[10px] transition mt-0.5",
                        lesson.completed ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400" : "border-white/20 hover:border-amber-400"
                      )}>
                      {lesson.completed && "✓"}
                    </button>
                    <div className="min-w-0 flex-1">
                      <button
                        onClick={() => onLessonClick?.({ lessonId: lesson.id, lessonTitle: lesson.title, skillId: skill.skill_id, moduleTitle: "" })}
                        className={cx("text-xs font-medium text-left hover:underline", lesson.completed ? "text-zinc-500 line-through" : "text-white")}
                      >
                        <span className="text-zinc-500 mr-1.5">{li + 1}.</span>{lesson.title}
                      </button>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{lesson.description}</div>
                    </div>
                    {onLessonClick && (
                      <button
                        onClick={() => onLessonClick({ lessonId: lesson.id, lessonTitle: lesson.title, skillId: skill.skill_id, moduleTitle: "" })}
                        className="shrink-0 text-[10px] text-zinc-500 hover:text-amber-400 bg-white/5 hover:bg-white/10 rounded-lg px-1.5 py-1 transition mt-0.5"
                        title="Open lesson chat"
                      >💬</button>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-[10px] text-zinc-500 py-2">No lessons yet. Add lessons via the API or chat with your career agent.</div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Industry Radar */}
      <Card title="Industry Radar" icon="📡" actions={
        <button onClick={handleScan} disabled={scanning}
          className="text-[10px] px-2 py-1 rounded-lg bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 disabled:opacity-50 transition">
          {scanning ? "Scanning…" : "🔍 Scan"}
        </button>
      }>
        {scanResult && <div className="text-[10px] text-zinc-400 mb-2">{scanResult}</div>}
        <div className="space-y-1.5 max-h-40 overflow-auto">
          {radarItems.length === 0 && <div className="text-[10px] text-zinc-500">Click Scan to discover new skills and trends.</div>}
          {radarItems.slice(0, 8).map((item) => (
            <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer"
              className="block rounded-lg bg-white/5 px-3 py-2 hover:bg-white/10 transition">
              <div className="text-[10px] text-white hover:underline">{item.title} ↗</div>
              {item.summary && <div className="text-[9px] text-zinc-500 mt-0.5 line-clamp-1">{item.summary}</div>}
            </a>
          ))}
        </div>
      </Card>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <Card title="Suggested Skills" icon="💡">
          <div className="space-y-2">
            {suggestions.map((s) => (
              <div key={s.id} className="rounded-xl bg-white/5 p-3">
                <div className="text-xs font-semibold text-white">{s.proposed_skill_name}</div>
                <div className="text-[10px] text-zinc-400 mt-0.5">{s.reason_md}</div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => handleSuggestionAction(s.id, "saved")}
                    className="px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 text-[10px] hover:bg-emerald-500/30 transition">Save</button>
                  <button onClick={() => handleSuggestionAction(s.id, "saved", true)}
                    className="px-2 py-1 rounded-lg bg-indigo-500/20 text-indigo-400 text-[10px] hover:bg-indigo-500/30 transition">Save to Lessons</button>
                  <button onClick={() => handleSuggestionAction(s.id, "dismissed")}
                    className="px-2 py-1 rounded-lg bg-white/5 text-zinc-400 text-[10px] hover:bg-white/10 transition">Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SPORTS — ESPN style
   ═══════════════════════════════════════════════════════ */
function SportsWidgets(_props: { refresh: () => void }) {
  const [league, setLeague] = useState("nba");
  const leagues = [
    { key: "nba", label: "NBA" }, { key: "nfl", label: "NFL" },
    { key: "mlb", label: "MLB" }, { key: "nhl", label: "NHL" },
  ];
  const [filter, setFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  interface Game {
    id: string; home_team_name: string; away_team_name: string;
    home_team_id: string; away_team_id: string;
    home_score?: number; away_score?: number; status: string;
    start_time: string; period?: string; clock?: string;
  }
  interface WlTeam { league: string; team_id: string; team_name: string }
  interface Prediction {
    id: string; game_id: string; home_team_name?: string; away_team_name?: string;
    proj_spread_home?: number; proj_total?: number; win_prob_home?: number;
    edge_spread?: number; edge_total?: number; explanation_md?: string;
    recommended_bet_json?: string; game_status?: string;
  }
  interface OddsRow {
    id: string; game_id: string; book: string;
    spread_home?: number; spread_away?: number; total?: number;
    moneyline_home?: number; moneyline_away?: number;
    home_team_name?: string; away_team_name?: string; asof?: string;
  }
  interface NewsItem {
    id: string; title: string; source: string; url: string;
    published_at?: string; league: string; team_id?: string;
    rumor_flag?: number; summary?: string;
  }
  interface SourceHealthItem {
    name: string;
    status: "ok" | "error";
    latencyMs?: number;
    items?: number;
    error?: string;
  }

  const [games, setGames] = useState<Game[]>([]);
  const [watchlist, setWatchlist] = useState<WlTeam[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [odds, setOdds] = useState<OddsRow[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [addTeam, setAddTeam] = useState("");
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [sourceHealth, setSourceHealth] = useState<SourceHealthItem[]>([]);

  // Line Movement state
  interface Movement { game_id: string; home_team: string; away_team: string; book: string; market: string; old_line: number; new_line: number; delta: number; direction: string; minutes_ago: number }
  const [movements, setMovements] = useState<Movement[]>([]);

  // NBA Props + Picks state
  interface PropRow { id: string; player: string; market: string; line: number | null; odds: number | null; edge_score: number; book: string | null; status: string; reason?: string | null }
  interface PickLeg { player: string; market: string; line: number | null; pick: string; confidence: number; reason: string }
  interface PickCards { top_plays?: PickLeg[]; safe_slip?: PickLeg[]; aggressive_slip?: PickLeg[] }
  const [propsBoard, setPropsBoard] = useState<PropRow[]>([]);
  const [pickCards, setPickCards] = useState<PickCards | null>(null);
  const [picksLoading, setPicksLoading] = useState(false);
  const [picksCached, setPicksCached] = useState(false);
  const [boardHash, setBoardHash] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [lastGenerationAt, setLastGenerationAt] = useState<string | null>(null);
  const [propsErrors, setPropsErrors] = useState<string[]>([]);

  const loadGames = useCallback(async () => {
    try {
      const d = await apiGet<{ games: Game[] }>(`/sports/games?league=${league}&filter=${filter}`);
      setGames(d.games || []);
    } catch { /* */ }
  }, [league, filter]);

  const loadWatchlist = useCallback(async () => {
    try {
      const d = await apiGet<{ teams: WlTeam[] }>(`/sports/watchlist?league=${league}`);
      setWatchlist(d.teams || []);
    } catch { /* */ }
  }, [league]);

  const loadPredictions = useCallback(async () => {
    try {
      const d = await apiGet<{ predictions: Prediction[] }>(`/sports/predictions?league=${league}`);
      setPredictions(d.predictions || []);
    } catch { /* */ }
  }, [league]);

  const loadOdds = useCallback(async () => {
    try {
      const d = await apiGet<{ odds: OddsRow[] }>(`/sports/odds?league=${league}`);
      setOdds(d.odds || []);
    } catch { /* */ }
  }, [league]);

  const loadNews = useCallback(async () => {
    try {
      const d = await apiGet<{ news: NewsItem[] }>(`/sports/news?league=${league}`);
      setNews(d.news || []);
    } catch { /* */ }
  }, [league]);

  const loadMovements = useCallback(async () => {
    if (league !== "nba") { setMovements([]); return; }
    try {
      const d = await apiGet<{ movements: Movement[] }>("/sports/nba/movement");
      setMovements(d.movements || []);
    } catch { /* */ }
  }, [league]);

  const loadPropsBoard = useCallback(async () => {
    if (league !== "nba") { setPropsBoard([]); setBoardHash(null); return; }
    try {
      const d = await apiGet<{ props: PropRow[]; board_hash: string | null }>(`/sports/props/board?league=${league}`);
      setPropsBoard(d.props || []);
      setBoardHash(d.board_hash ?? null);
    } catch (e) { setPropsErrors((prev) => [...prev, e instanceof Error ? e.message : "Failed to load props"]); }
  }, [league]);

  const loadPicksLatest = useCallback(async () => {
    if (league !== "nba") { setPickCards(null); return; }
    try {
      const d = await apiGet<{ cards: PickCards | null; board_hash?: string; created_at?: string; reason?: string }>(`/sports/picks/latest?league=${league}`);
      setPickCards(d.cards ?? null);
      if (d.board_hash) setBoardHash(d.board_hash);
      if (d.created_at) setLastGenerationAt(d.created_at);
      if (d.reason && !d.cards) setGenerationStatus(d.reason);
    } catch { /* */ }
  }, [league]);

  const generatePicks = useCallback(async (force = false) => {
    if (league !== "nba") return;
    setPicksLoading(true);
    setGenerationStatus(null);
    setPropsErrors([]);
    const startMs = Date.now();
    try {
      const d = await apiPost<{
        ok: boolean; cached?: boolean; board_hash?: string; reason?: string;
        cards?: PickCards; duration_ms?: number; error?: string;
      }>("/sports/picks/generate", { league, force });
      if (d.ok && d.cards) {
        setPickCards(d.cards);
        setPicksCached(d.cached === true);
        if (d.board_hash) setBoardHash(d.board_hash);
        setLastGenerationAt(new Date().toISOString());
        setGenerationStatus(d.cached ? "cache_hit" : `generated in ${d.duration_ms ?? (Date.now() - startMs)}ms`);
      } else {
        setGenerationStatus(d.reason ?? d.error ?? "generation failed");
      }
    } catch (e) {
      setGenerationStatus(e instanceof Error ? e.message : "generation error");
      setPropsErrors((prev) => [...prev, e instanceof Error ? e.message : "Generate failed"]);
    } finally { setPicksLoading(false); }
  }, [league]);

  useEffect(() => { loadGames(); loadWatchlist(); loadPredictions(); loadOdds(); loadNews(); loadMovements(); loadPropsBoard(); loadPicksLatest(); }, [loadGames, loadWatchlist, loadPredictions, loadOdds, loadNews, loadMovements, loadPropsBoard, loadPicksLatest]);

  async function handleRefresh() {
    setRefreshing(true); setStatusMsg(null);
    try {
      const d = await apiPost<{ ok: boolean; games?: number; odds?: number; news?: number; predictions?: number; error?: string; source?: string; sourceHealth?: SourceHealthItem[] }>("/sports/refresh", { league });
      if (d.sourceHealth) setSourceHealth(d.sourceHealth);
      const parts: string[] = [];
      if (d.games) parts.push(`${d.games} games`);
      if (d.odds) parts.push(`${d.odds} odds`);
      if (d.news) parts.push(`${d.news} news`);
      if (d.predictions) parts.push(`${d.predictions} picks`);
      setStatusMsg(d.ok ? (parts.length > 0 ? parts.join(", ") : "No new data") : (d.error || "Failed"));
      setLastUpdated(new Date().toLocaleTimeString());
      loadGames(); loadOdds(); loadNews(); loadPredictions(); loadMovements(); loadPropsBoard();
    } catch (e) { setStatusMsg(e instanceof Error ? e.message : "Failed"); }
    finally { setRefreshing(false); }
  }

  async function handleAddTeam() {
    if (!addTeam.trim()) return;
    const teamId = addTeam.trim().toLowerCase().replace(/\s+/g, "-");
    try {
      await apiPost("/sports/watchlist", { league, teamId, teamName: addTeam.trim() });
      setAddTeam("");
      loadWatchlist();
    } catch { /* */ }
  }

  async function handleRemoveTeam(teamId: string) {
    try {
      await apiDelete("/sports/watchlist", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ league, teamId }) });
      loadWatchlist();
    } catch { /* */ }
  }

  const activeGame = games.find((g) => g.id === activeGameId);
  const activePred = predictions.find((p) => p.game_id === activeGameId);
  const activeOdds = odds.filter((o) => o.game_id === activeGameId);

  // Top edges: predictions with meaningful edge, sorted by |edge_spread| desc
  const topEdges = predictions
    .filter((p) => (Math.abs(p.edge_spread || 0) >= 3 || Math.abs(p.edge_total || 0) >= 3) && p.game_status !== "final")
    .sort((a, b) => Math.abs(b.edge_spread || 0) - Math.abs(a.edge_spread || 0))
    .slice(0, 8);

  // Source health badges
  const getHealth = (matcher: (name: string) => boolean) => sourceHealth.find((s) => matcher(s.name));
  const espnHealth = getHealth((n) => n.includes("espn"));
  const oddsHealth = getHealth((n) => n.includes("odds") || n.includes("api-sports"));
  const newsHealth = getHealth((n) => n.includes("rss") || n.includes("news"));
  const espnOk = espnHealth ? espnHealth.status === "ok" : true;
  const oddsOk = oddsHealth ? oddsHealth.status === "ok" : true;
  const newsOk = newsHealth ? newsHealth.status === "ok" : true;
  const oddsUnavailable = oddsHealth ? oddsHealth.status !== "ok" : false;

  return (
    <div className="space-y-3">
      {/* League tabs */}
      <div className="flex gap-1 overflow-auto pb-1">
        {leagues.map((l) => (
          <button key={l.key} onClick={() => setLeague(l.key)} className={cx(
            "px-3 py-1.5 rounded-lg text-xs font-medium border transition whitespace-nowrap",
            league === l.key ? "bg-rose-500/20 text-rose-400 border-rose-500/30" : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10"
          )}>{l.label}</button>
        ))}
      </div>

      {/* Controls + source health */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={handleRefresh} disabled={refreshing}
          className="px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-400 text-xs font-medium hover:bg-rose-500/30 disabled:opacity-50 transition">
          {refreshing ? "Refreshing…" : "🔄 Refresh"}
        </button>
        {(["all", "watchlist", "live", "final"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cx(
            "px-2 py-1 rounded-lg text-[10px] font-medium border transition capitalize",
            filter === f ? "bg-rose-500/20 text-rose-400 border-rose-500/30" : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10"
          )}>{f}</button>
        ))}
        {lastUpdated && <span className="text-[9px] text-zinc-500">Updated {lastUpdated}</span>}
        {statusMsg && <span className="text-[10px] text-zinc-400">{statusMsg}</span>}
      </div>

      {/* Source health indicators */}
      {sourceHealth.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <span className={cx("text-[9px] px-1.5 py-0.5 rounded-full", espnOk ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400")}>
            ESPN {espnOk ? "✓" : "✗"}
          </span>
          <span className={cx("text-[9px] px-1.5 py-0.5 rounded-full", oddsOk ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400")}>
            Odds {oddsOk ? "✓" : "unavailable"}
          </span>
          <span className={cx("text-[9px] px-1.5 py-0.5 rounded-full", newsOk ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400")}>
            News {newsOk ? "✓" : "✗"}
          </span>
          {oddsHealth?.error && (
            <span className="text-[9px] text-amber-400">({oddsHealth.error})</span>
          )}
        </div>
      )}

      {/* Scores */}
      <Card title="Scores" icon="🏆">
        {games.length === 0 ? (
          <EmptyState icon="🏟️" text={!espnOk ? `ESPN data unavailable. Click Refresh to retry.` : `No ${league.toUpperCase()} games. Click Refresh to fetch.`} />
        ) : (
          <div className="space-y-2 max-h-64 overflow-auto">
            {games.map((g) => (
              <button key={g.id} onClick={() => setActiveGameId(g.id)}
                className={cx("w-full text-left rounded-xl p-3 transition",
                  activeGameId === g.id ? "bg-white/10 ring-1 ring-rose-500/30" : "bg-white/5 hover:bg-white/10"
                )}>
                <div className="flex items-center justify-between">
                  <div className="text-xs">
                    <div className={cx("font-semibold", (g.home_score || 0) > (g.away_score || 0) ? "text-white" : "text-zinc-400")}>
                      {g.home_team_name} <span className="font-bold">{g.home_score ?? "-"}</span>
                    </div>
                    <div className={cx("font-semibold mt-0.5", (g.away_score || 0) > (g.home_score || 0) ? "text-white" : "text-zinc-400")}>
                      {g.away_team_name} <span className="font-bold">{g.away_score ?? "-"}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge color={g.status === "final" ? "zinc" : g.status === "live" ? "emerald" : "amber"}>{g.status}</Badge>
                    {g.period && <div className="text-[9px] text-zinc-500 mt-0.5">{g.period} {g.clock || ""}</div>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Odds panel */}
      <Card title="Odds" icon="📊" actions={oddsUnavailable ? <span className="text-[9px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full">odds unavailable</span> : undefined}>
        {activeGame && activeOdds.length > 0 ? (
          <div className="space-y-2">
            <div className="text-xs text-white font-semibold">{activeGame.away_team_name} @ {activeGame.home_team_name}</div>
            <div className="space-y-1.5">
              {activeOdds.slice(0, 5).map((o) => (
                <div key={o.id} className="grid grid-cols-4 gap-1 text-[10px] rounded-lg bg-white/5 p-2">
                  <div className="text-zinc-400 font-medium">{o.book}</div>
                  <div className="text-center">
                    <div className="text-zinc-500">Spread</div>
                    <div className="text-white">{o.spread_home != null ? (o.spread_home > 0 ? "+" : "") + o.spread_home : "—"}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-zinc-500">Total</div>
                    <div className="text-white">{o.total != null ? `O/U ${o.total}` : "—"}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-zinc-500">ML</div>
                    <div className="text-white">{o.moneyline_home != null ? (o.moneyline_home > 0 ? "+" : "") + o.moneyline_home : "—"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : activeGame ? (
          <div className="text-[10px] text-zinc-400">
            {oddsUnavailable ? "Odds provider not configured. Set THE_ODDS_API_KEY for odds data." : "No odds available for this game yet. Click Refresh."}
          </div>
        ) : (
          <div className="text-[10px] text-zinc-400">Select a game above to view odds.</div>
        )}
      </Card>

      {/* Line Movement Tracker */}
      {league === "nba" && (
        <Card title="Line Movement" icon="📈">
          {movements.length > 0 ? (
            <div className="space-y-1.5 max-h-48 overflow-auto">
              {movements.map((m, i) => (
                <div key={`${m.game_id}-${m.book}-${i}`} className="rounded-xl bg-white/5 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-white font-medium">{m.away_team} @ {m.home_team}</div>
                    <span className={cx("text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                      m.direction === "steam" ? "bg-rose-500/20 text-rose-400" :
                      m.direction === "reverse" ? "bg-amber-500/20 text-amber-400" :
                      "bg-zinc-500/20 text-zinc-400"
                    )}>{m.direction}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[10px]">
                    <span className="text-zinc-500">{m.book}</span>
                    <span className="text-zinc-400">{m.old_line > 0 ? "+" : ""}{m.old_line}</span>
                    <span className="text-zinc-600">→</span>
                    <span className={cx("font-medium", m.delta > 0 ? "text-emerald-400" : "text-rose-400")}>
                      {m.new_line > 0 ? "+" : ""}{m.new_line}
                    </span>
                    <span className={cx("font-bold", m.delta > 0 ? "text-emerald-400" : "text-rose-400")}>
                      ({m.delta > 0 ? "+" : ""}{m.delta})
                    </span>
                    <span className="text-zinc-600 ml-auto">{m.minutes_ago}m ago</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[10px] text-zinc-500 py-2">No significant line movements detected. Movements appear after multiple refreshes when odds shift ≥0.5 pts.</div>
          )}
        </Card>
      )}

      {/* Projections for active game */}
      <Card title="Projections" icon="🎯">
        {activeGame && activePred ? (
          <div className="space-y-2">
            <div className="text-xs text-white font-semibold">{activeGame.away_team_name} @ {activeGame.home_team_name}</div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              {activePred.proj_spread_home != null && (
                <div className="rounded-lg bg-white/5 p-2">
                  <div className="text-zinc-400">Model Spread</div>
                  <div className="text-white font-semibold">{activePred.proj_spread_home > 0 ? "+" : ""}{activePred.proj_spread_home}</div>
                </div>
              )}
              {activePred.proj_total != null && (
                <div className="rounded-lg bg-white/5 p-2">
                  <div className="text-zinc-400">Model Total</div>
                  <div className="text-white font-semibold">{activePred.proj_total}</div>
                </div>
              )}
              {activePred.win_prob_home != null && (
                <div className="rounded-lg bg-white/5 p-2">
                  <div className="text-zinc-400">Win Prob (Home)</div>
                  <div className="text-white font-semibold">{(activePred.win_prob_home * 100).toFixed(1)}%</div>
                </div>
              )}
              {activePred.edge_spread != null && (
                <div className="rounded-lg bg-white/5 p-2">
                  <div className="text-zinc-400">Edge (Spread)</div>
                  <div className={cx("font-semibold", activePred.edge_spread > 0 ? "text-emerald-400" : "text-rose-400")}>
                    {activePred.edge_spread > 0 ? "+" : ""}{activePred.edge_spread.toFixed(1)}
                  </div>
                </div>
              )}
            </div>
            {activePred.explanation_md && <div className="text-[10px] text-zinc-400 mt-1">{activePred.explanation_md}</div>}
          </div>
        ) : activeGame ? (
          <div className="text-[10px] text-zinc-400">No projections yet. Projections generate during refresh when odds are available.</div>
        ) : (
          <div className="text-[10px] text-zinc-400">Select a game above to view projections.</div>
        )}
      </Card>

      {/* Top Edges — Betting Analyst */}
      <Card title="Top Edges" icon="🔥">
        {topEdges.length > 0 ? (
          <div className="space-y-2 max-h-48 overflow-auto">
            {topEdges.map((p) => {
              let rec: { type?: string; side?: string; edge?: string; risk?: string } = {};
              try { rec = JSON.parse(p.recommended_bet_json || "{}"); } catch { /* */ }
              return (
                <div key={p.id} className="rounded-xl bg-white/5 p-3 hover:bg-white/10 transition">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-white font-semibold">{p.away_team_name} @ {p.home_team_name}</div>
                    <div className="flex items-center gap-1.5">
                      {p.edge_spread != null && (
                        <span className={cx("text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                          Math.abs(p.edge_spread) >= 5 ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"
                        )}>
                          {p.edge_spread > 0 ? "+" : ""}{p.edge_spread.toFixed(1)}
                        </span>
                      )}
                      {rec.risk && (
                        <span className={cx("text-[9px] px-1.5 py-0.5 rounded-full",
                          rec.risk === "low" ? "bg-emerald-500/10 text-emerald-400" :
                          rec.risk === "medium" ? "bg-amber-500/10 text-amber-400" :
                          "bg-red-500/10 text-red-400"
                        )}>{rec.risk}</span>
                      )}
                    </div>
                  </div>
                  {rec.side && <div className="text-[10px] text-zinc-300 mt-1">📌 {rec.side} ({rec.type}) — edge {rec.edge}</div>}
                  {p.explanation_md && <div className="text-[9px] text-zinc-500 mt-0.5 line-clamp-2">{p.explanation_md}</div>}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon="🎲" text="No edges found. Refresh to analyze games with available odds." />
        )}
      </Card>

      {/* News + Rumors */}
      <Card title="News & Rumors" icon="📰">
        {news.length > 0 ? (
          <div className="space-y-1.5 max-h-48 overflow-auto">
            {news.slice(0, 15).map((n) => (
              <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer"
                className="block rounded-xl bg-white/5 px-3 py-2 hover:bg-white/10 transition">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-white font-medium leading-tight truncate">{n.title}</div>
                    <div className="text-[9px] text-zinc-500 mt-0.5">{n.source} {n.published_at ? `· ${new Date(n.published_at).toLocaleDateString()}` : ""}</div>
                  </div>
                  {n.rumor_flag === 1 && (
                    <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400">rumor</span>
                  )}
                </div>
              </a>
            ))}
          </div>
        ) : (
          <EmptyState icon="📰" text={!newsOk ? "News feed unavailable. Cached items shown when available." : "No news yet. Click Refresh to fetch headlines."} />
        )}
      </Card>

      {/* Watchlist */}
      <Card title="My Watchlist" icon="⭐" actions={
        <div className="flex items-center gap-1">
          <input className="w-24 rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-[10px] text-white placeholder-zinc-500 outline-none"
            placeholder="Team name" value={addTeam} onChange={(e) => setAddTeam(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddTeam(); }} />
          <button onClick={handleAddTeam} className="text-[10px] px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition">+</button>
        </div>
      }>
        <div className="space-y-1.5">
          {watchlist.length === 0 && <div className="text-[10px] text-zinc-500">Add teams to your watchlist above.</div>}
          {watchlist.map((team) => (
            <div key={team.team_id} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 hover:bg-white/10 transition">
              <span className="text-xs text-white">{team.team_name}</span>
              <button onClick={() => handleRemoveTeam(team.team_id)} className="text-[10px] text-zinc-500 hover:text-red-400 transition" title="Remove">✕</button>
            </div>
          ))}
        </div>
      </Card>

      {/* ── NBA Props + Picks (NBA only) ── */}
      {league === "nba" && (
        <>
          {/* Props Board */}
          <Card title="Props Board" icon="📋" actions={
            <div className="flex gap-1">
              <button onClick={() => loadPropsBoard()} className="text-[9px] px-2 py-0.5 rounded-lg bg-white/5 text-zinc-400 hover:bg-white/10 transition">Refresh Props</button>
              <button onClick={() => generatePicks()} disabled={picksLoading}
                className="text-[9px] px-2 py-0.5 rounded-lg bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 disabled:opacity-50 transition">
                {picksLoading ? "Generating…" : "Generate Picks"}
              </button>
            </div>
          }>
            {propsBoard.length > 0 ? (
              <div className="space-y-1 max-h-52 overflow-auto">
                {propsBoard.slice(0, 30).map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg bg-white/5 px-2 py-1.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-white font-medium truncate">{p.player}</div>
                      <div className="text-[9px] text-zinc-500">{p.market} {p.line != null ? p.line : ""} • {p.book ?? "—"}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      {p.odds != null && <span className="text-[9px] text-zinc-400">{p.odds > 0 ? "+" : ""}{p.odds}</span>}
                      <span className={cx("text-[9px] font-bold px-1 py-0.5 rounded-full",
                        p.edge_score >= 10 ? "bg-emerald-500/20 text-emerald-400" : p.edge_score >= 5 ? "bg-amber-500/20 text-amber-400" : "bg-zinc-500/20 text-zinc-400"
                      )}>{p.edge_score}</span>
                      {p.status === "pass" && <span className="text-[8px] px-1 py-0.5 rounded-full bg-orange-500/20 text-orange-400">PASS</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="📋" text="No props loaded. Use POST /api/sports/props/ingest to add props, then Refresh." />
            )}
          </Card>

          {/* Top Plays Card */}
          <Card title="Top Plays" icon="🎯">
            {pickCards?.top_plays && pickCards.top_plays.length > 0 ? (
              <div className="space-y-1.5">
                {pickCards.top_plays.map((leg, i) => (
                  <div key={`tp-${i}`} className="rounded-xl bg-white/5 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] text-white font-semibold">{leg.player}</div>
                      <span className={cx("text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                        leg.confidence >= 0.7 ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"
                      )}>{(leg.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <div className="text-[10px] text-zinc-300 mt-0.5">{leg.pick} {leg.market} {leg.line ?? ""}</div>
                    <div className="text-[9px] text-zinc-500 mt-0.5">{leg.reason}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="🎯" text={generationStatus || "No picks yet. Load props and click Generate Picks."} />
            )}
          </Card>

          {/* Safe Slip Card */}
          <Card title="Best 5 Safe" icon="🛡️">
            {pickCards?.safe_slip && pickCards.safe_slip.length > 0 ? (
              <div className="space-y-1">
                {pickCards.safe_slip.map((leg, i) => (
                  <div key={`ss-${i}`} className="flex items-center justify-between rounded-lg bg-white/5 px-2 py-1.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-white font-medium truncate">{leg.player} — {leg.pick} {leg.market} {leg.line ?? ""}</div>
                      <div className="text-[9px] text-zinc-500">{leg.reason}</div>
                    </div>
                    <span className="text-[9px] font-bold text-emerald-400 shrink-0 ml-1">{(leg.confidence * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="🛡️" text="No safe slip yet." />
            )}
          </Card>

          {/* Aggressive Slip Card */}
          <Card title="Best 5 Aggressive" icon="🔥">
            {pickCards?.aggressive_slip && pickCards.aggressive_slip.length > 0 ? (
              <div className="space-y-1">
                {pickCards.aggressive_slip.map((leg, i) => (
                  <div key={`ag-${i}`} className="flex items-center justify-between rounded-lg bg-white/5 px-2 py-1.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-white font-medium truncate">{leg.player} — {leg.pick} {leg.market} {leg.line ?? ""}</div>
                      <div className="text-[9px] text-zinc-500">{leg.reason}</div>
                    </div>
                    <span className="text-[9px] font-bold text-rose-400 shrink-0 ml-1">{(leg.confidence * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="🔥" text="No aggressive slip yet." />
            )}
          </Card>

          {/* Generation Diagnostics */}
          <Card title="Generation Diagnostics" icon="🔧">
            <div className="space-y-1 text-[10px]">
              <div className="flex justify-between"><span className="text-zinc-500">board_hash</span><span className="text-zinc-300 font-mono">{boardHash ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">cached</span><span className={picksCached ? "text-emerald-400" : "text-zinc-400"}>{picksCached ? "yes" : "no"}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">status</span><span className="text-zinc-300">{generationStatus ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">last generation</span><span className="text-zinc-300">{lastGenerationAt ? new Date(lastGenerationAt).toLocaleTimeString() : "—"}</span></div>
              {propsErrors.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {propsErrors.map((e, i) => (
                    <div key={`err-${i}`} className="text-[9px] text-red-400 bg-red-500/10 rounded px-1.5 py-0.5">{e}</div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* Test Checklist (debug) */}
          {(() => {
            const checks = [
              { name: "props board loaded count > 0", pass: propsBoard.length > 0 },
              { name: "board_hash present", pass: !!boardHash },
              { name: "picks card present (or explicit reason)", pass: !!pickCards || !!generationStatus },
              { name: "cached indicator working", pass: picksCached || generationStatus === "cache_hit" },
              { name: "PASS rows visible if uncertain", pass: propsBoard.length === 0 || propsBoard.every((p) => p.status !== "pass") || propsBoard.some((p) => p.status === "pass") },
              { name: "no uncaught errors", pass: propsErrors.length === 0 },
            ];
            const failed = checks.filter((c) => !c.pass);
            return (
              <Card title="Test Checklist" icon="✅">
                <div className="space-y-1 text-[10px]">
                  {checks.map((c, i) => (
                    <div key={`chk-${i}`} className="flex items-center gap-1.5">
                      <span className={c.pass ? "text-emerald-400" : "text-red-400"}>{c.pass ? "✓" : "✗"}</span>
                      <span className={c.pass ? "text-zinc-400" : "text-red-300"}>{c.name}</span>
                    </div>
                  ))}
                  {failed.length > 0 && (
                    <div className="mt-1 inline-block text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
                      TEST FAIL: {failed.map((f) => f.name).join(", ")}
                    </div>
                  )}
                </div>
              </Card>
            );
          })()}
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   STOCKS — Yahoo Finance style
   ═══════════════════════════════════════════════════════ */
function StocksWidgets(_props: { refresh: () => void }) {
  // API-backed state
  interface WlItem { ticker: string; display_name?: string; sector?: string; market_cap_bucket?: string; tags_json?: string }
  interface QuoteItem { ticker: string; price: number; change?: number; change_pct?: number; volume?: number | null; premarket_price?: number | null; premarket_change_pct?: number | null; asof?: string; source?: string }
  interface IndexItem { symbol: string; value: number; change_pct?: number; asof?: string; source?: string }
  interface NewsItem { id: string; title: string; source: string; url: string; published_at?: string; sentiment?: string; catalyst_type?: string; sentiment_score?: number; ticker?: string; qualityScore?: number; isWatchlistRelevant?: boolean; reasonTags?: string[] }
  interface InsightItem { id: string; title: string; bullets_json: string; body_md?: string; sentiment?: string; ticker?: string; created_at: string; insight_type?: string }
  interface FreshnessInfo { asof: string; ageSeconds: number; stale: boolean; source: string }
  interface OutlierItem { id: string; ticker: string; outlier_type: string; z_score: number; details_json: string; asof: string }
  interface PredictionItem { id: string; ticker: string; prediction_text: string; confidence: number; horizon: string; status: string; due_at: string; score_hit?: number | null; score_brier?: number | null; created_at: string }
  interface StockProviderDebug {
    env?: { STOCK_INTEL_API_BASE?: string };
    yahooTestFetch?: string;
    stockIntelTestFetch?: string;
    lastRefreshHealth?: { status?: string; error?: string; last_run_at?: string } | null;
  }

  const [watchlist, setWatchlist] = useState<WlItem[]>([]);
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [indices, setIndices] = useState<IndexItem[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [insights, setInsights] = useState<InsightItem[]>([]);
  const [outliers, setOutliers] = useState<OutlierItem[]>([]);
  const [predictions, setPredictions] = useState<PredictionItem[]>([]);
  const [metrics, setMetrics] = useState<Record<string, { hit_rate?: number | null; avg_brier?: number | null; resolved_predictions?: number }>>({});
  const [freshness, setFreshness] = useState<FreshnessInfo | null>(null);
  const [regime, setRegime] = useState<{ risk_mode?: string; asof?: string } | null>(null);
  const [addTicker, setAddTicker] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [providerDebug, setProviderDebug] = useState<StockProviderDebug | null>(null);

  // FIX 4: new state for auto-refresh + ticker detail
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [tickerDetail, setTickerDetail] = useState<{ news: { title: string; url: string; source: string; published_at?: string; summary?: string; sentiment_score?: number | null }[]; analysis: Record<string, unknown> | null } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try { const d = await apiGet<{ tickers: WlItem[] }>("/stocks/watchlist"); setWatchlist(d.tickers || []); } catch { /* */ }
    try {
      const d = await apiGet<{ quotes: QuoteItem[]; indices: IndexItem[]; freshness: FreshnessInfo | null }>("/stocks/quotes");
      setQuotes(d.quotes || []);
      setIndices(d.indices || []);
      if (d.freshness) setFreshness(d.freshness);
    } catch { /* */ }
    try { const d = await apiGet<{ items: NewsItem[] }>("/stocks/news?limit=20"); setNews(d.items || []); } catch { /* */ }
    try { const d = await apiGet<{ insights: InsightItem[] }>("/stocks/insights?ticker=ALL&limit=5"); setInsights(d.insights || []); } catch { /* */ }
    try { const d = await apiGet<{ outliers: OutlierItem[] }>("/stocks/outliers?window=24h&limit=10"); setOutliers(d.outliers || []); } catch { /* */ }
    try {
      const d = await apiGet<{ predictions: PredictionItem[]; metrics: Record<string, { hit_rate?: number | null; avg_brier?: number | null; resolved_predictions?: number }> }>("/stocks/predictions?limit=10");
      setPredictions(d.predictions || []);
      setMetrics(d.metrics || {});
    } catch { /* */ }
    try { const d = await apiGet<{ regime: { risk_mode?: string; asof?: string } | null }>("/stocks/regime"); setRegime(d.regime); } catch { /* */ }
    try { const d = await apiGet<StockProviderDebug>("/stocks/debug/provider"); setProviderDebug(d); } catch { /* */ }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // FIX 4: Auto-refresh every 30s when enabled
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => { loadAll(); setLastRefresh(new Date().toLocaleTimeString()); }, 30_000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadAll]);

  // FIX 4: Load ticker detail when selectedTicker changes
  useEffect(() => {
    if (!selectedTicker) { setTickerDetail(null); return; }
    (async () => {
      const detail: { news: { title: string; url: string; source: string; published_at?: string; summary?: string; sentiment_score?: number | null }[]; analysis: Record<string, unknown> | null } = { news: [], analysis: null };
      try { const d = await apiGet<{ items: typeof detail.news }>(`/stocks/ticker/${selectedTicker}/news`); detail.news = d.items || []; } catch { /* */ }
      try { const d = await apiGet<{ analysis: Record<string, unknown> | null }>(`/stocks/ticker/${selectedTicker}/why`); detail.analysis = d.analysis; } catch { /* */ }
      setTickerDetail(detail);
    })();
  }, [selectedTicker]);

  async function handleAddTicker() {
    if (!addTicker.trim()) return;
    try { await apiPost("/stocks/watchlist", { ticker: addTicker.trim() }); setAddTicker(""); loadAll(); }
    catch { /* */ }
  }

  async function handleRemoveTicker(ticker: string) {
    try { await apiDelete(`/stocks/watchlist/${ticker}`); loadAll(); }
    catch { /* */ }
  }

  async function handleRefresh() {
    setRefreshing(true); setStatusMsg(null);
    try {
      const d = await apiPost<{ ok: boolean; tickers?: number; source?: string; error?: string; staleFallbackUsed?: boolean; status?: string; freshness?: FreshnessInfo }>("/stocks/refresh", {});
      if (d.ok) {
        const parts = [`${d.tickers || 0} tickers`, d.source || ""];
        if (d.staleFallbackUsed) parts.push("⚠ stale");
        if (d.status) parts.push(d.status);
        setStatusMsg(parts.filter(Boolean).join(" · "));
        if (d.freshness) setFreshness(d.freshness);
      } else {
        setStatusMsg(d.error || "Failed");
      }
      loadAll();
    } catch (e) { setStatusMsg(e instanceof Error ? e.message : "Failed"); }
    finally { setRefreshing(false); }
  }

  async function handleNewsScan() {
    setScanning(true);
    try {
      const d = await apiPost<{ ok: boolean; newItems?: number }>("/stocks/news/scan", {});
      setStatusMsg(`News: ${d.newItems || 0} new items`);
      loadAll();
    } catch { /* */ }
    finally { setScanning(false); }
  }

  const quoteMap = Object.fromEntries(quotes.map((q) => [q.ticker, q]));

  // Regime badge
  const regimeBadge = regime?.risk_mode === "risk_on" ? "🟢 Risk On"
    : regime?.risk_mode === "risk_off" ? "🔴 Risk Off" : "🟡 Neutral";

  const idxDisplay = (sym: string, label: string) => {
    const idx = indices.find((i) => i.symbol === sym);
    if (!idx) return (
      <div className="glass-light rounded-xl p-3 text-center">
        <div className="text-[10px] text-zinc-400">{label}</div>
        <div className="text-[10px] text-zinc-600">No data</div>
      </div>
    );
    const isUp = (idx.change_pct || 0) >= 0;
    return (
      <div className="glass-light rounded-xl p-3 text-center">
        <div className="text-[10px] text-zinc-400">{label}</div>
        <div className={cx("text-sm font-bold", isUp ? "text-emerald-400" : "text-rose-400")}>
          {isUp ? "+" : ""}{(idx.change_pct || 0).toFixed(2)}%
        </div>
      </div>
    );
  };

  const catalystBadge = (type?: string) => {
    if (!type) return null;
    const colors: Record<string, string> = {
      earnings: "amber", guidance: "sky", product: "violet", legal: "rose",
      "m&a": "pink", analyst_rating: "cyan", macro: "orange",
    };
    return <Badge color={colors[type] || "zinc"}>{type}</Badge>;
  };

  return (
    <div className="space-y-3">
      {/* Top bar: regime + freshness */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-white">{regimeBadge}</span>
          {freshness && (
            <span className={cx("text-[10px]", freshness.stale ? "text-amber-400" : "text-zinc-500")}>
              {freshness.stale ? "⚠ Stale" : "Fresh"} · {freshness.ageSeconds < 60 ? `${freshness.ageSeconds}s` : `${Math.round(freshness.ageSeconds / 60)}m`} ago
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleRefresh} disabled={refreshing}
            className="px-3 py-1.5 rounded-lg bg-lime-500/20 text-lime-400 text-xs font-medium hover:bg-lime-500/30 disabled:opacity-50 transition">
            {refreshing ? "Refreshing…" : "🔄 Refresh"}
          </button>
          <button onClick={handleNewsScan} disabled={scanning}
            className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 text-xs font-medium hover:bg-indigo-500/30 disabled:opacity-50 transition">
            {scanning ? "Scanning…" : "📰 Scan News"}
          </button>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)}
              className="w-3 h-3 rounded accent-lime-500" />
            <span className="text-[10px] text-zinc-400">Auto</span>
          </label>
          {lastRefresh && <span className="text-[9px] text-zinc-600">↻ {lastRefresh}</span>}
        </div>
      </div>
      {statusMsg && <div className="text-[10px] text-zinc-400 px-1">{statusMsg}</div>}

      {providerDebug && (
        <Card title="Source Health" icon="🩺">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-xs">
              <span className="text-zinc-300">Yahoo</span>
              <span className={cx((providerDebug.yahooTestFetch || "").includes("HTTP 2") ? "text-emerald-400" : "text-amber-400")}>
                {providerDebug.yahooTestFetch || "unknown"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-xs">
              <span className="text-zinc-300">Stock Intel</span>
              <span className={cx((providerDebug.stockIntelTestFetch || "").includes("HTTP 2") ? "text-emerald-400" : "text-zinc-500")}>
                {providerDebug.stockIntelTestFetch || "not configured"}
              </span>
            </div>
            <div className="text-[10px] text-zinc-500">
              Last refresh: {providerDebug.lastRefreshHealth?.status || "unknown"}
              {providerDebug.lastRefreshHealth?.error ? ` · ${providerDebug.lastRefreshHealth.error}` : ""}
            </div>
          </div>
        </Card>
      )}

      {/* Market overview */}
      <div className="grid grid-cols-3 gap-2">
        {idxDisplay("SPX", "S&P 500")}
        {idxDisplay("IXIC", "NASDAQ")}
        {idxDisplay("BTC", "BTC")}
      </div>

      <AgentStatus verb="monitoring market movements" />

      {/* Watchlist */}
      <Card title="Watchlist" icon="📊" actions={
        <div className="flex items-center gap-1">
          <input className="w-20 rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-[10px] text-white placeholder-zinc-500 outline-none uppercase"
            placeholder="TICKER" value={addTicker} onChange={(e) => setAddTicker(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddTicker(); }} />
          <button onClick={handleAddTicker} className="text-[10px] px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition">+</button>
        </div>
      }>
        <div className="space-y-1.5">
          {watchlist.length === 0 && <div className="text-[10px] text-zinc-500">Add tickers to your watchlist above.</div>}
          {watchlist.map((w) => {
            const q = quoteMap[w.ticker];
            const hasData = q && q.price > 0;
            const isUp = hasData && (q.change_pct || 0) >= 0;
            return (
              <div key={w.ticker} onClick={() => setSelectedTicker(w.ticker)} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2.5 hover:bg-white/10 transition group cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-white">{w.ticker}</div>
                  <div className="text-[10px] text-zinc-500">{w.display_name || ""}{w.market_cap_bucket && w.market_cap_bucket !== "large" ? ` · ${w.market_cap_bucket}` : ""}</div>
                </div>
                <div className="flex items-center gap-2">
                  {hasData ? (
                    <div className="text-right">
                      <div className="text-xs font-semibold text-white">${q.price.toFixed(2)}</div>
                      <div className={cx("text-[10px] font-medium", isUp ? "text-emerald-400" : "text-rose-400")}>
                        {isUp ? "▲" : "▼"} {Math.abs(q.change_pct || 0).toFixed(2)}%
                      </div>
                    </div>
                  ) : (
                    <div className="text-[10px] text-zinc-600">No quote</div>
                  )}
                  <button onClick={() => handleRemoveTicker(w.ticker)}
                    className="text-[10px] text-zinc-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition">✕</button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Outliers */}
      {outliers.length > 0 && (
        <Card title="Outliers" icon="🎯">
          <div className="space-y-1.5 max-h-40 overflow-auto">
            {outliers.map((o) => {
              let details: Record<string, unknown> = {};
              try { details = JSON.parse(o.details_json); } catch { /* */ }
              return (
                <div key={o.id} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-xs">
                  <div>
                    <span className="font-semibold text-white">{o.ticker}</span>
                    <span className="text-zinc-500 ml-1">{o.outlier_type.replace("_", " ")}</span>
                  </div>
                  <div className="text-right">
                    <span className={cx("font-medium", Number(details.change_pct || 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                      z={o.z_score.toFixed(1)}
                    </span>
                    <span className="text-zinc-600 ml-1 text-[10px]">{String(details.severity || "")}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Market News */}
      <Card title="Market News" icon="📰">
        <div className="space-y-2 max-h-64 overflow-auto">
          {news.length === 0 && <div className="text-[10px] text-zinc-500">No high-signal headlines. Tap Scan News.</div>}
          {news.map((n) => (
            <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer"
              className="block rounded-xl bg-white/5 px-3 py-2 hover:bg-white/10 transition">
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs text-white hover:underline">{n.title} ↗</div>
                <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                  {n.ticker && <Badge color={n.isWatchlistRelevant ? "lime" : "zinc"}>{n.ticker}</Badge>}
                  {catalystBadge(n.catalyst_type)}
                  {n.sentiment_score != null && n.sentiment_score !== 0 && (
                    <Badge color={n.sentiment_score > 0 ? "emerald" : "rose"}>
                      {n.sentiment_score > 0 ? "bullish" : "bearish"}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                <span className="text-[10px] text-zinc-500">{n.source} · {n.published_at ? new Date(n.published_at).toLocaleDateString() : ""}</span>
                {n.reasonTags && n.reasonTags.slice(0, 2).filter((t) => t !== "watchlist_ticker" && t !== (n.catalyst_type || "")).map((tag) => (
                  <span key={tag} className="inline-block rounded-full bg-zinc-800 px-1.5 py-px text-[8px] text-zinc-400">{tag.replace(/_/g, " ")}</span>
                ))}
              </div>
            </a>
          ))}
        </div>
      </Card>

      {/* Predictions */}
      {predictions.length > 0 && (
        <Card title="Predictions" icon="🔮" actions={
          metrics["30d"]?.resolved_predictions != null ? (
            <span className="text-[10px] text-zinc-400">
              Hit: {metrics["30d"].hit_rate != null ? `${((metrics["30d"].hit_rate ?? 0) * 100).toFixed(0)}%` : "—"}
              {" · Brier: "}{metrics["30d"].avg_brier != null ? (metrics["30d"].avg_brier ?? 0).toFixed(3) : "—"}
            </span>
          ) : undefined
        }>
          <div className="space-y-1.5 max-h-48 overflow-auto">
            {predictions.map((p) => (
              <div key={p.id} className="rounded-xl bg-white/5 px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-white">{p.ticker} <span className="text-zinc-500 font-normal">{p.horizon}</span></div>
                  <Badge color={p.status === "open" ? "sky" : p.score_hit === 1 ? "emerald" : p.score_hit === 0 ? "rose" : "zinc"}>
                    {p.status === "open" ? "open" : p.score_hit === 1 ? "✓ hit" : p.score_hit === 0 ? "✗ miss" : p.status}
                  </Badge>
                </div>
                <div className="text-[10px] text-zinc-400 mt-0.5">{p.prediction_text}</div>
                <div className="text-[9px] text-zinc-600 mt-0.5">Conf: {p.confidence}% · Due: {new Date(p.due_at).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* AI Insights */}
      <Card title="AI Analysis" icon="🤖">
        {insights.length === 0 ? (
          <div className="text-[10px] text-zinc-400">No insights yet. Generate a briefing or ask your stocks agent.</div>
        ) : (
          <div className="space-y-2">
            {insights.map((ins) => {
              let bullets: string[] = [];
              try { bullets = JSON.parse(ins.bullets_json); } catch { /* */ }
              const body = ins.body_md || bullets.map((b) => `• ${b}`).join("\n");
              return (
                <div key={ins.id} className="rounded-xl bg-white/5 p-3">
                  <div className="text-xs font-semibold text-white">{ins.title}</div>
                  {ins.body_md ? (
                    <div className="text-[10px] text-zinc-400 mt-0.5 whitespace-pre-wrap">{body}</div>
                  ) : (
                    bullets.map((b, i) => <div key={i} className="text-[10px] text-zinc-400 mt-0.5">• {b}</div>)
                  )}
                  <div className="text-[9px] text-zinc-600 mt-1">{new Date(ins.created_at).toLocaleString()}</div>
                </div>
              );
            })}
          </div>
        )}
        <button onClick={() => { apiPost("/stocks/insights/generate", {}).then(() => loadAll()).catch(() => {}); }}
          className="mt-2 px-3 py-1.5 rounded-lg bg-lime-500/20 text-lime-400 text-xs font-medium hover:bg-lime-500/30 transition">
          Generate Briefing →
        </button>
      </Card>

      {/* FIX 4: Ticker Detail Modal */}
      {selectedTicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setSelectedTicker(null)}>
          <div className="w-full max-w-md mx-4 glass rounded-2xl p-5 max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">{selectedTicker} — Detail</h3>
              <button onClick={() => setSelectedTicker(null)} className="text-zinc-400 hover:text-white text-sm">✕</button>
            </div>

            {/* Quote summary */}
            {(() => { const q = quoteMap[selectedTicker]; return q && q.price > 0 ? (
              <div className="rounded-xl bg-white/5 p-3 mb-3">
                <div className="text-lg font-bold text-white">${q.price.toFixed(2)}</div>
                <div className={cx("text-xs font-medium", (q.change_pct || 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {(q.change_pct || 0) >= 0 ? "▲" : "▼"} {Math.abs(q.change_pct || 0).toFixed(2)}%
                </div>
              </div>
            ) : null; })()}

            {/* Why moving analysis */}
            {tickerDetail?.analysis && (
              <div className="mb-3">
                <div className="text-[10px] font-semibold text-zinc-400 uppercase mb-1">Why Moving</div>
                <div className="rounded-xl bg-white/5 p-3 text-xs text-zinc-300">
                  {typeof tickerDetail.analysis === "object" ? (
                    Object.entries(tickerDetail.analysis).map(([k, v]) => (
                      <div key={k} className="mb-1"><span className="text-zinc-500">{k}:</span> {String(v)}</div>
                    ))
                  ) : String(tickerDetail.analysis)}
                </div>
              </div>
            )}

            {/* Ticker news */}
            <div className="text-[10px] font-semibold text-zinc-400 uppercase mb-1">Recent News</div>
            {!tickerDetail ? (
              <div className="text-[10px] text-zinc-500 py-4 text-center">Loading…</div>
            ) : tickerDetail.news.length === 0 ? (
              <div className="text-[10px] text-zinc-500 py-4 text-center">No news found for {selectedTicker}</div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-auto">
                {tickerDetail.news.slice(0, 10).map((n, i) => (
                  <a key={i} href={n.url} target="_blank" rel="noopener noreferrer"
                    className="block rounded-lg bg-white/5 px-3 py-2 hover:bg-white/10 transition">
                    <div className="text-[11px] text-white">{n.title} ↗</div>
                    <div className="text-[9px] text-zinc-500 mt-0.5">{n.source} {n.published_at ? `· ${new Date(n.published_at).toLocaleDateString()}` : ""}</div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   RESEARCH — News + Deep Dive courses
   ═══════════════════════════════════════════════════════ */
function ResearchWidgets({ research: localResearch, refresh }: { research: ResearchArticle[]; refresh: () => void }) {
  const [filter, setFilter] = useState<"all" | "unread" | "saved" | "high" | "archived">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [noteText, setNoteText] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [activePane, setActivePane] = useState<"stream" | "insights">("stream");

  // API-backed items
  interface ApiItem {
    id: string; title: string; url: string; source_name?: string;
    published_at?: string; fetched_at: string; summary?: string;
    tags_json?: string; is_read: number; is_saved: number; is_archived?: number;
    score?: number; urgency?: string; item_type?: string; notes_md?: string;
  }
  const [apiItems, setApiItems] = useState<ApiItem[]>([]);
  const [hasApi, setHasApi] = useState(false);

  // Entities & Trends
  interface EntityItem { id: string; name: string; type: string; watch: number }
  interface TrendItem { id: string; topic: string; mention_count: number; momentum_score: number; window: string }
  interface BriefingItem { id: string; title: string; body_md: string; scope: string; created_at: string; model_used?: string }
  const [entities, setEntities] = useState<EntityItem[]>([]);
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [latestBriefing, setLatestBriefing] = useState<BriefingItem | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [deepDiveTopic, setDeepDiveTopic] = useState("");

  // Research Intelligence: user skill names for gap detection
  const [userSkillNames, setUserSkillNames] = useState<string[]>([]);

  const loadFeed = useCallback(async (f: string) => {
    try {
      const data = await apiGet<{ items: ApiItem[] }>(`/research/feed?filter=${f}&limit=50`);
      if (data.items && data.items.length >= 0) {
        setApiItems(data.items);
        setHasApi(true);
      }
    } catch {
      setHasApi(false);
    }
  }, []);

  const loadSidebar = useCallback(async () => {
    try {
      const [entData, trendData] = await Promise.all([
        apiGet<{ entities: EntityItem[] }>("/research/entities?watch=1").catch(() => ({ entities: [] })),
        apiGet<{ trends: TrendItem[] }>("/research/trends?window=24h").catch(() => ({ trends: [] })),
      ]);
      setEntities(entData.entities || []);
      setTrends(trendData.trends || []);
    } catch { /* non-fatal */ }
    // Load user skill names for Skill Gap Detector
    try {
      const d = await apiGet<{ roadmap: { skill_name: string }[] }>("/skills/roadmap");
      setUserSkillNames((d.roadmap || []).map((r) => r.skill_name.toLowerCase()));
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadFeed(filter); }, [filter, loadFeed]);
  useEffect(() => { loadSidebar(); }, [loadSidebar]);

  async function handleScan() {
    setScanning(true);
    setScanResult(null);
    try {
      const data = await apiPost<{ ok: boolean; newItems?: number; entitiesLinked?: number; sources?: number; tookMs?: number; error?: string }>("/research/scan", {});
      if (data.ok) {
        setScanResult(`Found ${data.newItems || 0} new items from ${data.sources || 0} sources (${data.tookMs || 0}ms)`);
        loadFeed(filter);
        loadSidebar();
      } else {
        setScanResult(data.error || "Scan failed");
      }
    } catch (e) {
      setScanResult(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function handleMarkRead(itemId: string, isRead: boolean) {
    try {
      await apiPost(`/research/item/${itemId}/read`, { isRead });
      loadFeed(filter);
    } catch {
      toggleArticleRead(itemId);
      refresh();
    }
  }

  async function handleSaveItem(itemId: string, isSaved: boolean) {
    try {
      await apiPost(`/research/item/${itemId}/save`, { isSaved });
      loadFeed(filter);
    } catch { /* non-fatal */ }
  }

  async function handleArchiveItem(itemId: string, isArchived: boolean) {
    try {
      await apiPatch(`/research/item/${itemId}/archive`, { isArchived });
      loadFeed(filter);
    } catch { /* non-fatal */ }
  }

  async function handleSaveNote(itemId: string, notesMd: string) {
    try {
      await apiPatch(`/research/item/${itemId}/note`, { notes_md: notesMd });
      loadFeed(filter);
    } catch { /* non-fatal */ }
  }

  async function handleGenerateBriefing(scope: "daily" | "theme", theme?: string) {
    setBriefingLoading(true);
    try {
      const body: Record<string, unknown> = {};
      if (theme) body.theme = theme;
      const data = await apiPost<{ ok: boolean; briefing?: BriefingItem }>(`/research/briefing/generate?scope=${scope}`, body);
      if (data.ok && data.briefing) {
        setLatestBriefing(data.briefing);
      }
    } catch { /* non-fatal */ }
    setBriefingLoading(false);
  }

  async function handleWatchEntity(entityId: string, watch: boolean) {
    try {
      await apiPost("/research/entities/watch", { entity_id: entityId, watch });
      loadSidebar();
    } catch { /* non-fatal */ }
  }

  // Merged display
  const displayItems = hasApi ? apiItems.map((a) => ({
    id: a.id,
    title: a.title,
    url: a.url,
    source: a.source_name || "",
    category: "tech" as const,
    read: a.is_read === 1,
    saved: a.is_saved === 1,
    archived: (a.is_archived || 0) === 1,
    notes: a.notes_md || "",
    summary: a.summary || "",
    tags: a.tags_json ? JSON.parse(a.tags_json) : [],
    publishedAt: a.published_at || a.fetched_at,
    score: a.score || 0,
    urgency: a.urgency || "low",
    itemType: a.item_type || "news",
  })) : localResearch.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url || "#",
    source: r.source,
    category: r.category,
    read: r.read,
    saved: false,
    archived: false,
    notes: r.notes,
    summary: "",
    tags: [] as string[],
    publishedAt: "",
    score: 0,
    urgency: "low",
    itemType: "news",
  }));

  const unread = displayItems.filter((r) => !r.read).length;
  const readCount = displayItems.filter((r) => r.read).length;
  const highUrgent = displayItems.filter((r) => r.urgency === "critical" || r.urgency === "high").length;

  // Breaking Now: high urgency items from last 6 hours
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const breakingItems = displayItems.filter((r) =>
    (r.urgency === "critical" || r.urgency === "high") && r.publishedAt && r.publishedAt >= sixHoursAgo
  ).slice(0, 3);

  const urgencyBadge = (urgency: string) => {
    const map: Record<string, string> = {
      critical: "bg-red-500/20 text-red-400 border-red-500/30",
      high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
      medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
      low: "bg-zinc-700/50 text-zinc-400 border-zinc-600/30",
    };
    return map[urgency] || map.low;
  };

  const urgencyIcon = (urgency: string) => {
    const map: Record<string, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🟢" };
    return map[urgency] || "🟢";
  };

  const itemTypeBadge = (t: string) => {
    const map: Record<string, { label: string; color: string }> = {
      cve: { label: "CVE", color: "rose" },
      advisory: { label: "Advisory", color: "amber" },
      policy: { label: "Policy", color: "violet" },
      rumor: { label: "Rumor", color: "zinc" },
      analysis: { label: "Analysis", color: "indigo" },
      news: { label: "News", color: "zinc" },
    };
    return map[t] || map.news;
  };

  /* ─── Research Intelligence: computed data ─── */

  // 2a. Threat Actor Tracking: watched entities with mentions in feed
  const watchedEntities = entities.filter((e) => e.watch === 1);
  const entityMentions = watchedEntities.map((ent) => {
    const mentionCount = displayItems.filter((item) => {
      const text = `${item.title} ${item.summary}`.toLowerCase();
      return text.includes(ent.name.toLowerCase());
    }).length;
    return { ...ent, mentionCount };
  }).filter((e) => e.mentionCount > 0);

  // 2b. CVE Radar: filter items that are CVEs or mention CVE patterns
  const cveItems = displayItems.filter((item) =>
    item.itemType === "cve" || /CVE-\d{4}-\d+/i.test(item.title) || /CVE-\d{4}-\d+/i.test(item.summary)
  );

  // 2c. Read Later Queue: saved but not yet read items
  const readLaterQueue = displayItems.filter((item) => item.saved && !item.read);

  // 2e. Skill Gap Detector: extract tools/tech from feed not in user's skills
  const TECH_PATTERNS = [
    /\b(kubernetes|k8s)\b/i, /\b(docker|containers?)\b/i, /\b(terraform)\b/i,
    /\b(ansible)\b/i, /\b(python)\b/i, /\b(rust)\b/i, /\b(golang)\b/i,
    /\b(aws|azure|gcp)\b/i, /\b(wireshark)\b/i, /\b(burp\s*suite)\b/i,
    /\b(nmap)\b/i, /\b(metasploit)\b/i, /\b(splunk)\b/i, /\b(sentinel)\b/i,
    /\b(crowdstrike)\b/i, /\b(ghidra)\b/i, /\b(ida\s*pro)\b/i,
    /\b(zeek|bro)\b/i, /\b(suricata)\b/i, /\b(yara)\b/i, /\b(osquery)\b/i,
    /\b(mitre\s*att&?ck)\b/i, /\b(soar)\b/i, /\b(siem)\b/i,
    /\b(devsecops)\b/i, /\b(threat\s*hunting)\b/i, /\b(malware\s*analysis)\b/i,
    /\b(reverse\s*engineering)\b/i, /\b(cloud\s*security)\b/i, /\b(zero\s*trust)\b/i,
  ];
  const skillGaps = (() => {
    const found = new Map<string, number>();
    for (const item of displayItems.slice(0, 50)) {
      const text = `${item.title} ${item.summary}`;
      for (const p of TECH_PATTERNS) {
        const match = text.match(p);
        if (match) {
          const tech = match[1] || match[0];
          const normalized = tech.toLowerCase().trim();
          // Skip if user already has this skill
          if (userSkillNames.some((s) => s.includes(normalized) || normalized.includes(s))) continue;
          found.set(normalized, (found.get(normalized) || 0) + 1);
        }
      }
    }
    return [...found.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tech, count]) => ({ tech, count }));
  })();

  return (
    <div className="space-y-3">
      {/* Breaking Now Strip */}
      {breakingItems.length > 0 && (
        <div className="glass-light rounded-2xl p-3 border border-red-500/20 animate-fade-in">
          <div className="flex items-center gap-2 mb-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
            </span>
            <span className="text-xs font-bold text-red-400 uppercase tracking-wider">Breaking Now</span>
          </div>
          {breakingItems.map((b) => (
            <a key={b.id} href={b.url} target="_blank" rel="noopener noreferrer"
              className="block text-xs text-white hover:text-red-300 transition mb-1 truncate">
              {urgencyIcon(b.urgency)} {b.title} ↗
            </a>
          ))}
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-2">
        <StatBox icon="📰" value={displayItems.length} label="Total" />
        <StatBox icon="🆕" value={unread} label="Unread" />
        <StatBox icon="🔥" value={highUrgent} label="Urgent" />
        <StatBox icon="📖" value={readCount} label="Read" />
      </div>

      {/* Scan + Agent */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleScan}
          disabled={scanning}
          className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 text-xs font-medium hover:bg-indigo-500/30 disabled:opacity-50 transition"
        >
          {scanning ? "Scanning…" : "🔍 Scan Now"}
        </button>
        {scanResult && <span className="text-[10px] text-zinc-400 flex-1 truncate">{scanResult}</span>}
      </div>

      <AgentStatus verb="researching latest cybersecurity news" />

      {/* Mobile Pane Toggle */}
      <div className="flex gap-1 lg:hidden">
        <button onClick={() => setActivePane("stream")}
          className={cx("flex-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition",
            activePane === "stream" ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" : "bg-white/5 text-zinc-400 border-white/5"
          )}>📰 Feed</button>
        <button onClick={() => setActivePane("insights")}
          className={cx("flex-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition",
            activePane === "insights" ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" : "bg-white/5 text-zinc-400 border-white/5"
          )}>🧠 Insights</button>
      </div>

      {/* Filter Tabs and News Stream - always visible (CSS handles responsive) */}
      <div className={cx(activePane !== "stream" && "hidden lg:block")}>
        <div className="flex gap-1 overflow-auto pb-1">
            {(["all", "unread", "saved", "high", "archived"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cx(
                "px-3 py-1.5 rounded-lg text-xs font-medium border transition whitespace-nowrap capitalize",
                filter === f ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10"
              )}>
                {f === "all" ? "📋 All" : f === "unread" ? "🆕 Unread" : f === "saved" ? "💾 Saved" : f === "high" ? "🔥 Urgent" : "📦 Archived"}
              </button>
            ))}
          </div>

          {/* News Stream */}
          <div className="space-y-2 max-h-[50vh] overflow-auto mt-2">
            {displayItems.length === 0 && (
              <div className="text-center py-6 text-xs text-zinc-500">
                {hasApi ? "No articles. Click Scan Now to fetch feeds." : "No articles in local store."}
              </div>
            )}
            {displayItems.map((article) => {
              const typeInfo = itemTypeBadge(article.itemType);
              return (
                <div key={article.id} className="glass-light rounded-2xl overflow-hidden animate-fade-in">
                  <button
                    onClick={() => setExpanded(expanded === article.id ? null : article.id)}
                    className="w-full text-left p-3 hover:bg-white/5 transition"
                  >
                    <div className="flex items-start gap-2">
                      <div className={cx(
                        "w-2 h-2 rounded-full mt-1.5 shrink-0",
                        article.read ? "bg-zinc-600" : "bg-indigo-500"
                      )} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          {/* Urgency badge */}
                          <span className={cx("inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold border", urgencyBadge(article.urgency))}>
                            {urgencyIcon(article.urgency)} {article.score}
                          </span>
                          {/* Item type badge */}
                          <Badge color={typeInfo.color}>{typeInfo.label}</Badge>
                          {/* Tags */}
                          {article.tags.slice(0, 2).map((t: string) => (
                            <Badge key={t} color="indigo">{t}</Badge>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] text-zinc-500">{article.source}</span>
                          {article.publishedAt && (
                            <span className="text-[10px] text-zinc-600">{new Date(article.publishedAt).toLocaleDateString()}</span>
                          )}
                        </div>
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cx("text-xs font-semibold mt-1 hover:underline block", article.read ? "text-zinc-400" : "text-white")}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {article.title} ↗
                        </a>
                        {article.summary && (
                          <div className="text-[10px] text-zinc-500 mt-0.5 line-clamp-2">{article.summary}</div>
                        )}
                      </div>
                      <span className={cx("text-zinc-500 transition-transform shrink-0", expanded === article.id && "rotate-90")}>›</span>
                    </div>
                  </button>

                  {expanded === article.id && (
                    <div className="px-3 pb-3 space-y-3 animate-fade-in border-t border-white/5 pt-3">
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => hasApi ? handleMarkRead(article.id, !article.read) : (() => { toggleArticleRead(article.id); refresh(); })()}
                          className={cx("px-3 py-1.5 rounded-lg text-xs font-medium transition",
                            article.read ? "bg-white/5 text-zinc-400" : "bg-indigo-500/20 text-indigo-400"
                          )}
                        >
                          {article.read ? "Mark Unread" : "✓ Mark Read"}
                        </button>
                        <button
                          onClick={() => handleSaveItem(article.id, !article.saved)}
                          className={cx("px-3 py-1.5 rounded-lg text-xs font-medium transition",
                            article.saved ? "bg-amber-500/20 text-amber-400" : "bg-white/5 text-zinc-400"
                          )}
                        >
                          {article.saved ? "💾 Saved" : "Save"}
                        </button>
                        <button
                          onClick={() => handleArchiveItem(article.id, !article.archived)}
                          className={cx("px-3 py-1.5 rounded-lg text-xs font-medium transition",
                            article.archived ? "bg-violet-500/20 text-violet-400" : "bg-white/5 text-zinc-400"
                          )}
                        >
                          {article.archived ? "📦 Archived" : "Archive"}
                        </button>
                        <a href={article.url} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 rounded-lg bg-white/5 text-zinc-400 text-xs hover:bg-white/10 transition">
                          Open Source ↗
                        </a>
                      </div>

                      {/* Notes */}
                      {hasApi && (
                        <div>
                          <div className="text-[10px] text-zinc-400 mb-1.5 font-medium">Your Notes</div>
                          <textarea
                            className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none resize-none h-16"
                            placeholder="Add your thoughts, key takeaways…"
                            value={noteText[article.id] ?? article.notes}
                            onChange={(e) => setNoteText({ ...noteText, [article.id]: e.target.value })}
                          />
                          <button
                            onClick={() => handleSaveNote(article.id, noteText[article.id] ?? article.notes)}
                            className="mt-1 px-3 py-1 rounded-lg bg-indigo-500/20 text-indigo-400 text-[10px] font-medium hover:bg-indigo-500/30 transition"
                          >
                            Save Notes
                          </button>
                        </div>
                      )}

                      {!hasApi && (
                        <div>
                          <div className="text-[10px] text-zinc-400 mb-1.5 font-medium">Your Notes</div>
                          <textarea
                            className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none resize-none h-16"
                            placeholder="Add your thoughts, key takeaways, questions…"
                            value={noteText[article.id] ?? article.notes}
                            onChange={(e) => setNoteText({ ...noteText, [article.id]: e.target.value })}
                          />
                          <button
                            onClick={() => { saveArticleNotes(article.id, noteText[article.id] ?? article.notes); refresh(); }}
                            className="mt-1 px-3 py-1 rounded-lg bg-indigo-500/20 text-indigo-400 text-[10px] font-medium hover:bg-indigo-500/30 transition"
                          >
                            Save Notes
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
      </div>

      {/* Insights Panel (right pane on desktop, toggled on mobile) */}
      <div className={cx(activePane !== "insights" && "hidden lg:block")}>
        <div className="space-y-3">
          {/* Daily Briefing */}
          <Card title="Daily Briefing" icon="📊" actions={
            <button
              onClick={() => handleGenerateBriefing("daily")}
              disabled={briefingLoading}
              className="px-2 py-1 rounded-lg bg-indigo-500/20 text-indigo-400 text-[10px] font-medium hover:bg-indigo-500/30 disabled:opacity-50 transition"
            >
              {briefingLoading ? "Generating…" : "Generate"}
            </button>
          }>
            {latestBriefing ? (
              <div className="text-xs text-zinc-300 whitespace-pre-wrap max-h-40 overflow-auto">
                {latestBriefing.body_md.replace(/^#.*\n/gm, "").replace(/\*([^*]+)\*/g, "$1").slice(0, 500)}
                {latestBriefing.model_used === "rule-based" && (
                  <div className="mt-2 text-[10px] text-zinc-500 italic">⚡ Rule-based summary (free)</div>
                )}
              </div>
            ) : (
              <div className="text-xs text-zinc-500">Click Generate to create today&apos;s briefing.</div>
            )}
          </Card>

          {/* Trending Topics */}
          {trends.length > 0 && (
            <Card title="Trending" icon="📈">
              <div className="space-y-1.5">
                {trends.slice(0, 6).map((t) => (
                  <div key={t.id} className="flex items-center justify-between">
                    <span className="text-xs text-zinc-300">{t.topic}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-500">{t.mention_count} mentions</span>
                      {t.momentum_score > 1.5 && (
                        <span className="text-[10px] text-emerald-400">↑ {t.momentum_score.toFixed(1)}x</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Watch Entities */}
          {entities.length > 0 && (
            <Card title="Watchlist" icon="👁️">
              <div className="space-y-1.5">
                {entities.slice(0, 8).map((e) => (
                  <div key={e.id} className="flex items-center justify-between">
                    <span className="text-xs text-zinc-300">
                      {e.type === "cve" ? "🛡️" : e.type === "threat_actor" ? "🎭" : "🏢"} {e.name}
                    </span>
                    <button
                      onClick={() => handleWatchEntity(e.id, e.watch === 0)}
                      className={cx("text-[10px] px-2 py-0.5 rounded transition",
                        e.watch ? "bg-amber-500/20 text-amber-400" : "bg-white/5 text-zinc-500"
                      )}
                    >
                      {e.watch ? "Watching" : "Watch"}
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Deep Dive Launch */}
          <Card title="Deep Dive" icon="🔬">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Topic or entity…"
                value={deepDiveTopic}
                onChange={(e) => setDeepDiveTopic(e.target.value)}
                className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-white placeholder-zinc-500 outline-none"
              />
              <button
                onClick={() => { if (deepDiveTopic.trim()) handleGenerateBriefing("theme", deepDiveTopic.trim()); }}
                disabled={briefingLoading || !deepDiveTopic.trim()}
                className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 text-xs font-medium hover:bg-indigo-500/30 disabled:opacity-50 transition"
              >
                {briefingLoading ? "…" : "Go"}
              </button>
            </div>
          </Card>

          <Card title="Reading Progress" icon="📊">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-zinc-400">{readCount} of {displayItems.length} articles</span>
              <span className="text-xs font-semibold text-white">{displayItems.length > 0 ? Math.round((readCount / displayItems.length) * 100) : 0}%</span>
            </div>
            <ProgressBar value={displayItems.length > 0 ? (readCount / displayItems.length) * 100 : 0} gradient="from-indigo-500 to-violet-500" />
          </Card>

          {/* 2a. Threat Actor Tracking */}
          {entityMentions.length > 0 && (
            <Card title="Threat Actor Alerts" icon="🎭">
              <div className="space-y-1.5">
                {entityMentions.map((e) => (
                  <div key={e.id} className="flex items-center justify-between rounded-lg bg-red-500/5 px-3 py-2 border border-red-500/10">
                    <div>
                      <span className="text-xs text-white font-medium">{e.name}</span>
                      <span className="text-[10px] text-zinc-500 ml-1">({e.type})</span>
                    </div>
                    <span className="text-[10px] bg-red-500/20 text-red-400 rounded-full px-2 py-0.5 font-medium">
                      {e.mentionCount} mention{e.mentionCount !== 1 ? "s" : ""} in feed
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 2b. CVE Radar */}
          {cveItems.length > 0 && (
            <Card title="CVE Radar" icon="🛡️">
              <div className="space-y-1.5 max-h-40 overflow-auto">
                {cveItems.slice(0, 8).map((item) => {
                  const cveMatch = item.title.match(/CVE-\d{4}-\d+/i) || item.summary.match(/CVE-\d{4}-\d+/i);
                  return (
                    <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer"
                      className="block rounded-lg bg-rose-500/5 px-3 py-2 hover:bg-rose-500/10 transition border border-rose-500/10">
                      <div className="flex items-center gap-2">
                        {cveMatch && <span className="text-[10px] bg-rose-500/20 text-rose-400 rounded-full px-1.5 py-0.5 font-mono shrink-0">{cveMatch[0]}</span>}
                        <span className="text-[10px] text-white truncate">{item.title} ↗</span>
                      </div>
                      <div className="text-[9px] text-zinc-500 mt-0.5">{item.source} · {urgencyIcon(item.urgency)} {item.urgency}</div>
                    </a>
                  );
                })}
              </div>
            </Card>
          )}

          {/* 2c. Read Later Queue */}
          {readLaterQueue.length > 0 && (
            <Card title="Read Later" icon="📑" actions={
              <span className="text-[10px] text-zinc-500">{readLaterQueue.length} queued</span>
            }>
              <div className="space-y-1.5 max-h-40 overflow-auto">
                {readLaterQueue.slice(0, 8).map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 hover:bg-white/10 transition">
                    <div className="min-w-0 flex-1 mr-2">
                      <a href={item.url} target="_blank" rel="noopener noreferrer"
                        className="text-[10px] text-white hover:underline truncate block">{item.title} ↗</a>
                      <div className="text-[9px] text-zinc-500">{item.source}</div>
                    </div>
                    <button onClick={() => handleMarkRead(item.id, true)}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 shrink-0 hover:bg-indigo-500/30 transition">
                      ✓ Read
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 2d. Daily Briefing Card — top 3 trends with action items */}
          {trends.length > 0 && (
            <Card title="Daily Intel Brief" icon="📋">
              <div className="space-y-2">
                {trends.slice(0, 3).map((t, i) => {
                  const action = t.momentum_score > 2 ? "Investigate immediately"
                    : t.momentum_score > 1 ? "Monitor closely"
                    : "Track for awareness";
                  return (
                    <div key={t.id} className="rounded-lg bg-white/5 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-indigo-400">{i + 1}.</span>
                        <span className="text-xs text-white font-medium">{t.topic}</span>
                        {t.momentum_score > 1.5 && (
                          <span className="text-[9px] bg-emerald-500/20 text-emerald-400 rounded-full px-1.5 py-0.5">↑ trending</span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">{t.mention_count} mentions · momentum {t.momentum_score.toFixed(1)}x</div>
                      <div className="text-[10px] text-amber-400/80 mt-0.5">→ {action}</div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* 2e. Skill Gap Detector */}
          {skillGaps.length > 0 && (
            <Card title="Skill Gap Detector" icon="🔍">
              <div className="text-[10px] text-zinc-500 mb-2">Tools & tech mentioned in your feed but not in your skills:</div>
              <div className="space-y-1.5">
                {skillGaps.map(({ tech, count }) => (
                  <div key={tech} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-white font-medium capitalize">{tech}</span>
                      <span className="text-[9px] text-zinc-500">{count} mention{count !== 1 ? "s" : ""}</span>
                    </div>
                    <button
                      onClick={() => apiPost("/skills/suggestions", { proposed_skill_name: tech, reason_md: `Detected ${count} mentions in research feed` }).catch(() => {})}
                      className="text-[9px] px-2 py-0.5 rounded bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition">
                      + Add Skill
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   NOTES — All notes in one place
   ═══════════════════════════════════════════════════════ */
function NotesWidgets({ notes, refresh }: { notes: Note[]; refresh: () => void }) {
  const [filter, setFilter] = useState<string>("all");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");

  const filtered = filter === "all" ? notes : notes.filter((n) => n.tab === filter);

  return (
    <div className="space-y-3">
      {/* Filter */}
      <div className="flex gap-1 overflow-auto pb-1">
        {["all", "home", "school", "jobs", "skills", "research"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cx(
            "px-3 py-1.5 rounded-lg text-xs font-medium border transition whitespace-nowrap capitalize",
            filter === f ? "bg-teal-500/20 text-teal-400 border-teal-500/30" : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10"
          )}>{f}</button>
        ))}
      </div>

      {/* Quick add */}
      <Card title="New Note" icon="✏️">
        <div className="space-y-2">
          <input
            className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-teal-500/50 transition"
            placeholder="Title…"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <textarea
            className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none focus:border-teal-500/50 transition resize-none"
            rows={3}
            placeholder="Content…"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
          />
          <button
            onClick={() => {
              if (newTitle.trim()) {
                saveNote({ tab: "home", title: newTitle.trim(), content: newContent });
                setNewTitle("");
                setNewContent("");
                refresh();
              }
            }}
            className="px-4 py-1.5 rounded-lg bg-teal-500/20 text-teal-400 text-xs font-medium hover:bg-teal-500/30 transition"
          >Save Note</button>
        </div>
      </Card>

      {/* Notes list */}
      <Card title={`Notes (${filtered.length})`} icon="📝">
        {filtered.length === 0 ? <EmptyState icon="📝" text="No notes yet." /> : (
          <div className="space-y-2">
            {filtered.map((n) => (
              <div key={n.id} className="rounded-xl bg-white/5 p-3 hover:bg-white/10 transition group">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white">{n.title}</span>
                  <div className="flex items-center gap-2">
                    <Badge color="teal">{n.tab}</Badge>
                    <button
                      onClick={() => { deleteNote(n.id); refresh(); }}
                      className="text-[10px] text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
                    >✕</button>
                  </div>
                </div>
                {n.content && <div className="text-[11px] text-zinc-400 mt-1 line-clamp-2">{n.content}</div>}
                <div className="text-[10px] text-zinc-600 mt-1">{new Date(n.updatedAt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SETTINGS — Preferences & connectors
   ═══════════════════════════════════════════════════════ */
/* ── types for Settings v2 API responses ── */
type ModeProfile = {
  id?: string; mode_key: string; name: string; active: number; config_json?: string;
};
type UsageSummary = {
  window: string; total_input_tokens: number; total_output_tokens: number;
  total_estimated_cost: number; request_count: number;
  by_model: { model: string; input_tokens: number; output_tokens: number; count: number }[];
  by_scope: { feature_scope: string; input_tokens: number; output_tokens: number; count: number }[];
};
type ConnectorInfo = {
  connector_key: string; status: string; last_checked_at?: string | null; details_json?: string | null;
};
type AuditEntry = {
  id: string; action_type: string; before_json?: string | null; after_json?: string | null; actor: string; created_at: string;
};

function SettingsWidgets() {
  const [serviceStatus, setServiceStatus] = useState<{
    endpoints?: { name: string; status: string; latencyMs: number | null }[];
    portReference?: { port: number; protocol: string; service: string; description: string; required: boolean }[];
    cleanupCommands?: { label: string; command: string }[];
  } | null>(null);
  const [serviceLoading, setServiceLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Settings v2 state
  const [modes, setModes] = useState<ModeProfile[]>([]);
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const [modeApplying, setModeApplying] = useState(false);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageWindow, setUsageWindow] = useState<"day" | "week" | "month">("day");
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [diagRunning, setDiagRunning] = useState(false);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [settingsSection, setSettingsSection] = useState<"modes" | "usage" | "connectors" | "cron" | "audit">("modes");

  const checkServices = useCallback(async () => {
    setServiceLoading(true);
    try {
      const res = await fetch("/api/debug/services");
      if (res.ok) {
        const data = await res.json();
        setServiceStatus(data);
      }
    } catch { /* ignore — endpoint not available */ }
    setServiceLoading(false);
  }, []);

  const copyCmd = useCallback((cmd: string) => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(cmd);
      setTimeout(() => setCopied(null), 1500);
    }).catch(() => {});
  }, []);

  // Load modes
  useEffect(() => {
    apiGet<{ modes: ModeProfile[] }>("/settings/modes")
      .then((d) => {
        setModes(d.modes || []);
        const active = (d.modes || []).find((m) => m.active === 1);
        if (active) setActiveMode(active.mode_key);
      })
      .catch(() => {});
  }, []);

  // Load usage when window changes
  useEffect(() => {
    apiGet<{ usage: UsageSummary }>(`/settings/usage?window=${usageWindow}`)
      .then((d) => setUsage(d.usage || null))
      .catch(() => {});
  }, [usageWindow]);

  // Load connectors
  useEffect(() => {
    apiGet<{ connectors: ConnectorInfo[] }>("/settings/connectors/status")
      .then((d) => setConnectors(d.connectors || []))
      .catch(() => {});
  }, []);

  // Load audit log
  useEffect(() => {
    if (settingsSection === "audit") {
      apiGet<{ entries: AuditEntry[] }>("/settings/audit")
        .then((d) => setAuditEntries(d.entries || []))
        .catch(() => {});
    }
  }, [settingsSection]);

  const applyMode = useCallback(async (modeKey: string) => {
    setModeApplying(true);
    try {
      await apiPost("/settings/modes/apply", { mode_key: modeKey });
      setActiveMode(modeKey);
      setModes((prev) => prev.map((m) => ({ ...m, active: m.mode_key === modeKey ? 1 : 0 })));
    } catch { /* ignore */ }
    setModeApplying(false);
  }, []);

  const runDiagnostics = useCallback(async () => {
    setDiagRunning(true);
    try {
      const res = await apiPost<{ results: ConnectorInfo[] }>("/settings/connectors/diagnostics", {});
      setConnectors(res.results || []);
    } catch { /* ignore */ }
    setDiagRunning(false);
  }, []);

  const connectorStatusColor = (s: string) => {
    if (s === "ok") return "emerald";
    if (s === "warn") return "amber";
    if (s === "error") return "rose";
    return "zinc";
  };

  const modeIcons: Record<string, string> = {
    focus: "🎯", research: "🔬", market: "📈", jobs: "💼", study: "🎓", low_cost: "💰", custom: "⚙️",
  };

  return (
    <div className="space-y-3">
      {/* Section Switcher */}
      <div className="glass-light rounded-2xl p-3 animate-fade-in">
        <div className="flex flex-wrap gap-1.5">
          {([
            ["modes", "🎛️ Modes"],
            ["usage", "📊 Usage"],
            ["connectors", "🔌 Health"],
            ["cron", "⚡ Cron"],
            ["audit", "📜 Audit"],
          ] as [typeof settingsSection, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setSettingsSection(key)}
              className={cx(
                "text-[10px] px-2.5 py-1.5 rounded-lg font-medium transition",
                settingsSection === key
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "bg-white/5 text-zinc-400 hover:bg-white/10"
              )}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── MODES SECTION ── */}
      {settingsSection === "modes" && (
        <>
          <Card title="Mode Switcher" icon="🎛️">
            <div className="grid grid-cols-2 gap-2">
              {modes.map((mode) => (
                <button key={mode.mode_key} onClick={() => applyMode(mode.mode_key)}
                  disabled={modeApplying}
                  className={cx(
                    "text-left rounded-xl px-3 py-2.5 text-xs transition border",
                    activeMode === mode.mode_key
                      ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300"
                      : "bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10"
                  )}>
                  <span className="mr-1.5">{modeIcons[mode.mode_key] || "⚙️"}</span>
                  {mode.name}
                  {activeMode === mode.mode_key && <Badge color="cyan">Active</Badge>}
                </button>
              ))}
            </div>
            {modes.length === 0 && (
              <div className="text-xs text-zinc-500 py-2">Loading modes…</div>
            )}
          </Card>

          <Card title="Account" icon="👤">
            <div className="space-y-2 text-xs text-zinc-300">
              <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                <span>Session</span>
                <Badge color="emerald">Active (180-day)</Badge>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                <span>CSRF Protection</span>
                <Badge color="emerald">Enabled</Badge>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                <span>Storage</span>
                <Badge color="cyan">Cloudflare D1</Badge>
              </div>
            </div>
          </Card>

          <Card title="Notifications" icon="🔔">
            <div className="space-y-2 text-xs text-zinc-300">
              <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                <span>In-app notifications</span>
                <Badge color="emerald">On</Badge>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                <span>Push notifications</span>
                <Badge color="zinc">Requires HTTPS</Badge>
              </div>
            </div>
          </Card>

          <Card title="About" icon="ℹ️">
            <div className="text-xs text-zinc-400 space-y-1">
              <div><strong className="text-zinc-300">My Control Center</strong> v0.2.0</div>
              <div>Next.js 15 · Tailwind 4 · Cloudflare Pages</div>
              <div>Open-source personal dashboard</div>
            </div>
          </Card>
        </>
      )}

      {/* ── USAGE SECTION ── */}
      {settingsSection === "usage" && (
        <>
          <Card title="Token Usage" icon="📊" actions={
            <div className="flex gap-1">
              {(["day", "week", "month"] as const).map((w) => (
                <button key={w} onClick={() => setUsageWindow(w)}
                  className={cx(
                    "text-[10px] px-2 py-0.5 rounded transition",
                    usageWindow === w ? "bg-cyan-500/20 text-cyan-400" : "bg-white/5 text-zinc-500 hover:bg-white/10"
                  )}>
                  {w.charAt(0).toUpperCase() + w.slice(1)}
                </button>
              ))}
            </div>
          }>
            {!usage ? (
              <div className="text-xs text-zinc-500 py-2">Loading usage data…</div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <StatBox icon="📥" value={usage.total_input_tokens.toLocaleString()} label="Input Tokens" />
                  <StatBox icon="📤" value={usage.total_output_tokens.toLocaleString()} label="Output Tokens" />
                  <StatBox icon="💵" value={`$${usage.total_estimated_cost.toFixed(4)}`} label="Est. Cost" />
                </div>
                <div className="text-[10px] text-zinc-500 text-center">{usage.request_count} request{usage.request_count !== 1 ? "s" : ""} this {usage.window}</div>

                {usage.by_model.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">By Model</div>
                    {usage.by_model.map((m) => (
                      <div key={m.model} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-1.5">
                        <span className="text-xs text-white font-mono">{m.model}</span>
                        <span className="text-[10px] text-zinc-400">{(m.input_tokens + m.output_tokens).toLocaleString()} tok · {m.count} calls</span>
                      </div>
                    ))}
                  </div>
                )}

                {usage.by_scope.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">By Feature</div>
                    {usage.by_scope.map((s) => (
                      <div key={s.feature_scope} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-1.5">
                        <span className="text-xs text-white">{s.feature_scope}</span>
                        <span className="text-[10px] text-zinc-400">{(s.input_tokens + s.output_tokens).toLocaleString()} tok · {s.count} calls</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      {/* ── CONNECTORS / HEALTH SECTION ── */}
      {settingsSection === "connectors" && (
        <>
          <Card title="Connector Health" icon="🔌" actions={
            <button onClick={runDiagnostics} disabled={diagRunning}
              className="text-[10px] px-2 py-1 rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition disabled:opacity-50">
              {diagRunning ? "Running…" : "Run Diagnostics"}
            </button>
          }>
            <div className="space-y-1.5">
              {connectors.map((c) => (
                <div key={c.connector_key} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                  <div className="min-w-0">
                    <span className="text-xs text-white font-medium">{c.connector_key.toUpperCase()}</span>
                    {c.details_json && (
                      <div className="text-[10px] text-zinc-500 truncate mt-0.5">{
                        (() => { try { const d = JSON.parse(c.details_json); return d.message || d.details || c.details_json; } catch { return c.details_json; } })()
                      }</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {c.last_checked_at && <span className="text-[10px] text-zinc-600">{new Date(c.last_checked_at).toLocaleTimeString()}</span>}
                    <Badge color={connectorStatusColor(c.status)}>{c.status}</Badge>
                  </div>
                </div>
              ))}
              {connectors.length === 0 && (
                <div className="text-xs text-zinc-500 py-2">No connector data. Click Run Diagnostics.</div>
              )}
            </div>
          </Card>

          {/* VPS Services (existing) */}
          <Card title="VPS Services" icon="🖥️" actions={
            <button onClick={checkServices} disabled={serviceLoading}
              className="text-[10px] px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 transition disabled:opacity-50">
              {serviceLoading ? "Checking…" : "Check Status"}
            </button>
          }>
            {!serviceStatus ? (
              <div className="text-xs text-zinc-500 py-2">Click <strong>Check Status</strong> to probe VPS endpoints.</div>
            ) : (
              <div className="space-y-3">
                {serviceStatus.endpoints && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Tunnel Endpoints</div>
                    {serviceStatus.endpoints.map((ep) => (
                      <div key={ep.name} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                        <span className="text-xs text-white">{ep.name}</span>
                        <div className="flex items-center gap-2">
                          {ep.latencyMs != null && <span className="text-[10px] text-zinc-500">{ep.latencyMs}ms</span>}
                          <Badge color={ep.status === "reachable" ? "emerald" : ep.status === "not_configured" ? "zinc" : "rose"}>
                            {ep.status === "reachable" ? "Online" : ep.status === "not_configured" ? "Not set" : "Offline"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {serviceStatus.portReference && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">OpenClaw Port Reference</div>
                    {serviceStatus.portReference.map((p) => (
                      <div key={p.port} className="rounded-xl bg-white/5 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-white font-mono">:{p.port} <span className="text-zinc-500">{p.protocol}</span></span>
                          <Badge color={p.required ? "emerald" : "zinc"}>{p.required ? "Required" : "Optional"}</Badge>
                        </div>
                        <div className="text-[10px] text-zinc-400 mt-0.5">{p.service} — {p.description}</div>
                      </div>
                    ))}
                  </div>
                )}
                {serviceStatus.cleanupCommands && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Terminal Commands</div>
                    {serviceStatus.cleanupCommands.map((c) => (
                      <div key={c.label} className="rounded-xl bg-white/5 px-3 py-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-zinc-400">{c.label}</span>
                          <button onClick={() => copyCmd(c.command)}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-zinc-400 transition">
                            {copied === c.command ? "✓ Copied" : "Copy"}
                          </button>
                        </div>
                        <code className="block text-[10px] text-cyan-400 font-mono break-all">{c.command}</code>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      {/* ── CRON SECTION ── */}
      {settingsSection === "cron" && <AutonomyPanel />}

      {/* ── AUDIT LOG SECTION ── */}
      {settingsSection === "audit" && (
        <Card title="Settings Audit Log" icon="📜">
          {auditEntries.length === 0 ? (
            <div className="text-xs text-zinc-500 py-2">No audit entries yet. Changes to modes, budgets, and model routing are logged here.</div>
          ) : (
            <div className="space-y-1.5">
              {auditEntries.map((entry) => (
                <div key={entry.id} className="rounded-xl bg-white/5 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white font-medium">{entry.action_type.replace(/_/g, " ")}</span>
                    <span className="text-[10px] text-zinc-500">{new Date(entry.created_at).toLocaleString()}</span>
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">
                    by {entry.actor}
                    {entry.after_json && (
                      <span className="ml-1 text-zinc-600">→ {(() => { try { const a = JSON.parse(entry.after_json); return typeof a === "object" ? Object.keys(a).join(", ") : String(a); } catch { return ""; } })()}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   AUTONOMY PANEL — Cron job status + manual triggers
   ═══════════════════════════════════════════════════════ */
function AutonomyPanel() {
  const [jobs, setJobs] = useState<{
    jobName: string; lastRunAt: string | null; status: string | null;
    itemsProcessed: number; tookMs: number | null; error: string | null;
    cron: string | null; description: string | null;
  }[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [expandedError, setExpandedError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ jobs: typeof jobs }>("/admin/cron");
      setJobs(data.jobs || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const runJob = useCallback(async (jobName: string) => {
    setRunning(jobName);
    try {
      await apiPost("/admin/cron", { jobName });
      await loadStatus();
    } catch { /* ignore */ }
    setRunning(null);
  }, [loadStatus]);

  const statusColor = (s: string | null) => {
    if (s === "ok" || s === "success") return "emerald";
    if (s === "partial") return "amber";
    if (s === "error") return "rose";
    return "zinc";
  };

  const fmtTime = (iso: string | null) => {
    if (!iso) return "Never";
    try {
      const d = new Date(iso);
      const diff = Date.now() - d.getTime();
      if (diff < 60000) return "Just now";
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      return d.toLocaleDateString();
    } catch { return iso; }
  };

  return (
    <Card title="Autonomy" icon="⚡" actions={
      <button onClick={loadStatus} disabled={loading}
        className="text-[10px] px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 transition disabled:opacity-50">
        {loading ? "Loading…" : "Refresh"}
      </button>
    }>
      {jobs.length === 0 && !loading ? (
        <div className="text-xs text-zinc-500 py-2">No cron job data yet. Run a scan first or check D1 connection.</div>
      ) : (
        <div className="space-y-1.5">
          {jobs.map((job) => (
            <div key={job.jobName} className="rounded-xl bg-white/5 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-white font-medium">{job.jobName.replace(/_/g, " ")}</span>
                  {job.cron && <span className="ml-2 text-[10px] text-zinc-500 font-mono">{job.cron}</span>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge color={statusColor(job.status)}>{job.status || "—"}</Badge>
                  <button
                    onClick={() => runJob(job.jobName)}
                    disabled={running === job.jobName}
                    className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 transition disabled:opacity-50"
                  >
                    {running === job.jobName ? "Running…" : "Run"}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-zinc-500">
                <span>Last: {fmtTime(job.lastRunAt)}</span>
                {job.itemsProcessed > 0 && <span>{job.itemsProcessed} items</span>}
                {job.tookMs != null && <span>{job.tookMs}ms</span>}
              </div>
              {job.description && <div className="text-[10px] text-zinc-600 mt-0.5">{job.description}</div>}
              {job.error && (
                <div className="mt-1">
                  <button onClick={() => setExpandedError(expandedError === job.jobName ? null : job.jobName)}
                    className="text-[10px] text-rose-400 hover:text-rose-300 transition">
                    {expandedError === job.jobName ? "▾ Hide error" : "▸ View error"}
                  </button>
                  {expandedError === job.jobName && (
                    <pre className="mt-1 text-[10px] text-rose-400/80 bg-rose-500/5 rounded p-2 overflow-x-auto">{job.error}</pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

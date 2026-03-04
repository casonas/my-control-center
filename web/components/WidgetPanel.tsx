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

  // Default resources if none loaded
  const defaultResources: ApiResource[] = [
    { id: "def-lms", category: "lms", name: "LMS Portal (Canvas/Blackboard)", url: "", notes: "" },
    { id: "def-library", category: "library", name: "Library Portal", url: "", notes: "" },
    { id: "def-tutoring", category: "tutoring", name: "Tutoring Center", url: "", notes: "" },
    { id: "def-writing", category: "writing", name: "Writing Center", url: "", notes: "" },
    { id: "def-career", category: "career", name: "Career Center", url: "", notes: "" },
  ];
  const displayResources = resources.length > 0 ? resources : defaultResources;
  const resCatIcons: Record<string, string> = { lms: "🎓", library: "📚", tutoring: "👩‍🏫", writing: "✍️", career: "💼", other: "🔗" };

  // Due-soon badge helper
  function dueBadge(dueAt: string, status: string) {
    if (status === "done" || status === "dropped") return null;
    const diff = Math.ceil((new Date(dueAt).getTime() - Date.now()) / 86400000);
    if (diff < 0) return <Badge color="rose">Late</Badge>;
    if (diff <= 7) return <Badge color="amber">Due soon</Badge>;
    return null;
  }

  // Agent quick actions
  const agentActions = [
    { label: "Break assignment into steps", icon: "🧩" },
    { label: "Create 5-day study plan", icon: "📅" },
    { label: "Quiz me from this note", icon: "❓" },
    { label: "Summarize attached file", icon: "📄" },
  ];

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
                  )}>{resCatIcons[c]} {c}</button>
                ))}
                <button onClick={handleAddResource} className="ml-auto px-3 py-1 rounded-lg bg-violet-500/20 text-violet-400 text-[10px] font-medium hover:bg-violet-500/30 transition">Save</button>
              </div>
            </div>
          )}
          <div className="space-y-1.5 max-h-48 overflow-auto">
            {displayResources.map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 group hover:bg-white/10 transition">
                <span className="text-sm">{resCatIcons[r.category] || "🔗"}</span>
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
          {agentActions.map((act) => (
            <button key={act.label}
              className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-[10px] text-zinc-300 hover:bg-violet-500/10 hover:text-violet-400 transition text-left"
              title={act.label}>
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

  // Outreach draft state
  const [draftingJobId, setDraftingJobId] = useState<string | null>(null);
  const [draftResult, setDraftResult] = useState<{ subject: string; body_md: string } | null>(null);

  // API-backed data
  interface ApiJob {
    id: string; title: string; company: string; location?: string;
    url: string; status: string; posted_at?: string; fetched_at: string;
    remote?: number; remote_flag?: string; tags_json?: string; notes?: string;
    match_score?: number; why_match?: string; match_factors_json?: string;
  }
  const [apiJobs, setApiJobs] = useState<ApiJob[]>([]);
  const [pipeline, setPipeline] = useState<Record<string, number>>({});
  interface ApiCompany { id: string; name: string; website_url?: string; linkedin_url?: string; notes?: string }
  const [companies, setCompanies] = useState<ApiCompany[]>([]);
  interface WatchCompany { id: string; company_name: string; tier: string; source?: string; notes?: string; matching_jobs?: number }
  const [watchCompanies, setWatchCompanies] = useState<WatchCompany[]>([]);
  interface ApiTemplate { id: string; name: string; subject: string; body_md: string }
  const [templates, setTemplates] = useState<ApiTemplate[]>([]);
  const [hasApi, setHasApi] = useState(false);

  const loadJobs = useCallback(async (status: string) => {
    try {
      const data = await apiGet<{ items: ApiJob[]; lastRefresh?: string }>(`/jobs/feed?status=${status}&limit=50`);
      if (data.items) { setApiJobs(data.items); setHasApi(true); }
      if (data.lastRefresh) setLastRefresh(data.lastRefresh);
    } catch { setHasApi(false); }
  }, []);

  const loadPipeline = useCallback(async () => {
    try {
      const data = await apiGet<{ pipeline: Record<string, number> }>("/jobs/pipeline");
      if (data.pipeline) setPipeline(data.pipeline);
    } catch { /* non-fatal */ }
  }, []);

  const loadCompanies = useCallback(async () => {
    try {
      const data = await apiGet<{ companies: ApiCompany[] }>("/companies");
      if (data.companies) setCompanies(data.companies);
    } catch { /* non-fatal */ }
  }, []);

  const loadWatchCompanies = useCallback(async () => {
    try {
      const data = await apiGet<{ companies: WatchCompany[] }>("/companies/watch");
      if (data.companies) setWatchCompanies(data.companies);
    } catch { /* non-fatal */ }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const data = await apiGet<{ templates: ApiTemplate[] }>("/templates");
      if (data.templates) setTemplates(data.templates);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadJobs(statusFilter); loadPipeline(); loadCompanies(); loadWatchCompanies(); loadTemplates(); }, [statusFilter, loadJobs, loadPipeline, loadCompanies, loadWatchCompanies, loadTemplates]);

  async function handleRefresh() {
    setRefreshing(true); setRefreshResult(null);
    try {
      const data = await apiPost<{ ok: boolean; newJobs?: number; inserted?: number; scored?: number; failedSources?: number; fetched?: number; deduped?: number; error?: string }>("/jobs/refresh", {});
      if (data.ok) {
        const parts = [`${data.inserted || data.newJobs || 0} new`];
        if (data.deduped) parts.push(`${data.deduped} deduped`);
        if (data.scored) parts.push(`${data.scored} scored`);
        if (data.failedSources) parts.push(`${data.failedSources} source errors`);
        setRefreshResult(parts.join(", "));
        // If refresh yielded 0 inserted items due to source failures, mark as stale
        if ((data.inserted || 0) === 0 && (data.failedSources || 0) > 0) {
          setStaleData(true);
        } else {
          setStaleData(false);
        }
      } else {
        setRefreshResult(data.error || "Failed");
      }
      loadJobs(statusFilter); loadPipeline();
    } catch (e) { setRefreshResult(e instanceof Error ? e.message : "Failed"); setStaleData(true); }
    finally { setRefreshing(false); }
  }

  async function handleStatusChange(jobId: string, newStatus: string) {
    try { await apiPatch(`/jobs/${jobId}`, { status: newStatus }); loadJobs(statusFilter); loadPipeline(); }
    catch { /* fallback */ toggleJobApplied(jobId); refresh(); }
  }

  async function handleAddToWatch(companyName: string) {
    try {
      await apiPost("/companies/watch", { company_name: companyName, tier: "emerging", source: "manual" });
      loadWatchCompanies();
    } catch { /* non-fatal */ }
  }

  async function handleDraftOutreach(jobId: string) {
    if (templates.length === 0) return;
    setDraftingJobId(jobId);
    setDraftResult(null);
    try {
      const data = await apiPost<{ ok: boolean; subject: string; body_md: string }>("/outreach/draft", { job_id: jobId, template_id: templates[0].id });
      if (data.ok) setDraftResult({ subject: data.subject, body_md: data.body_md });
    } catch { /* non-fatal */ }
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

  const pSaved = pipeline.saved || 0;
  const pNew = pipeline.new || 0;
  const pApplied = pipeline.applied || 0;
  const pInterview = pipeline.interview || 0;
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
      <div className="grid grid-cols-3 gap-2">
        <StatBox icon="💼" value={displayJobs.length} label="Total" />
        <StatBox icon="✅" value={pApplied} label="Applied" />
        <StatBox icon="🆕" value={pNew + pSaved} label="New/Saved" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={handleRefresh} disabled={refreshing}
          className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 disabled:opacity-50 transition">
          {refreshing ? "Refreshing…" : "🔄 Refresh Feed"}
        </button>
        <span className="text-[10px] text-zinc-500">Last: {lastRefreshLabel}</span>
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
          {displayJobs.map((j) => {
            const jobTags: string[] = j.tags_json ? JSON.parse(j.tags_json) : [];
            const ms = (j as ApiJob).match_score;
            const wm = (j as ApiJob).why_match;
            const mfRaw = (j as ApiJob).match_factors_json;
            const matchFactors: { category: string; label: string; delta: number }[] = mfRaw ? JSON.parse(mfRaw) : [];
            return (
            <div key={j.id} className="rounded-xl bg-white/5 p-3 hover:bg-white/10 transition group">
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
                    {templates.length > 0 && (
                      <button onClick={() => handleDraftOutreach(j.id)} className="text-[9px] text-violet-400 hover:underline">📨 Draft</button>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  {j.status !== "applied" && (
                    <button onClick={() => hasApi ? handleStatusChange(j.id, "applied") : (() => { toggleJobApplied(j.id); refresh(); })()}
                      className="px-2 py-1 rounded-lg text-[10px] font-medium bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition">Apply</button>
                  )}
                  {j.status !== "saved" && j.status !== "applied" && (
                    <button onClick={() => handleStatusChange(j.id, "saved")}
                      className="px-2 py-1 rounded-lg text-[10px] font-medium bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition">Save</button>
                  )}
                  {j.status !== "dismissed" && (
                    <button onClick={() => handleStatusChange(j.id, "dismissed")}
                      className="px-2 py-1 rounded-lg text-[10px] font-medium bg-white/5 text-zinc-500 hover:bg-white/10 transition">✕</button>
                  )}
                </div>
              </div>
            </div>
            );
          })}
        </div>
      </Card>

      {/* Outreach Draft Modal */}
      {draftingJobId && draftResult && (
        <Card title="Outreach Draft" icon="📨" actions={
          <button onClick={() => { setDraftingJobId(null); setDraftResult(null); }} className="text-[10px] px-2 py-1 rounded-lg bg-white/5 text-zinc-400 hover:bg-white/10 transition">Close</button>
        }>
          <div className="space-y-2">
            <div className="text-[10px] text-zinc-400">Subject:</div>
            <div className="text-xs text-white bg-white/5 rounded-lg p-2">{draftResult.subject}</div>
            <div className="text-[10px] text-zinc-400">Body:</div>
            <div className="text-xs text-zinc-300 bg-white/5 rounded-lg p-2 whitespace-pre-wrap max-h-40 overflow-auto">{draftResult.body_md}</div>
            <button onClick={() => { navigator.clipboard.writeText(`Subject: ${draftResult.subject}\n\n${draftResult.body_md}`); }}
              className="px-3 py-1.5 rounded-lg bg-violet-500/20 text-violet-400 text-xs font-medium hover:bg-violet-500/30 transition">📋 Copy to Clipboard</button>
          </div>
        </Card>
      )}

      {/* Companies to Watch */}
      <Card title="Companies to Watch" icon="🏢">
        <div className="space-y-1.5 max-h-48 overflow-auto">
          {watchCompanies.length === 0 && companies.length === 0 && <div className="text-[10px] text-zinc-500">No companies yet. Add from job details.</div>}
          {watchCompanies.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2" onClick={() => setStatusFilter("all")}>
              <Badge color={c.tier === "big" ? "cyan" : "amber"}>{c.tier}</Badge>
              <span className="text-xs text-white flex-1">{c.company_name}</span>
              {(c.matching_jobs ?? 0) > 0 && <span className="text-[9px] text-emerald-400">{c.matching_jobs} jobs</span>}
              <a href={`https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(c.company_name)}`}
                target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-400 hover:underline">LinkedIn</a>
            </div>
          ))}
          {watchCompanies.length === 0 && companies.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
              <span className="text-xs text-white flex-1">{c.name}</span>
              {c.website_url && <a href={c.website_url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-zinc-400 hover:text-white">🌐</a>}
              <a href={c.linkedin_url || `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(c.name)}`}
                target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-400 hover:underline">LinkedIn</a>
            </div>
          ))}
        </div>
      </Card>

      {/* Outreach Templates */}
      <Card title="Outreach Templates" icon="📨">
        <div className="space-y-1.5">
          {templates.length > 0 ? templates.map((t) => (
            <div key={t.id} className="w-full text-left rounded-lg bg-white/5 hover:bg-white/10 px-3 py-2 text-xs text-zinc-300 transition">{t.name}</div>
          )) : ["Cold Email — Hiring Manager", "LinkedIn Connection Request", "Follow-up After Application", "Thank You — Post Interview"].map((t) => (
            <div key={t} className="w-full text-left rounded-lg bg-white/5 hover:bg-white/10 px-3 py-2 text-xs text-zinc-300 transition">{t}</div>
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
          <span className="text-xs text-zinc-400">{avgProgress}%</span>
        </div>
        <ProgressBar value={avgProgress} gradient="from-amber-500 to-orange-500" />
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div><div className="text-sm font-bold text-white">{displaySkills.length}</div><div className="text-[10px] text-zinc-400">Skills</div></div>
          <div><div className="text-sm font-bold text-white">{totalLessons}</div><div className="text-[10px] text-zinc-400">Lessons</div></div>
          <div><div className="text-sm font-bold text-white">{completedLessons}</div><div className="text-[10px] text-zinc-400">Completed</div></div>
        </div>
      </div>

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
  interface SourceHealth { ok: boolean; items: number; error?: string }

  const [games, setGames] = useState<Game[]>([]);
  const [watchlist, setWatchlist] = useState<WlTeam[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [odds, setOdds] = useState<OddsRow[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [addTeam, setAddTeam] = useState("");
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [sourceHealth, setSourceHealth] = useState<Record<string, SourceHealth>>({});

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

  useEffect(() => { loadGames(); loadWatchlist(); loadPredictions(); loadOdds(); loadNews(); }, [loadGames, loadWatchlist, loadPredictions, loadOdds, loadNews]);

  async function handleRefresh() {
    setRefreshing(true); setStatusMsg(null);
    try {
      const d = await apiPost<{ ok: boolean; games?: number; odds?: number; news?: number; predictions?: number; error?: string; source?: string; sourceHealth?: Record<string, SourceHealth> }>("/sports/refresh", { league });
      if (d.sourceHealth) setSourceHealth(d.sourceHealth);
      const parts: string[] = [];
      if (d.games) parts.push(`${d.games} games`);
      if (d.odds) parts.push(`${d.odds} odds`);
      if (d.news) parts.push(`${d.news} news`);
      if (d.predictions) parts.push(`${d.predictions} picks`);
      setStatusMsg(d.ok ? (parts.length > 0 ? parts.join(", ") : "No new data") : (d.error || "Failed"));
      setLastUpdated(new Date().toLocaleTimeString());
      loadGames(); loadOdds(); loadNews(); loadPredictions();
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
  const espnOk = sourceHealth.espn?.ok !== false;
  const oddsOk = sourceHealth["the-odds-api"]?.ok !== false;
  const newsOk = sourceHealth.rss?.ok !== false;
  const oddsUnavailable = sourceHealth["the-odds-api"]?.ok === false;

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
      {Object.keys(sourceHealth).length > 0 && (
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
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   STOCKS — Yahoo Finance style
   ═══════════════════════════════════════════════════════ */
function StocksWidgets(_props: { refresh: () => void }) {
  // API-backed state
  interface WlItem { ticker: string; display_name?: string }
  interface QuoteItem { ticker: string; price: number; change?: number; change_pct?: number; asof?: string; source?: string }
  interface IndexItem { symbol: string; value: number; change_pct?: number; asof?: string; source?: string }
  interface NewsItem { id: string; title: string; source: string; url: string; published_at?: string; sentiment?: string }
  interface InsightItem { id: string; title: string; bullets_json: string; sentiment?: string; ticker?: string; created_at: string }

  const [watchlist, setWatchlist] = useState<WlItem[]>([]);
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [indices, setIndices] = useState<IndexItem[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [insights, setInsights] = useState<InsightItem[]>([]);
  const [addTicker, setAddTicker] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try { const d = await apiGet<{ tickers: WlItem[] }>("/stocks/watchlist"); setWatchlist(d.tickers || []); } catch { /* */ }
    try { const d = await apiGet<{ quotes: QuoteItem[] }>("/stocks/quotes"); setQuotes(d.quotes || []); } catch { /* */ }
    try { const d = await apiGet<{ indices: IndexItem[] }>("/stocks/indices"); setIndices(d.indices || []); } catch { /* */ }
    try { const d = await apiGet<{ items: NewsItem[] }>("/stocks/news?limit=20"); setNews(d.items || []); } catch { /* */ }
    try { const d = await apiGet<{ insights: InsightItem[] }>("/stocks/insights?ticker=ALL&limit=5"); setInsights(d.insights || []); } catch { /* */ }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function handleAddTicker() {
    if (!addTicker.trim()) return;
    try { await apiPost("/stocks/watchlist", { ticker: addTicker.trim() }); setAddTicker(""); loadAll(); }
    catch { /* */ }
  }

  async function handleRefresh() {
    setRefreshing(true); setStatusMsg(null);
    try {
      const d = await apiPost<{ ok: boolean; tickers?: number; source?: string; error?: string }>("/stocks/refresh", {});
      setStatusMsg(d.ok ? `Refreshed ${d.tickers || 0} tickers (${d.source || "done"})` : (d.error || "Failed"));
      loadAll();
    } catch (e) { setStatusMsg(e instanceof Error ? e.message : "Failed"); }
    finally { setRefreshing(false); }
  }

  async function handleNewsScan() {
    setScanning(true);
    try {
      const d = await apiPost<{ ok: boolean; newItems?: number }>("/stocks/news", {});
      setStatusMsg(`News: ${d.newItems || 0} new items`);
      loadAll();
    } catch { /* */ }
    finally { setScanning(false); }
  }

  const quoteMap = Object.fromEntries(quotes.map((q) => [q.ticker, q]));

  const idxDisplay = (sym: string, label: string) => {
    const idx = indices.find((i) => i.symbol === sym);
    if (!idx || idx.source === "pending") return (
      <div className="glass-light rounded-xl p-3 text-center">
        <div className="text-[10px] text-zinc-400">{label}</div>
        <div className="text-[10px] text-zinc-600">Not configured</div>
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

  return (
    <div className="space-y-3">
      {/* Market overview */}
      <div className="grid grid-cols-3 gap-2">
        {idxDisplay("SPX", "S&P 500")}
        {idxDisplay("IXIC", "NASDAQ")}
        {idxDisplay("BTC", "BTC")}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={handleRefresh} disabled={refreshing}
          className="px-3 py-1.5 rounded-lg bg-lime-500/20 text-lime-400 text-xs font-medium hover:bg-lime-500/30 disabled:opacity-50 transition">
          {refreshing ? "Refreshing…" : "🔄 Refresh"}
        </button>
        <button onClick={handleNewsScan} disabled={scanning}
          className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 text-xs font-medium hover:bg-indigo-500/30 disabled:opacity-50 transition">
          {scanning ? "Scanning…" : "📰 Scan News"}
        </button>
        {statusMsg && <span className="text-[10px] text-zinc-400">{statusMsg}</span>}
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
            const hasData = q && q.source !== "pending";
            const isUp = hasData && (q.change_pct || 0) >= 0;
            return (
              <div key={w.ticker} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2.5 hover:bg-white/10 transition">
                <div>
                  <div className="text-xs font-semibold text-white">{w.ticker}</div>
                  <div className="text-[10px] text-zinc-500">{w.display_name || ""}</div>
                </div>
                {hasData ? (
                  <div className="text-right">
                    <div className="text-xs font-semibold text-white">${q.price.toFixed(2)}</div>
                    <div className={cx("text-[10px] font-medium", isUp ? "text-emerald-400" : "text-rose-400")}>
                      {isUp ? "▲" : "▼"} {Math.abs(q.change_pct || 0).toFixed(2)}%
                    </div>
                  </div>
                ) : (
                  <div className="text-[10px] text-zinc-600">Pending</div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Market News */}
      <Card title="Market News" icon="📰">
        <div className="space-y-2 max-h-64 overflow-auto">
          {news.length === 0 && <div className="text-[10px] text-zinc-500">Click Scan News to fetch market headlines.</div>}
          {news.map((n) => (
            <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer"
              className="block rounded-xl bg-white/5 px-3 py-2 hover:bg-white/10 transition">
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs text-white hover:underline">{n.title} ↗</div>
                {n.sentiment && (
                  <Badge color={n.sentiment === "bullish" ? "emerald" : n.sentiment === "bearish" ? "rose" : "zinc"}>
                    {n.sentiment}
                  </Badge>
                )}
              </div>
              <div className="text-[10px] text-zinc-500 mt-0.5">{n.source} · {n.published_at ? new Date(n.published_at).toLocaleDateString() : ""}</div>
            </a>
          ))}
        </div>
      </Card>

      {/* AI Insights */}
      <Card title="AI Analysis" icon="🤖">
        {insights.length === 0 ? (
          <div className="text-[10px] text-zinc-400">No insights yet. Generate a briefing or ask your stocks agent.</div>
        ) : (
          <div className="space-y-2">
            {insights.map((ins) => {
              let bullets: string[] = [];
              try { bullets = JSON.parse(ins.bullets_json); } catch { /* */ }
              return (
                <div key={ins.id} className="rounded-xl bg-white/5 p-3">
                  <div className="text-xs font-semibold text-white">{ins.title}</div>
                  {bullets.map((b, i) => <div key={i} className="text-[10px] text-zinc-400 mt-0.5">• {b}</div>)}
                  <div className="text-[9px] text-zinc-600 mt-1">{new Date(ins.created_at).toLocaleString()}</div>
                </div>
              );
            })}
          </div>
        )}
        <button onClick={() => apiPost("/stocks/insights/generate", {}).catch(() => {})}
          className="mt-2 px-3 py-1.5 rounded-lg bg-lime-500/20 text-lime-400 text-xs font-medium hover:bg-lime-500/30 transition">
          Generate Briefing →
        </button>
      </Card>
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

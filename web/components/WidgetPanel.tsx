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
import { apiGet, apiPost, apiPatch } from "@/lib/api";

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

/* ═══════════════════════════════════════════════════════
   MAIN WIDGET PANEL
   ═══════════════════════════════════════════════════════ */

export default function WidgetPanel({ activeTab }: { activeTab: TabKey }) {
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
    case "skills": return <SkillsWidgets skills={skills} refresh={refresh} />;
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
function HomeWidgets({ assignments, skills, jobs, research, refresh }: {
  assignments: Assignment[]; skills: Skill[]; jobs: JobPosting[]; research: ResearchArticle[]; refresh: () => void;
}) {
  const [pomodoroSec, setPomodoroSec] = useState(25 * 60);
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [pomodoroMode, setPomodoroMode] = useState<"work" | "break">("work");
  const [quickTask, setQuickTask] = useState("");

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

  const timerMin = String(Math.floor(pomodoroSec / 60)).padStart(2, "0");
  const timerSec = String(pomodoroSec % 60).padStart(2, "0");

  const overdue = assignments.filter((a) => !a.completed && a.dueDate && new Date(a.dueDate) < new Date()).length;
  const avgProgress = skills.length ? Math.round(skills.reduce((s, sk) => s + sk.progress, 0) / skills.length) : 0;
  const unread = research.filter((r) => !r.read).length;

  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="space-y-3">
      {/* Welcome */}
      <div className="glass-light rounded-2xl p-5 animate-fade-in">
        <div className="text-lg font-bold text-white">{greeting} 👋</div>
        <div className="text-xs text-zinc-400 mt-1">{dateStr}</div>
        <div className="mt-3 text-sm text-zinc-300">Your AI command center is ready. {overdue > 0 && <span className="text-rose-400">{overdue} overdue assignment{overdue > 1 ? "s" : ""}!</span>}</div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2">
        <StatBox icon="📝" value={assignments.filter((a) => !a.completed).length} label="Due" />
        <StatBox icon="🧠" value={`${avgProgress}%`} label="Skills" />
        <StatBox icon="💼" value={jobs.length} label="Jobs" />
        <StatBox icon="📰" value={unread} label="Unread" />
      </div>

      {/* Pomodoro Timer */}
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

      {/* Quick Actions */}
      <Card title="Quick Actions" icon="🚀">
        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: "📝", label: "New Note" },
            { icon: "📅", label: "Add Due Date" },
            { icon: "🔍", label: "Search All" },
            { icon: "📊", label: "View Progress" },
          ].map((a) => (
            <button key={a.label} className="text-left rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 px-3 py-2.5 text-xs transition">
              <span className="mr-2">{a.icon}</span>{a.label}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SCHOOL — Notion + Blackboard + Email
   ═══════════════════════════════════════════════════════ */
function SchoolWidgets({ assignments, notes, refresh }: {
  assignments: Assignment[]; notes: Note[]; refresh: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCourse, setNewCourse] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newPriority, setNewPriority] = useState<"low" | "medium" | "high">("medium");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");

  const schoolNotes = notes.filter((n) => n.tab === "school");
  const pending = assignments.filter((a) => !a.completed);
  const completed = assignments.filter((a) => a.completed);

  function handleAddAssignment() {
    if (!newTitle.trim()) return;
    saveAssignment({ title: newTitle.trim(), course: newCourse.trim(), dueDate: newDate, priority: newPriority });
    setNewTitle(""); setNewCourse(""); setNewDate(""); setNewPriority("medium"); setShowAdd(false);
    refresh();
  }

  function handleAddNote() {
    if (!noteTitle.trim()) return;
    saveNote({ tab: "school", title: noteTitle.trim(), content: noteContent });
    setNoteTitle(""); setNoteContent("");
    refresh();
  }

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatBox icon="📋" value={pending.length} label="Pending" />
        <StatBox icon="✅" value={completed.length} label="Done" />
        <StatBox icon="📝" value={schoolNotes.length} label="Notes" />
      </div>

      {/* Blackboard & Email */}
      <div className="grid grid-cols-2 gap-2">
        <div className="glass-light rounded-xl p-3 animate-fade-in">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm">🎓</span>
            <span className="text-xs font-semibold text-zinc-100">Blackboard</span>
          </div>
          <div className="text-[10px] text-zinc-400">Ask agent to sync your course schedule and due dates from Blackboard.</div>
          <AgentStatus verb="ready to sync" />
        </div>
        <div className="glass-light rounded-xl p-3 animate-fade-in">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm">📧</span>
            <span className="text-xs font-semibold text-zinc-100">Email</span>
          </div>
          <div className="text-[10px] text-zinc-400">Connect email for assignment reminders and school notifications.</div>
          <AgentStatus verb="monitoring inbox" />
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
              <input className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none" placeholder="Course" value={newCourse} onChange={(e) => setNewCourse(e.target.value)} />
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
          {pending.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 group hover:bg-white/10 transition">
              <button onClick={() => { toggleAssignment(a.id); refresh(); }} className="w-4 h-4 rounded border border-white/20 shrink-0 hover:border-violet-400 transition flex items-center justify-center text-[10px]">
                {a.completed && "✓"}
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-white truncate">{a.title}</div>
                <div className="text-[10px] text-zinc-500">{a.course}{a.course && a.dueDate && " · "}{a.dueDate && relDate(a.dueDate)}</div>
              </div>
              <Badge color={a.priority === "high" ? "rose" : a.priority === "medium" ? "amber" : "emerald"}>{a.priority}</Badge>
              <button onClick={() => { deleteAssignment(a.id); refresh(); }} className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 text-xs transition">✕</button>
            </div>
          ))}
        </div>
        {completed.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/5">
            <div className="text-[10px] text-zinc-500 mb-1.5">Completed ({completed.length})</div>
            {completed.slice(0, 3).map((a) => (
              <div key={a.id} className="flex items-center gap-2 px-3 py-1 text-xs text-zinc-500 line-through">
                <span>✓</span><span className="truncate">{a.title}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Quick Notes */}
      <Card title="Study Notes" icon="📝" actions={<Badge color="violet">{schoolNotes.length}</Badge>}>
        <div className="space-y-2 mb-3">
          <input className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none" placeholder="Note title" value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} />
          <textarea className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none resize-none h-16" placeholder="Content (supports markdown)" value={noteContent} onChange={(e) => setNoteContent(e.target.value)} />
          <button onClick={handleAddNote} disabled={!noteTitle.trim()} className="px-3 py-1.5 rounded-lg bg-violet-500/20 text-violet-400 text-xs font-medium hover:bg-violet-500/30 disabled:opacity-30 transition">Save Note</button>
        </div>
        <div className="space-y-1.5 max-h-40 overflow-auto">
          {schoolNotes.map((n) => (
            <div key={n.id} className="flex items-start gap-2 rounded-xl bg-white/5 px-3 py-2 group hover:bg-white/10 transition">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-white">{n.title}</div>
                <div className="text-[10px] text-zinc-400 truncate">{n.content || "Empty note"}</div>
              </div>
              <button onClick={() => { deleteNote(n.id); refresh(); }} className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 text-xs transition shrink-0">✕</button>
            </div>
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

  // API-backed data
  interface ApiJob {
    id: string; title: string; company: string; location?: string;
    url: string; status: string; posted_at?: string; fetched_at: string;
    remote?: number; tags_json?: string; notes?: string;
  }
  const [apiJobs, setApiJobs] = useState<ApiJob[]>([]);
  const [pipeline, setPipeline] = useState<Record<string, number>>({});
  interface ApiCompany { id: string; name: string; website_url?: string; linkedin_url?: string; notes?: string }
  const [companies, setCompanies] = useState<ApiCompany[]>([]);
  const [hasApi, setHasApi] = useState(false);

  const loadJobs = useCallback(async (status: string) => {
    try {
      const data = await apiGet<{ items: ApiJob[] }>(`/jobs/feed?status=${status}&limit=50`);
      if (data.items) { setApiJobs(data.items); setHasApi(true); }
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

  useEffect(() => { loadJobs(statusFilter); loadPipeline(); loadCompanies(); }, [statusFilter, loadJobs, loadPipeline, loadCompanies]);

  async function handleRefresh() {
    setRefreshing(true); setRefreshResult(null);
    try {
      const data = await apiPost<{ ok: boolean; newJobs?: number; error?: string }>("/jobs/refresh", {});
      setRefreshResult(data.ok ? `Found ${data.newJobs || 0} new jobs` : (data.error || "Failed"));
      loadJobs(statusFilter); loadPipeline();
    } catch (e) { setRefreshResult(e instanceof Error ? e.message : "Failed"); }
    finally { setRefreshing(false); }
  }

  async function handleStatusChange(jobId: string, newStatus: string) {
    try { await apiPatch(`/jobs/${jobId}`, { status: newStatus }); loadJobs(statusFilter); loadPipeline(); }
    catch { /* fallback */ toggleJobApplied(jobId); refresh(); }
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

  const pSaved = pipeline.saved || pipeline.new || 0;
  const pNew = pipeline.new || 0;
  const pApplied = pipeline.applied || 0;
  const pInterview = pipeline.interview || 0;
  const pOffer = pipeline.offer || 0;

  const statuses = ["all", "new", "saved", "applied", "interview", "offer", "rejected", "dismissed"];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <StatBox icon="💼" value={displayJobs.length} label="Total" />
        <StatBox icon="✅" value={pApplied} label="Applied" />
        <StatBox icon="🆕" value={pNew + pSaved} label="New/Saved" />
      </div>

      <div className="flex items-center gap-2">
        <button onClick={handleRefresh} disabled={refreshing}
          className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 disabled:opacity-50 transition">
          {refreshing ? "Refreshing…" : "🔄 Refresh Feed"}
        </button>
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
            return (
            <div key={j.id} className="rounded-xl bg-white/5 p-3 hover:bg-white/10 transition group">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center text-sm font-bold text-white shrink-0">
                  {j.company.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <a href={j.url || "#"} target="_blank" rel="noopener noreferrer"
                    className="text-xs font-semibold text-white hover:underline">
                    {j.title} {j.url ? "↗" : ""}
                  </a>
                  <div className="text-[10px] text-zinc-400">{j.company} · {j.location || "Remote"}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Badge color={j.status === "applied" ? "cyan" : j.status === "interview" ? "violet" : "emerald"}>{j.status}</Badge>
                    {jobTags.map((t: string) => <Badge key={t} color="zinc">{t}</Badge>)}
                  </div>
                  {/* LinkedIn links */}
                  <div className="flex gap-2 mt-1.5 opacity-0 group-hover:opacity-100 transition">
                    <a href={`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(j.title + " " + j.company)}`}
                      target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-400 hover:underline">🔗 LinkedIn Jobs</a>
                    <a href={`https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(j.company)}`}
                      target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-400 hover:underline">🏢 Company</a>
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

      {/* Companies Watchlist */}
      <Card title="Companies to Watch" icon="🏢">
        <div className="space-y-1.5 max-h-40 overflow-auto">
          {companies.length === 0 && <div className="text-[10px] text-zinc-500">No companies yet. Add from job details.</div>}
          {companies.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
              <span className="text-xs text-white flex-1">{c.name}</span>
              {c.website_url && <a href={c.website_url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-zinc-400 hover:text-white">🌐</a>}
              <a href={c.linkedin_url || `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(c.name)}`}
                target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-400 hover:underline">LinkedIn</a>
            </div>
          ))}
        </div>
      </Card>

      {/* Outreach */}
      <Card title="Outreach Templates" icon="📨">
        <div className="space-y-1.5">
          {["Cold Email — Hiring Manager", "LinkedIn Connection Request", "Follow-up After Application", "Thank You — Post Interview"].map((t) => (
            <button key={t} className="w-full text-left rounded-lg bg-white/5 hover:bg-white/10 px-3 py-2 text-xs text-zinc-300 transition">{t}</button>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SKILLS — Udemy + Coursera style
   ═══════════════════════════════════════════════════════ */
function SkillsWidgets({ skills, refresh }: { skills: Skill[]; refresh: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const avgProgress = skills.length ? Math.round(skills.reduce((s, sk) => s + sk.progress, 0) / skills.length) : 0;

  // "Continue where you left off" — find last skill with partial progress
  const continueSkill = skills.find((s) => s.progress > 0 && s.progress < 100) || skills[0];
  const nextLesson = continueSkill?.lessons.find((l) => !l.completed);

  const gradientMap: Record<string, string> = {
    Certification: "from-violet-500 to-purple-500",
    Tool: "from-cyan-500 to-blue-500",
    Skill: "from-rose-500 to-red-500",
    Programming: "from-amber-500 to-orange-500",
    Cloud: "from-emerald-500 to-green-500",
  };

  const badgeColorMap: Record<string, string> = {
    Certification: "violet",
    Tool: "cyan",
    Skill: "rose",
    Programming: "amber",
    Cloud: "emerald",
  };

  return (
    <div className="space-y-3">
      {/* Overall progress */}
      <div className="glass-light rounded-2xl p-4 animate-fade-in">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-zinc-100">Overall Progress</span>
          <span className="text-xs text-zinc-400">{avgProgress}%</span>
        </div>
        <ProgressBar value={avgProgress} gradient="from-amber-500 to-orange-500" />
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div><div className="text-sm font-bold text-white">{skills.length}</div><div className="text-[10px] text-zinc-400">Skills</div></div>
          <div><div className="text-sm font-bold text-white">{skills.reduce((s, sk) => s + sk.lessons.length, 0)}</div><div className="text-[10px] text-zinc-400">Lessons</div></div>
          <div><div className="text-sm font-bold text-white">{skills.reduce((s, sk) => s + sk.lessons.filter((l) => l.completed).length, 0)}</div><div className="text-[10px] text-zinc-400">Completed</div></div>
        </div>
      </div>

      {/* Continue where you left off */}
      {nextLesson && continueSkill && (
        <div className="glass-light rounded-2xl p-4 animate-fade-in border border-amber-500/20 glow-amber">
          <div className="text-[10px] text-amber-400 font-semibold mb-1">▶ CONTINUE WHERE YOU LEFT OFF</div>
          <div className="text-sm font-semibold text-white">{continueSkill.name}</div>
          <div className="text-xs text-zinc-400 mt-0.5">Next: {nextLesson.title}</div>
          <div className="text-[10px] text-zinc-500 mt-1">{nextLesson.description}</div>
          <button onClick={() => setExpanded(continueSkill.id)} className="mt-2 px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 text-xs font-medium hover:bg-amber-500/30 transition">
            Continue →
          </button>
        </div>
      )}

      {/* Skill cards with expandable lessons */}
      {skills.map((skill) => (
        <div key={skill.id} className="glass-light rounded-2xl overflow-hidden animate-fade-in">
          <button
            onClick={() => setExpanded(expanded === skill.id ? null : skill.id)}
            className="w-full text-left p-4 hover:bg-white/5 transition"
          >
            <div className="flex items-center gap-3">
              <div className={cx("w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-sm font-bold text-white shrink-0", gradientMap[skill.category] || "from-zinc-500 to-zinc-600")}>
                {skill.progress}%
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white truncate">{skill.name}</span>
                  <Badge color={badgeColorMap[skill.category] || "zinc"}>{skill.category}</Badge>
                </div>
                <div className="mt-1.5">
                  <ProgressBar value={skill.progress} gradient={gradientMap[skill.category] || "from-zinc-500 to-zinc-400"} />
                </div>
                <div className="text-[10px] text-zinc-500 mt-1">
                  {skill.lessons.filter((l) => l.completed).length}/{skill.lessons.length} lessons
                </div>
              </div>
              <span className={cx("text-zinc-500 transition-transform", expanded === skill.id && "rotate-90")}>›</span>
            </div>
          </button>

          {/* Expanded lesson list */}
          {expanded === skill.id && (
            <div className="px-4 pb-4 space-y-1.5 animate-fade-in border-t border-white/5 pt-3">
              {skill.lessons.map((lesson, li) => (
                <div key={lesson.id} className="flex items-start gap-2.5 rounded-xl bg-white/5 p-3 hover:bg-white/10 transition">
                  <button
                    onClick={() => { toggleLesson(skill.id, lesson.id); refresh(); }}
                    className={cx(
                      "w-5 h-5 rounded-md border shrink-0 flex items-center justify-center text-[10px] transition mt-0.5",
                      lesson.completed ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400" : "border-white/20 hover:border-amber-400"
                    )}
                  >
                    {lesson.completed && "✓"}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className={cx("text-xs font-medium", lesson.completed ? "text-zinc-500 line-through" : "text-white")}>
                      <span className="text-zinc-500 mr-1.5">{li + 1}.</span>{lesson.title}
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">{lesson.description}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SPORTS — ESPN style
   ═══════════════════════════════════════════════════════ */
function SportsWidgets(_: { refresh: () => void }) {
  const [league, setLeague] = useState("NBA");
  const leagues = ["NBA", "NFL", "MLB", "NHL", "Soccer"];

  // Demo scores (agent would fill these in)
  const demoScores = [
    { home: "Lakers", away: "Celtics", homeScore: 112, awayScore: 108, status: "Final", league: "NBA" },
    { home: "Warriors", away: "Nets", homeScore: 98, awayScore: 102, status: "Final", league: "NBA" },
    { home: "Heat", away: "Bucks", homeScore: 0, awayScore: 0, status: "7:30 PM", league: "NBA" },
    { home: "Chiefs", away: "Eagles", homeScore: 24, awayScore: 21, status: "Final", league: "NFL" },
    { home: "Yankees", away: "Red Sox", homeScore: 5, awayScore: 3, status: "Final", league: "MLB" },
  ];
  const scores = demoScores.filter((s) => s.league === league);

  return (
    <div className="space-y-3">
      {/* League tabs */}
      <div className="flex gap-1 overflow-auto pb-1">
        {leagues.map((l) => (
          <button key={l} onClick={() => setLeague(l)} className={cx(
            "px-3 py-1.5 rounded-lg text-xs font-medium border transition whitespace-nowrap",
            league === l ? "bg-rose-500/20 text-rose-400 border-rose-500/30" : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10"
          )}>{l}</button>
        ))}
      </div>

      <AgentStatus verb="fetching live scores" />

      {/* Scores */}
      <Card title="Scores" icon="🏆">
        {scores.length === 0 ? <EmptyState icon="🏟️" text={`No ${league} scores. Ask agent to fetch.`} /> : (
          <div className="space-y-2">
            {scores.map((s, i) => (
              <div key={i} className="rounded-xl bg-white/5 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs">
                    <div className={cx("font-semibold", s.homeScore > s.awayScore ? "text-white" : "text-zinc-400")}>{s.home} <span className="font-bold">{s.homeScore}</span></div>
                    <div className={cx("font-semibold mt-0.5", s.awayScore > s.homeScore ? "text-white" : "text-zinc-400")}>{s.away} <span className="font-bold">{s.awayScore}</span></div>
                  </div>
                  <Badge color={s.status === "Final" ? "zinc" : "emerald"}>{s.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Projections */}
      <Card title="Projections & Odds" icon="📊">
        <div className="space-y-2">
          {[
            { matchup: "Heat vs Bucks", spread: "MIL -4.5", over: "O 218.5" },
            { matchup: "Suns vs Mavs", spread: "DAL -2", over: "O 224" },
          ].map((p, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
              <span className="text-xs text-white">{p.matchup}</span>
              <div className="flex gap-2">
                <Badge color="rose">{p.spread}</Badge>
                <Badge color="amber">{p.over}</Badge>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 text-[10px] text-zinc-500">Ask your sports agent for detailed analysis and updated lines.</div>
      </Card>

      {/* Watchlist */}
      <Card title="My Watchlist" icon="⭐">
        <div className="space-y-1.5">
          {["Lakers", "Chiefs", "Yankees", "Barcelona"].map((team) => (
            <div key={team} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 hover:bg-white/10 transition">
              <span className="text-xs text-white">{team}</span>
              <span className="text-[10px] text-zinc-500">Tracking</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Stats */}
      <Card title="Player Stats" icon="📈">
        <div className="text-[10px] text-zinc-400">Ask your sports agent to pull detailed player statistics, season averages, and rankings.</div>
        <button className="mt-2 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-400 text-xs font-medium hover:bg-rose-500/30 transition">
          Ask Agent →
        </button>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   STOCKS — Yahoo Finance style
   ═══════════════════════════════════════════════════════ */
function StocksWidgets(_: { refresh: () => void }) {
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
  const [filter, setFilter] = useState<"all" | "unread" | "saved">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [noteText, setNoteText] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

  // API-backed items
  interface ApiItem {
    id: string; title: string; url: string; source_name?: string;
    published_at?: string; fetched_at: string; summary?: string;
    tags_json?: string; is_read: number; is_saved: number;
  }
  const [apiItems, setApiItems] = useState<ApiItem[]>([]);
  const [hasApi, setHasApi] = useState(false);

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

  useEffect(() => { loadFeed(filter); }, [filter, loadFeed]);

  async function handleScan() {
    setScanning(true);
    setScanResult(null);
    try {
      const data = await apiPost<{ ok: boolean; newItems?: number; sources?: number; tookMs?: number; error?: string }>("/research/scan", {});
      if (data.ok) {
        setScanResult(`Found ${data.newItems || 0} new items from ${data.sources || 0} sources (${data.tookMs || 0}ms)`);
        loadFeed(filter);
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
      // fallback to local
      toggleArticleRead(itemId);
      refresh();
    }
  }

  async function handleSaveItem(itemId: string, isSaved: boolean) {
    try {
      await apiPost(`/research/item/${itemId}/save`, { isSaved });
      loadFeed(filter);
    } catch {
      // non-fatal
    }
  }

  // Merged display: prefer API items, fall back to localStorage
  const displayItems = hasApi ? apiItems.map((a) => ({
    id: a.id,
    title: a.title,
    url: a.url,
    source: a.source_name || "",
    category: "tech" as const,
    read: a.is_read === 1,
    saved: a.is_saved === 1,
    notes: "",
    summary: a.summary || "",
    tags: a.tags_json ? JSON.parse(a.tags_json) : [],
    publishedAt: a.published_at || a.fetched_at,
  })) : localResearch.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url || "#",
    source: r.source,
    category: r.category,
    read: r.read,
    saved: false,
    notes: r.notes,
    summary: "",
    tags: [] as string[],
    publishedAt: "",
  }));

  const unread = displayItems.filter((r) => !r.read).length;
  const readCount = displayItems.filter((r) => r.read).length;

  return (
    <div className="space-y-3">
      {/* Stats + Scan */}
      <div className="grid grid-cols-3 gap-2">
        <StatBox icon="📰" value={displayItems.length} label="Articles" />
        <StatBox icon="📖" value={readCount} label="Read" />
        <StatBox icon="🆕" value={unread} label="Unread" />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleScan}
          disabled={scanning}
          className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 text-xs font-medium hover:bg-indigo-500/30 disabled:opacity-50 transition"
        >
          {scanning ? "Scanning…" : "🔍 Scan Now"}
        </button>
        {scanResult && <span className="text-[10px] text-zinc-400">{scanResult}</span>}
      </div>

      <AgentStatus verb="researching latest cybersecurity news" />

      {/* Filter tabs: All / Unread / Saved */}
      <div className="flex gap-1 overflow-auto pb-1">
        {(["all", "unread", "saved"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cx(
            "px-3 py-1.5 rounded-lg text-xs font-medium border transition whitespace-nowrap capitalize",
            filter === f ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10"
          )}>{f === "all" ? "📋 All" : f === "unread" ? "🆕 Unread" : "💾 Saved"}</button>
        ))}
      </div>

      {/* Articles */}
      <div className="space-y-2 max-h-[60vh] overflow-auto">
        {displayItems.length === 0 && (
          <div className="text-center py-6 text-xs text-zinc-500">
            {hasApi ? "No articles. Click Scan Now to fetch feeds." : "No articles in local store."}
          </div>
        )}
        {displayItems.map((article) => (
          <div key={article.id} className="glass-light rounded-2xl overflow-hidden animate-fade-in">
            <button
              onClick={() => setExpanded(expanded === article.id ? null : article.id)}
              className="w-full text-left p-4 hover:bg-white/5 transition"
            >
              <div className="flex items-start gap-3">
                <div className={cx(
                  "w-2 h-2 rounded-full mt-1.5 shrink-0",
                  article.read ? "bg-zinc-600" : "bg-indigo-500"
                )} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {article.tags.slice(0, 2).map((t: string) => (
                      <Badge key={t} color="indigo">{t}</Badge>
                    ))}
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
              <div className="px-4 pb-4 space-y-3 animate-fade-in border-t border-white/5 pt-3">
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
                  <a href={article.url} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 rounded-lg bg-white/5 text-zinc-400 text-xs hover:bg-white/10 transition">
                    Open Source ↗
                  </a>
                </div>

                {!hasApi && (
                  <div>
                    <div className="text-[10px] text-zinc-400 mb-1.5 font-medium">Your Notes</div>
                    <textarea
                      className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none resize-none h-20"
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
        ))}
      </div>

      {/* Reading Progress */}
      <Card title="Reading Progress" icon="📊">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-zinc-400">{readCount} of {displayItems.length} articles</span>
          <span className="text-xs font-semibold text-white">{displayItems.length > 0 ? Math.round((readCount / displayItems.length) * 100) : 0}%</span>
        </div>
        <ProgressBar value={displayItems.length > 0 ? (readCount / displayItems.length) * 100 : 0} gradient="from-indigo-500 to-violet-500" />
      </Card>
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
function SettingsWidgets() {
  const [serviceStatus, setServiceStatus] = useState<{
    endpoints?: { name: string; status: string; latencyMs: number | null }[];
    portReference?: { port: number; protocol: string; service: string; description: string; required: boolean }[];
    cleanupCommands?: { label: string; command: string }[];
  } | null>(null);
  const [serviceLoading, setServiceLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

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

  return (
    <div className="space-y-3">
      {/* ── VPS Services & Port Monitor ── */}
      <Card title="VPS Services" icon="🔌" actions={
        <button onClick={checkServices} disabled={serviceLoading}
          className="text-[10px] px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 transition disabled:opacity-50">
          {serviceLoading ? "Checking…" : "Check Status"}
        </button>
      }>
        {!serviceStatus ? (
          <div className="text-xs text-zinc-500 py-2">Click <strong>Check Status</strong> to probe VPS endpoints.</div>
        ) : (
          <div className="space-y-3">
            {/* Endpoint connectivity */}
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

            {/* Port reference table */}
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

            {/* Cleanup commands */}
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
            <Badge color="cyan">localStorage (MVP)</Badge>
          </div>
        </div>
      </Card>

      <Card title="Data Connectors" icon="🔗">
        <div className="space-y-2">
          {[
            { name: "RSS Feeds", type: "rss", status: "Ready" },
            { name: "Email (IMAP)", type: "email", status: "Not configured" },
            { name: "Calendar (ICS)", type: "calendar", status: "Not configured" },
            { name: "OpenClaw VPS", type: "api", status: "Pending tunnel" },
          ].map((c) => (
            <div key={c.name} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2.5">
              <span className="text-xs text-white">{c.name}</span>
              <Badge color={c.status === "Ready" ? "emerald" : "zinc"}>{c.status}</Badge>
            </div>
          ))}
        </div>
        <div className="mt-2 text-[10px] text-zinc-500">Configure connectors in your environment variables or Cloudflare D1.</div>
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
          <div><strong className="text-zinc-300">My Control Center</strong> v0.1.0</div>
          <div>Next.js 16 · Tailwind 4 · Cloudflare Pages</div>
          <div>Open-source personal dashboard</div>
        </div>
      </Card>
    </div>
  );
}

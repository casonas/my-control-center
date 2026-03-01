"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { TabKey, Note, Assignment, Skill, JobPosting, ResearchArticle } from "@/lib/types";
import {
  getNotes, saveNote, deleteNote,
  getAssignments, saveAssignment, deleteAssignment, toggleAssignment,
  getSkills, toggleLesson,
  getJobs, saveJob, toggleJobApplied,
  getWatchlist,
  getResearch, toggleArticleRead, saveArticleNotes,
} from "@/lib/store";

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
function JobsWidgets({ jobs, refresh }: { jobs: JobPosting[]; refresh: () => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [tags, setTags] = useState("");

  const applied = jobs.filter((j) => j.applied).length;
  const saved = jobs.filter((j) => !j.applied).length;

  function handleAdd() {
    if (!title.trim()) return;
    saveJob({ title: title.trim(), company: company.trim(), location: location.trim(), tags: tags.split(",").map((t: string) => t.trim()).filter(Boolean) });
    setTitle(""); setCompany(""); setLocation(""); setTags(""); setShowAdd(false);
    refresh();
  }

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatBox icon="💼" value={jobs.length} label="Total" />
        <StatBox icon="✅" value={applied} label="Applied" />
        <StatBox icon="📌" value={saved} label="Saved" />
      </div>

      <AgentStatus verb="scanning for new cybersecurity postings" />

      {/* Application pipeline */}
      <Card title="Pipeline" icon="📊">
        <div className="flex gap-1">
          <div className="flex-1 text-center rounded-lg bg-emerald-500/10 py-2">
            <div className="text-sm font-bold text-emerald-400">{saved}</div>
            <div className="text-[10px] text-zinc-400">Saved</div>
          </div>
          <div className="text-zinc-600 self-center">→</div>
          <div className="flex-1 text-center rounded-lg bg-cyan-500/10 py-2">
            <div className="text-sm font-bold text-cyan-400">{applied}</div>
            <div className="text-[10px] text-zinc-400">Applied</div>
          </div>
          <div className="text-zinc-600 self-center">→</div>
          <div className="flex-1 text-center rounded-lg bg-violet-500/10 py-2">
            <div className="text-sm font-bold text-violet-400">0</div>
            <div className="text-[10px] text-zinc-400">Interview</div>
          </div>
          <div className="text-zinc-600 self-center">→</div>
          <div className="flex-1 text-center rounded-lg bg-amber-500/10 py-2">
            <div className="text-sm font-bold text-amber-400">0</div>
            <div className="text-[10px] text-zinc-400">Offer</div>
          </div>
        </div>
      </Card>

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
          {jobs.map((j) => (
            <div key={j.id} className="rounded-xl bg-white/5 p-3 hover:bg-white/10 transition group">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center text-sm font-bold text-white shrink-0">
                  {j.company.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-white">{j.title}</div>
                  <div className="text-[10px] text-zinc-400">{j.company} · {j.location}</div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {j.tags.map((t) => <Badge key={t} color="emerald">{t}</Badge>)}
                  </div>
                </div>
                <button
                  onClick={() => { toggleJobApplied(j.id); refresh(); }}
                  className={cx("shrink-0 px-2 py-1 rounded-lg text-[10px] font-medium border transition",
                    j.applied ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-white/5 text-zinc-400 border-white/10 hover:border-emerald-500/30"
                  )}
                >
                  {j.applied ? "✓ Applied" : "Apply"}
                </button>
              </div>
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
function SportsWidgets({ refresh: _refresh }: { refresh: () => void }) {
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
function StocksWidgets({ refresh: _refresh }: { refresh: () => void }) {
  const watchlist = getWatchlist("stock");

  // Simulated data (agent would provide real data)
  const simPrices: Record<string, { price: number; change: number }> = {
    AAPL: { price: 189.43, change: 1.24 },
    MSFT: { price: 417.88, change: -0.52 },
    CRWD: { price: 342.15, change: 3.87 },
    PANW: { price: 298.62, change: 2.11 },
    NET: { price: 98.77, change: -1.03 },
  };

  return (
    <div className="space-y-3">
      {/* Market overview */}
      <div className="grid grid-cols-3 gap-2">
        <div className="glass-light rounded-xl p-3 text-center">
          <div className="text-[10px] text-zinc-400">S&P 500</div>
          <div className="text-sm font-bold text-emerald-400">+0.42%</div>
        </div>
        <div className="glass-light rounded-xl p-3 text-center">
          <div className="text-[10px] text-zinc-400">NASDAQ</div>
          <div className="text-sm font-bold text-emerald-400">+0.78%</div>
        </div>
        <div className="glass-light rounded-xl p-3 text-center">
          <div className="text-[10px] text-zinc-400">BTC</div>
          <div className="text-sm font-bold text-rose-400">-1.23%</div>
        </div>
      </div>

      <AgentStatus verb="monitoring market movements" />

      {/* Watchlist */}
      <Card title="Watchlist" icon="📊">
        <div className="space-y-1.5">
          {watchlist.map((w) => {
            const data = simPrices[w.symbol];
            const isUp = data && data.change > 0;
            return (
              <div key={w.id} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2.5 hover:bg-white/10 transition">
                <div>
                  <div className="text-xs font-semibold text-white">{w.symbol}</div>
                  <div className="text-[10px] text-zinc-500">{w.name}</div>
                </div>
                {data && (
                  <div className="text-right">
                    <div className="text-xs font-semibold text-white">${data.price.toFixed(2)}</div>
                    <div className={cx("text-[10px] font-medium", isUp ? "text-emerald-400" : "text-rose-400")}>
                      {isUp ? "▲" : "▼"} {Math.abs(data.change).toFixed(2)}%
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Market News */}
      <Card title="Market News" icon="📰">
        <div className="space-y-2">
          {[
            { title: "CrowdStrike Reports Record Q4 Earnings", time: "2h ago", sentiment: "bullish" },
            { title: "Fed Signals Steady Rates Through Q2", time: "4h ago", sentiment: "neutral" },
            { title: "Cloudflare Expands AI Infrastructure", time: "6h ago", sentiment: "bullish" },
            { title: "Tech Sector Leads S&P 500 Rally", time: "8h ago", sentiment: "bullish" },
          ].map((n, i) => (
            <div key={i} className="rounded-xl bg-white/5 px-3 py-2 hover:bg-white/10 transition cursor-pointer">
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs text-white">{n.title}</div>
                <Badge color={n.sentiment === "bullish" ? "emerald" : n.sentiment === "bearish" ? "rose" : "zinc"}>
                  {n.sentiment}
                </Badge>
              </div>
              <div className="text-[10px] text-zinc-500 mt-0.5">{n.time}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Analysis */}
      <Card title="AI Analysis" icon="🤖">
        <div className="text-[10px] text-zinc-400">Ask your stocks agent for real-time analysis, technical indicators, and portfolio recommendations.</div>
        <button className="mt-2 px-3 py-1.5 rounded-lg bg-lime-500/20 text-lime-400 text-xs font-medium hover:bg-lime-500/30 transition">
          Analyze Portfolio →
        </button>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   RESEARCH — News + Deep Dive courses
   ═══════════════════════════════════════════════════════ */
function ResearchWidgets({ research, refresh }: { research: ResearchArticle[]; refresh: () => void }) {
  const [filter, setFilter] = useState<"all" | "world" | "tech" | "cyber" | "deep">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [noteText, setNoteText] = useState<Record<string, string>>({});

  const categories = [
    { key: "all" as const, label: "All", icon: "📋" },
    { key: "world" as const, label: "World", icon: "🌍" },
    { key: "tech" as const, label: "Tech", icon: "💻" },
    { key: "cyber" as const, label: "Cyber", icon: "🔒" },
    { key: "deep" as const, label: "Deep Dive", icon: "🔬" },
  ];

  const filtered = filter === "all" ? research : research.filter((r) => r.category === filter);
  const unread = research.filter((r) => !r.read).length;
  const readCount = research.filter((r) => r.read).length;

  const catColorMap: Record<string, string> = {
    world: "indigo",
    tech: "cyan",
    cyber: "rose",
    deep: "amber",
  };

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatBox icon="📰" value={research.length} label="Articles" />
        <StatBox icon="📖" value={readCount} label="Read" />
        <StatBox icon="🆕" value={unread} label="Unread" />
      </div>

      <AgentStatus verb="researching latest cybersecurity news" />

      {/* Category filter */}
      <div className="flex gap-1 overflow-auto pb-1">
        {categories.map((c) => (
          <button key={c.key} onClick={() => setFilter(c.key)} className={cx(
            "px-3 py-1.5 rounded-lg text-xs font-medium border transition whitespace-nowrap",
            filter === c.key ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10"
          )}>{c.icon} {c.label}</button>
        ))}
      </div>

      {/* Articles */}
      <div className="space-y-2 max-h-[60vh] overflow-auto">
        {filtered.map((article) => (
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
                    <Badge color={catColorMap[article.category] || "zinc"}>{article.category}</Badge>
                    <span className="text-[10px] text-zinc-500">{article.source}</span>
                  </div>
                  <div className={cx("text-xs font-semibold mt-1", article.read ? "text-zinc-400" : "text-white")}>
                    {article.title}
                  </div>
                </div>
                <span className={cx("text-zinc-500 transition-transform shrink-0", expanded === article.id && "rotate-90")}>›</span>
              </div>
            </button>

            {/* Expanded view — course-like deep dive */}
            {expanded === article.id && (
              <div className="px-4 pb-4 space-y-3 animate-fade-in border-t border-white/5 pt-3">
                <div className="flex gap-2">
                  <button
                    onClick={() => { toggleArticleRead(article.id); refresh(); }}
                    className={cx("px-3 py-1.5 rounded-lg text-xs font-medium transition",
                      article.read ? "bg-white/5 text-zinc-400" : "bg-indigo-500/20 text-indigo-400"
                    )}
                  >
                    {article.read ? "Mark Unread" : "✓ Mark Read"}
                  </button>
                  {article.url !== "#" && (
                    <a href={article.url} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 rounded-lg bg-white/5 text-zinc-400 text-xs hover:bg-white/10 transition">
                      Open Source ↗
                    </a>
                  )}
                </div>

                {/* Notes per article */}
                <div>
                  <div className="text-[10px] text-zinc-400 mb-1.5 font-medium">Your Notes</div>
                  <textarea
                    className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none resize-none h-20"
                    placeholder="Add your thoughts, key takeaways, questions…"
                    value={noteText[article.id] ?? article.notes}
                    onChange={(e) => setNoteText({ ...noteText, [article.id]: e.target.value })}
                  />
                  <button
                    onClick={() => {
                      saveArticleNotes(article.id, noteText[article.id] ?? article.notes);
                      refresh();
                    }}
                    className="mt-1 px-3 py-1 rounded-lg bg-indigo-500/20 text-indigo-400 text-[10px] font-medium hover:bg-indigo-500/30 transition"
                  >
                    Save Notes
                  </button>
                </div>

                {article.category === "deep" && (
                  <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/10">
                    <div className="text-[10px] text-amber-400 font-semibold mb-1">🔬 DEEP DIVE — Course Module</div>
                    <div className="text-[10px] text-zinc-400">This article is structured as a learning module. Ask your research agent to expand it into a full lesson with exercises.</div>
                    <button className="mt-2 px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 text-xs font-medium hover:bg-amber-500/30 transition">
                      Generate Full Lesson →
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
          <span className="text-xs text-zinc-400">{readCount} of {research.length} articles</span>
          <span className="text-xs font-semibold text-white">{research.length > 0 ? Math.round((readCount / research.length) * 100) : 0}%</span>
        </div>
        <ProgressBar value={research.length > 0 ? (readCount / research.length) * 100 : 0} gradient="from-indigo-500 to-violet-500" />
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
  return (
    <div className="space-y-3">
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

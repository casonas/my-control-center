"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

/* ────── helpers ────── */
function cx(...c: (string | false | undefined | null)[]) {
  return c.filter(Boolean).join(" ");
}

/* ────── types ────── */
interface Job {
  id: string;
  title: string;
  company: string;
  location?: string;
  url?: string;
  status: string;
  posted_at?: string;
  fetched_at?: string;
  match_score?: number;
  tags_json?: string;
  remote?: number;
  notes?: string;
}

interface PanelResponse {
  jobs?: Job[];
  items?: Job[];
  pipeline?: Record<string, number>;
  stats?: { total?: number; saved?: number; applied?: number; interview?: number };
  companies?: WatchCompany[];
  error?: string;
}

interface WatchCompany {
  id?: string;
  company_name?: string;
  name?: string;
  tier?: string;
  matching_jobs?: number;
  notes?: string;
}

/* ────── stat card ────── */
function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: string;
  color: string;
}) {
  const borderMap: Record<string, string> = {
    indigo: "border-indigo-500/20",
    emerald: "border-emerald-500/20",
    cyan: "border-cyan-500/20",
    violet: "border-violet-500/20",
    amber: "border-amber-500/20",
    rose: "border-rose-500/20",
  };
  const textMap: Record<string, string> = {
    indigo: "text-indigo-400",
    emerald: "text-emerald-400",
    cyan: "text-cyan-400",
    violet: "text-violet-400",
    amber: "text-amber-400",
    rose: "text-rose-400",
  };
  return (
    <div
      className={cx(
        "glass-light rounded-2xl p-5 text-center animate-fade-in border",
        borderMap[color] || "border-zinc-500/20",
      )}
    >
      <div className="text-2xl mb-1">{icon}</div>
      <div className={cx("text-2xl font-bold", textMap[color] || "text-zinc-400")}>{value}</div>
      <div className="text-xs text-zinc-400 mt-1">{label}</div>
    </div>
  );
}

/* ────── pipeline bar ────── */
const PIPELINE_STAGES = [
  { key: "new", label: "New", color: "blue" },
  { key: "saved", label: "Saved", color: "emerald" },
  { key: "applied", label: "Applied", color: "cyan" },
  { key: "interview", label: "Interview", color: "violet" },
  { key: "offer", label: "Offer", color: "amber" },
] as const;

function PipelineBar({ pipeline }: { pipeline: Record<string, number> }) {
  const total = PIPELINE_STAGES.reduce((s, st) => s + (pipeline[st.key] || 0), 0) || 1;

  return (
    <div className="glass-light rounded-2xl p-5 animate-fade-in">
      <h3 className="text-sm font-semibold text-zinc-100 mb-3">Pipeline</h3>
      {/* Visual bar */}
      <div className="flex h-4 rounded-full overflow-hidden bg-white/5 mb-3">
        {PIPELINE_STAGES.map((st) => {
          const count = pipeline[st.key] || 0;
          const pct = (count / total) * 100;
          if (pct === 0) return null;
          const bgMap: Record<string, string> = {
            blue: "bg-blue-500",
            emerald: "bg-emerald-500",
            cyan: "bg-cyan-500",
            violet: "bg-violet-500",
            amber: "bg-amber-500",
          };
          return (
            <div
              key={st.key}
              className={cx(bgMap[st.color], "transition-all duration-500")}
              style={{ width: `${pct}%` }}
              title={`${st.label}: ${count}`}
            />
          );
        })}
      </div>
      {/* Stage counts */}
      <div className="flex justify-between">
        {PIPELINE_STAGES.map((st) => {
          const textMap: Record<string, string> = {
            blue: "text-blue-400",
            emerald: "text-emerald-400",
            cyan: "text-cyan-400",
            violet: "text-violet-400",
            amber: "text-amber-400",
          };
          return (
            <div key={st.key} className="text-center flex-1">
              <div className={cx("text-sm font-bold", textMap[st.color])}>
                {pipeline[st.key] || 0}
              </div>
              <div className="text-[10px] text-zinc-500">{st.label}</div>
            </div>
          );
        })}
      </div>
      {/* Arrow connectors */}
      <div className="flex justify-between mt-1 px-4">
        {PIPELINE_STAGES.slice(0, -1).map((_, i) => (
          <span key={i} className="text-zinc-600 text-xs flex-1 text-center">
            →
          </span>
        ))}
      </div>
    </div>
  );
}

/* ────── job card ────── */
function JobCard({
  job,
  onAction,
}: {
  job: Job;
  onAction: (jobId: string, action: string) => void;
}) {
  const tags: string[] = (() => {
    if (!job.tags_json) return [];
    try {
      return JSON.parse(job.tags_json);
    } catch {
      return [];
    }
  })();

  const statusBadge: Record<string, { bg: string; text: string }> = {
    new: { bg: "bg-blue-500/10 border-blue-500/20", text: "text-blue-400" },
    saved: { bg: "bg-emerald-500/10 border-emerald-500/20", text: "text-emerald-400" },
    applied: { bg: "bg-cyan-500/10 border-cyan-500/20", text: "text-cyan-400" },
    interview: { bg: "bg-violet-500/10 border-violet-500/20", text: "text-violet-400" },
    offer: { bg: "bg-amber-500/10 border-amber-500/20", text: "text-amber-400" },
    rejected: { bg: "bg-rose-500/10 border-rose-500/20", text: "text-rose-400" },
    dismissed: { bg: "bg-zinc-500/10 border-zinc-500/20", text: "text-zinc-400" },
  };

  const badge = statusBadge[job.status] || statusBadge.new;

  return (
    <div className="glass-light rounded-2xl p-4 animate-fade-in hover:bg-white/[0.04] transition group">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Title + link */}
          <div className="flex items-center gap-2">
            {job.url ? (
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-white hover:underline truncate"
              >
                {job.title} ↗
              </a>
            ) : (
              <span className="text-sm font-semibold text-white truncate">{job.title}</span>
            )}
            <span
              className={cx(
                "inline-block rounded-full px-2 py-0.5 text-[10px] font-medium border shrink-0",
                badge.bg,
                badge.text,
              )}
            >
              {job.status}
            </span>
          </div>
          {/* Company + location */}
          <div className="text-xs text-zinc-400 mt-1">
            {job.company}
            {job.location && <span className="text-zinc-600"> · {job.location}</span>}
            {job.remote === 1 && (
              <span className="ml-1 text-emerald-500/80 text-[10px]">🏠 Remote</span>
            )}
          </div>
          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {tags.slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  className="inline-block rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 text-[10px]"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          {/* Match score */}
          {job.match_score != null && job.match_score > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={cx(
                      "h-full rounded-full transition-all duration-700",
                      job.match_score >= 40
                        ? "bg-emerald-500"
                        : job.match_score >= 20
                          ? "bg-amber-500"
                          : "bg-zinc-500",
                    )}
                    style={{ width: `${Math.min(100, job.match_score)}%` }}
                  />
                </div>
                <span
                  className={cx(
                    "text-[10px] font-medium",
                    job.match_score >= 40
                      ? "text-emerald-400"
                      : job.match_score >= 20
                        ? "text-amber-400"
                        : "text-zinc-500",
                  )}
                >
                  {job.match_score}% match
                </span>
              </div>
            </div>
          )}
          {/* Posted date */}
          {job.posted_at && (
            <div className="text-[10px] text-zinc-600 mt-1">
              Posted {new Date(job.posted_at).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>
      {/* Action buttons */}
      <div className="flex gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
        {job.status !== "saved" && (
          <button
            onClick={() => onAction(job.id, "saved")}
            className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-[10px] font-medium hover:bg-emerald-500/30 transition"
          >
            💾 Save
          </button>
        )}
        {job.status !== "applied" && (
          <button
            onClick={() => onAction(job.id, "applied")}
            className="px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 text-[10px] font-medium hover:bg-cyan-500/30 transition"
          >
            📤 Apply
          </button>
        )}
        {job.status !== "dismissed" && (
          <button
            onClick={() => onAction(job.id, "dismissed")}
            className="px-3 py-1.5 rounded-lg bg-white/5 text-zinc-400 text-[10px] font-medium hover:bg-white/10 transition"
          >
            ✕ Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

/* ────── company watchlist sidebar ────── */
function CompanyWatchlist({ companies }: { companies: WatchCompany[] }) {
  if (companies.length === 0) {
    return (
      <div className="glass-light rounded-2xl p-5 animate-fade-in">
        <h3 className="text-sm font-semibold text-zinc-100 mb-3">🏢 Company Watchlist</h3>
        <p className="text-[10px] text-zinc-500">
          No companies being tracked. Companies will appear here as you interact with jobs.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-light rounded-2xl p-5 animate-fade-in">
      <h3 className="text-sm font-semibold text-zinc-100 mb-3">🏢 Company Watchlist</h3>
      <div className="space-y-2">
        {companies.map((c, i) => (
          <div
            key={c.id || i}
            className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 hover:bg-white/10 transition"
          >
            <div>
              <div className="text-xs font-medium text-white">
                {c.company_name || c.name}
              </div>
              {c.tier && (
                <span
                  className={cx(
                    "inline-block rounded-full px-1.5 py-0.5 text-[9px] mt-0.5",
                    c.tier === "target"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : c.tier === "dream"
                        ? "bg-violet-500/10 text-violet-400"
                        : "bg-zinc-500/10 text-zinc-400",
                  )}
                >
                  {c.tier}
                </span>
              )}
            </div>
            {c.matching_jobs != null && c.matching_jobs > 0 && (
              <span className="text-[10px] text-cyan-400 bg-cyan-500/10 rounded-full px-2 py-0.5">
                {c.matching_jobs} jobs
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════ */
export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pipeline, setPipeline] = useState<Record<string, number>>({});
  const [companies, setCompanies] = useState<WatchCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Try the external panel API first (via proxy)
      const res = await fetch(`/api/jobs/panel?limit=10&status=${statusFilter === "all" ? "" : statusFilter}`, {
        cache: "no-store",
      });

      if (res.ok) {
        const data: PanelResponse = await res.json();
        setJobs(data.jobs || data.items || []);
        if (data.pipeline) setPipeline(data.pipeline);
        if (data.companies) setCompanies(data.companies);

        // If the panel API gives us stats but not pipeline, build pipeline from stats
        if (!data.pipeline && data.stats) {
          setPipeline({
            new: (data.stats.total || 0) - (data.stats.saved || 0) - (data.stats.applied || 0) - (data.stats.interview || 0),
            saved: data.stats.saved || 0,
            applied: data.stats.applied || 0,
            interview: data.stats.interview || 0,
            offer: 0,
          });
        }
        return;
      }
    } catch {
      /* External API unavailable — fall through to internal */
    }

    // Fallback: use existing internal endpoints
    try {
      const [feedRes, pipeRes] = await Promise.all([
        fetch(`/api/jobs/feed?status=${statusFilter}&limit=10`, {
          credentials: "include",
          cache: "no-store",
        }),
        fetch("/api/jobs/pipeline", {
          credentials: "include",
          cache: "no-store",
        }),
      ]);

      if (feedRes.ok) {
        const feedData = await feedRes.json();
        setJobs(feedData.items || []);
      }
      if (pipeRes.ok) {
        const pipeData = await pipeRes.json();
        setPipeline(pipeData.pipeline || {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Compute stats from pipeline
  const total = Object.values(pipeline).reduce((s, n) => s + n, 0);
  const saved = pipeline.saved || 0;
  const applied = pipeline.applied || 0;
  const interview = pipeline.interview || 0;

  async function handleAction(jobId: string, action: string) {
    // Try internal API first
    try {
      const csrf = (() => {
        try {
          return localStorage.getItem("mcc.csrf") || "";
        } catch {
          return "";
        }
      })();

      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF": csrf } : {}),
        },
        body: JSON.stringify({ status: action }),
      });

      if (res.ok) {
        // Optimistic update
        setJobs((prev) =>
          prev.map((j) => (j.id === jobId ? { ...j, status: action } : j)),
        );
        // Refresh pipeline
        loadData();
        return;
      }
    } catch {
      /* non-fatal */
    }

    // Optimistic UI update if API call fails
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, status: action } : j)),
    );
  }

  const statuses = ["all", "new", "saved", "applied", "interview", "offer", "rejected", "dismissed"];

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      {/* Header */}
      <header className="glass border-b border-white/5 px-6 py-4 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-zinc-500 hover:text-white transition text-sm">
              ← Dashboard
            </Link>
            <span className="text-zinc-700">/</span>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              💼 Job Search
            </h1>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 disabled:opacity-50 transition"
          >
            {loading ? "Loading…" : "🔄 Refresh"}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 overflow-auto" style={{ height: "calc(100vh - 64px)" }}>
        {error && (
          <div className="mb-4 rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400 animate-fade-in">
            ⚠ {error}
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatCard icon="💼" label="Total" value={total || jobs.length} color="indigo" />
          <StatCard icon="💾" label="Saved" value={saved} color="emerald" />
          <StatCard icon="📤" label="Applied" value={applied} color="cyan" />
          <StatCard icon="🎤" label="Interview" value={interview} color="violet" />
        </div>

        {/* Pipeline bar */}
        <div className="mb-4">
          <PipelineBar pipeline={pipeline} />
        </div>

        {/* Main content: jobs + sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          {/* Left: Job cards */}
          <div>
            {/* Status filter */}
            <div className="flex gap-1.5 overflow-auto pb-2 mb-3">
              {statuses.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cx(
                    "px-3 py-1.5 rounded-lg text-xs font-medium border transition whitespace-nowrap capitalize",
                    statusFilter === s
                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                      : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Job list */}
            {loading && jobs.length === 0 ? (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <div className="text-2xl mb-2 animate-pulse-soft">💼</div>
                  <div className="text-xs text-zinc-500">Loading jobs…</div>
                </div>
              </div>
            ) : jobs.length === 0 ? (
              <div className="glass-light rounded-2xl p-8 text-center animate-fade-in">
                <div className="text-2xl mb-2">📋</div>
                <div className="text-xs text-zinc-500">
                  No jobs found{statusFilter !== "all" ? ` with status "${statusFilter}"` : ""}.
                  Try refreshing or changing the filter.
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {jobs.map((job) => (
                  <JobCard key={job.id} job={job} onAction={handleAction} />
                ))}
              </div>
            )}
          </div>

          {/* Right: Company watchlist sidebar */}
          <div className="space-y-3">
            <CompanyWatchlist companies={companies} />

            {/* Quick stats summary */}
            <div className="glass-light rounded-2xl p-5 animate-fade-in">
              <h3 className="text-sm font-semibold text-zinc-100 mb-3">📊 Quick Stats</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Response rate</span>
                  <span className="text-white font-medium">
                    {applied > 0 ? `${Math.round((interview / applied) * 100)}%` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Pending applications</span>
                  <span className="text-cyan-400 font-medium">{applied}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Active interviews</span>
                  <span className="text-violet-400 font-medium">{interview}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Offers</span>
                  <span className="text-amber-400 font-medium">{pipeline.offer || 0}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

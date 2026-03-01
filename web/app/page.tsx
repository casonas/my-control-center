"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Login from "../components/Login";
import WidgetPanel from "../components/WidgetPanel";
import { apiGet, apiPost, streamChat, authMe, logout } from "@/lib/api";
import { TABS, type TabKey, type Agent, type Msg, type Note } from "@/lib/types";
import { getNotes, saveNote, deleteNote, searchAll } from "@/lib/store";
import type { Doc } from "@/lib/store";

function cx(...c: (string | false | undefined | null)[]) {
  return c.filter(Boolean).join(" ");
}

const glowMap: Record<string, string> = {
  home: "glow-cyan", school: "glow-violet", jobs: "glow-emerald",
  skills: "glow-amber", sports: "glow-rose", stocks: "glow-lime", research: "glow-indigo",
};

export default function Home() {
  /* ─── Auth ─── */
  const [authed, setAuthed] = useState<boolean | null>(null);

  /* ─── UI ─── */
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Doc[]>([]);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  /* ─── Agents ─── */
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string>("main");

  /* ─── Chat ─── */
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  /* ─── Notes ─── */
  const [notesTick, setNotesTick] = useState(0);
  const [notesFilter, setNotesFilter] = useState<TabKey | "all">("all");
  const [noteEditId, setNoteEditId] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteTab, setNoteTab] = useState<TabKey>("home");
  const [notesSearch, setNotesSearch] = useState("");

  const activeAgent = useMemo(() => agents.find((a) => a.id === activeAgentId), [agents, activeAgentId]);
  const tabMeta = TABS.find((t) => t.key === activeTab)!;

  /* ─── Auth + Bootstrap ─── */
  async function refreshAuthAndBootstrap() {
    setError(null);
    try {
      const me = await authMe();
      setAuthed(me.authed);
      if (!me.authed) { setAgents([]); setConversationId(null); setMessages([]); return; }
      const data = await apiGet<{ agents: Agent[] }>("/agents");
      const list = data.agents || [];
      setAgents(list);
      const nextId = list.find((a) => a.id === activeAgentId)?.id ? activeAgentId : list[0]?.id || "main";
      setActiveAgentId(nextId);
    } catch (e: unknown) {
      setAuthed(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { refreshAuthAndBootstrap(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function newConversation(agentId: string) {
    const data = await apiPost("/conversations", { agentId, title: `${agentId} chat` });
    setConversationId(data.conversationId);
    setMessages([]);
  }

  useEffect(() => {
    if (!authed || !agents.length) return;
    newConversation(activeAgentId).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [activeAgentId, authed, agents.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    if (!conversationId || !text.trim() || busy) return;
    setError(null);
    const userText = text.trim();
    setText("");
    setMessages((m) => [...m, { role: "user", content: userText }, { role: "agent", content: "" }]);
    setBusy(true);
    try {
      await streamChat({ conversationId, message: userText }, (delta) => {
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.role === "agent") last.content += delta;
          return copy;
        });
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    try { await logout(); } catch { /* ignore */ } finally {
      setAuthed(false); setAgents([]); setConversationId(null); setMessages([]);
    }
  }

  // Auto-scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Keyboard shortcut: Cmd+K for search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearchOpen((s) => !s); }
      if (e.key === "Escape") { setSearchOpen(false); setNotesOpen(false); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Search handler
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(() => setSearchResults(searchAll(searchQuery, 15)), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  /* ─── Notes helpers ─── */
  const allNotes = getNotes();
  void notesTick; // trigger re-read
  const filteredNotes = (notesFilter === "all" ? allNotes : allNotes.filter((n) => n.tab === notesFilter))
    .filter((n) => !notesSearch || n.title.toLowerCase().includes(notesSearch.toLowerCase()) || n.content.toLowerCase().includes(notesSearch.toLowerCase()));

  // Group notes by tab for folder view
  const notesByFolder = allNotes.reduce<Record<string, Note[]>>((acc, n) => {
    (acc[n.tab] = acc[n.tab] || []).push(n);
    return acc;
  }, {});

  function handleSaveNote() {
    if (!noteTitle.trim()) return;
    saveNote({ id: noteEditId || undefined, tab: noteTab, title: noteTitle.trim(), content: noteContent });
    setNoteEditId(null); setNoteTitle(""); setNoteContent("");
    setNotesTick((t) => t + 1);
  }

  function handleEditNote(n: Note) {
    setNoteEditId(n.id); setNoteTitle(n.title); setNoteContent(n.content); setNoteTab(n.tab);
  }

  /* ═══════════════════════════════════════════════════
     HEADER
     ═══════════════════════════════════════════════════ */
  function Header() {
    return (
      <header className="sticky top-0 z-40 glass border-b border-white/5">
        <div className="mx-auto max-w-[1600px] px-4 py-2.5 flex items-center gap-3">
          {/* Mobile menu */}
          <button className="md:hidden rounded-lg bg-white/5 px-2.5 py-2 text-sm hover:bg-white/10 transition" onClick={() => setSidebarOpen((s) => !s)} aria-label="Toggle sidebar">☰</button>

          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-xs font-bold text-white shadow-lg shadow-indigo-500/20">
              MCC
            </div>
            <div className="hidden sm:block leading-tight">
              <div className="text-sm font-bold text-white">My Control Center</div>
              <div className="text-[10px] text-zinc-400">{tabMeta.icon} {tabMeta.description}</div>
            </div>
          </div>

          {/* Desktop tabs */}
          <nav className="ml-4 hidden lg:flex items-center gap-0.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={cx(
                  "px-3 py-2 rounded-xl text-xs font-medium transition-all",
                  activeTab === t.key
                    ? `bg-gradient-to-r ${t.gradient} text-white shadow-lg`
                    : "text-zinc-400 hover:text-white hover:bg-white/5"
                )}
              >
                <span className="mr-1.5">{t.icon}</span>{t.label}
              </button>
            ))}
          </nav>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Search button */}
          <button onClick={() => setSearchOpen(true)} className="rounded-xl bg-white/5 border border-white/5 px-3 py-2 text-xs text-zinc-400 hover:bg-white/10 transition hidden sm:flex items-center gap-2">
            <span>🔍</span>
            <span>Search…</span>
            <kbd className="text-[10px] bg-white/10 rounded px-1.5 py-0.5">⌘K</kbd>
          </button>

          {/* Notes button */}
          <button onClick={() => setNotesOpen(true)} className="rounded-xl bg-white/5 border border-white/5 px-3 py-2 text-xs text-zinc-400 hover:bg-white/10 transition">📝</button>

          {/* Logout */}
          <button onClick={handleLogout} className="rounded-xl bg-white/5 border border-white/5 px-3 py-2 text-xs text-zinc-400 hover:bg-white/10 hover:text-red-400 transition">Logout</button>
        </div>

        {/* Mobile tabs */}
        <div className="lg:hidden px-4 pb-2 flex gap-1.5 overflow-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cx(
                "whitespace-nowrap px-3 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0",
                activeTab === t.key
                  ? `bg-gradient-to-r ${t.gradient} text-white shadow-lg`
                  : "text-zinc-400 bg-white/5 hover:bg-white/10"
              )}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </header>
    );
  }

  /* ═══════════════════════════════════════════════════
     SIDEBAR
     ═══════════════════════════════════════════════════ */
  function Sidebar() {
    return (
      <aside className={cx(
        "md:sticky md:top-[72px] md:h-[calc(100vh-72px)] md:block",
        "w-full md:w-[260px] shrink-0 overflow-auto",
        sidebarOpen ? "block" : "hidden"
      )}>
        <div className="p-3 space-y-3">
          {/* Agents */}
          <div className="glass-light rounded-2xl p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold text-zinc-100">🤖 Agents</h2>
              <span className="text-[10px] text-zinc-500">{agents.length}</span>
            </div>
            <div className="space-y-1">
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setActiveAgentId(a.id)}
                  className={cx(
                    "w-full text-left rounded-xl px-3 py-2 transition-all",
                    a.id === activeAgentId
                      ? "bg-white/10 border border-white/10"
                      : "hover:bg-white/5"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-base">{a.emoji}</span>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-white truncate">{a.name}</div>
                      <div className="text-[10px] text-zinc-500">{a.id}</div>
                    </div>
                    {a.id === activeAgentId && (
                      <span className="ml-auto relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                      </span>
                    )}
                  </div>
                </button>
              ))}
              {agents.length === 0 && (
                <div className="text-xs text-zinc-500 py-3 text-center">No agents connected</div>
              )}
            </div>
          </div>

          {/* Tab info */}
          <div className={cx("glass-light rounded-2xl p-3", glowMap[activeTab])}>
            <div className="text-base mb-1">{tabMeta.icon}</div>
            <div className="text-xs font-semibold text-white">{tabMeta.label} Workspace</div>
            <div className="text-[10px] text-zinc-400 mt-0.5">{tabMeta.description}</div>
          </div>

          {/* Quick links */}
          <div className="glass-light rounded-2xl p-3">
            <div className="text-xs font-semibold text-zinc-100 mb-2">⚡ Quick Actions</div>
            <div className="space-y-1">
              <button onClick={() => setNotesOpen(true)} className="w-full text-left rounded-lg hover:bg-white/5 px-2.5 py-1.5 text-xs text-zinc-400 transition">📝 Knowledge Base</button>
              <button onClick={() => setSearchOpen(true)} className="w-full text-left rounded-lg hover:bg-white/5 px-2.5 py-1.5 text-xs text-zinc-400 transition">🔍 Search Everything</button>
              <button onClick={() => setActiveTab("skills")} className="w-full text-left rounded-lg hover:bg-white/5 px-2.5 py-1.5 text-xs text-zinc-400 transition">🧠 Continue Learning</button>
              <button onClick={() => setActiveTab("jobs")} className="w-full text-left rounded-lg hover:bg-white/5 px-2.5 py-1.5 text-xs text-zinc-400 transition">💼 Check Job Feed</button>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  /* ═══════════════════════════════════════════════════
     CHAT PANEL
     ═══════════════════════════════════════════════════ */
  function ChatPanel() {
    const suggestionsMap: Record<TabKey, { text: string; prompt: string }[]> = {
      home: [
        { text: "Plan my day → 3 priorities", prompt: "Give me a concise plan for today with 3 priorities." },
        { text: "Summarize my progress", prompt: "Summarize my current progress across all workspaces." },
      ],
      school: [
        { text: "Help me study", prompt: "Create a study plan for my upcoming assignments." },
        { text: "Explain a concept", prompt: "I need help understanding a concept from my coursework." },
      ],
      jobs: [
        { text: "Find cybersecurity jobs", prompt: "Find me the latest cybersecurity job postings for entry-level and junior roles." },
        { text: "Review my resume", prompt: "Help me improve my cybersecurity resume for SOC analyst positions." },
      ],
      skills: [
        { text: "Plan a Security+ lesson", prompt: "Create a detailed lesson plan for CompTIA Security+ covering the next topic I should study." },
        { text: "Quiz me", prompt: "Give me 5 practice questions on cybersecurity fundamentals." },
      ],
      sports: [
        { text: "Today's scores", prompt: "What are today's NBA scores and notable highlights?" },
        { text: "Game predictions", prompt: "Give me predictions and analysis for today's games." },
      ],
      stocks: [
        { text: "Market analysis", prompt: "Give me a brief analysis of today's market movements and cybersecurity stock performance." },
        { text: "Portfolio review", prompt: "Review my watchlist stocks: AAPL, MSFT, CRWD, PANW, NET." },
      ],
      research: [
        { text: "Latest cyber news", prompt: "What are the most important cybersecurity news stories from today?" },
        { text: "Deep dive topic", prompt: "Give me a deep dive lesson on a cutting-edge cybersecurity topic." },
      ],
    };

    const suggestions = suggestionsMap[activeTab] || suggestionsMap.home;

    return (
      <section className={cx("glass-light rounded-2xl flex flex-col min-h-[60vh] lg:min-h-[75vh]", glowMap[activeTab])}>
        {/* Chat header */}
        <div className="p-3 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">{activeAgent?.emoji || "🤖"}</span>
            <div>
              <div className="text-xs font-semibold text-white">{activeAgent?.name || "Agent"}</div>
              <div className="text-[10px] text-zinc-500">{tabMeta.icon} {tabMeta.label} workspace</div>
            </div>
          </div>
          <div className="text-[10px] text-zinc-600">
            {conversationId ? `#${conversationId.slice(0, 6)}` : "—"}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 p-4 overflow-auto space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-8 animate-fade-in">
              <div className="text-3xl mb-3">{tabMeta.icon}</div>
              <div className="text-sm font-semibold text-white mb-1">{tabMeta.label} Agent</div>
              <div className="text-xs text-zinc-400 mb-4">{tabMeta.description}</div>
              <div className="grid gap-2 sm:grid-cols-2 max-w-sm mx-auto">
                {suggestions.map((s) => (
                  <button
                    key={s.text}
                    className="text-left rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 px-3 py-2.5 text-xs text-zinc-300 transition"
                    onClick={() => setText(s.prompt)}
                  >
                    {s.text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, idx) => (
            <div key={idx} className={cx("max-w-[88%] animate-fade-in", m.role === "user" && "ml-auto")}>
              <div className={cx(
                "rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap",
                m.role === "user"
                  ? `bg-gradient-to-r ${tabMeta.gradient} text-white`
                  : "bg-white/5 text-zinc-200 border border-white/5"
              )}>
                {m.content || (m.role === "agent" && busy && (
                  <span className="inline-flex gap-1">
                    <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                ))}
              </div>
            </div>
          ))}

          {error && (
            <div className="text-sm text-red-300 bg-red-950/30 border border-red-900/40 rounded-xl p-3 animate-fade-in">
              {error}
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-white/5 flex gap-2">
          <input
            className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3.5 py-2.5 outline-none text-sm text-white placeholder-zinc-500 focus:border-indigo-500/30 transition"
            placeholder={`Message ${activeAgent?.name || "agent"}…`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            disabled={busy}
          />
          <button
            className={cx(
              "rounded-xl px-4 py-2.5 font-semibold text-sm transition-all disabled:opacity-30",
              `bg-gradient-to-r ${tabMeta.gradient} text-white shadow-lg`
            )}
            disabled={busy || !text.trim()}
            onClick={send}
          >
            {busy ? "…" : "Send"}
          </button>
        </div>
      </section>
    );
  }

  /* ═══════════════════════════════════════════════════
     COMMAND PALETTE (⌘K Search)
     ═══════════════════════════════════════════════════ */
  function CommandPalette() {
    if (!searchOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={() => setSearchOpen(false)}>
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div className="relative w-full max-w-lg mx-4 animate-slide-up" onClick={(e) => e.stopPropagation()}>
          <div className="glass rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
            <div className="flex items-center gap-3 p-4 border-b border-white/5">
              <span className="text-zinc-400">🔍</span>
              <input
                autoFocus
                className="flex-1 bg-transparent text-sm text-white placeholder-zinc-500 outline-none"
                placeholder="Search notes, assignments, skills, jobs, articles…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <kbd className="text-[10px] text-zinc-500 bg-white/5 rounded px-1.5 py-0.5">ESC</kbd>
            </div>
            <div className="max-h-80 overflow-auto p-2">
              {searchResults.length === 0 && searchQuery && (
                <div className="py-8 text-center text-xs text-zinc-500">No results for &quot;{searchQuery}&quot;</div>
              )}
              {searchResults.length === 0 && !searchQuery && (
                <div className="py-8 text-center text-xs text-zinc-500">Type to search across all your data</div>
              )}
              {searchResults.map((doc) => (
                <button
                  key={doc.id}
                  className="w-full text-left rounded-xl px-3 py-2.5 hover:bg-white/5 transition"
                  onClick={() => setSearchOpen(false)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-500 uppercase bg-white/5 rounded px-1.5 py-0.5">{doc.collection}</span>
                    <span className="text-xs text-white truncate">{doc.searchText.slice(0, 60)}</span>
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 flex gap-2">
                    {doc.tags.slice(0, 3).map((t) => <span key={t} className="bg-white/5 rounded px-1">{t}</span>)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════
     NOTES DRAWER (Notion-style Knowledge Base)
     ═══════════════════════════════════════════════════ */
  function NotesDrawer() {
    if (!notesOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setNotesOpen(false)}>
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div className="relative w-full max-w-lg h-full animate-slide-up" onClick={(e) => e.stopPropagation()}>
          <div className="h-full glass border-l border-white/10 flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">📝</span>
                <h2 className="text-sm font-bold text-white">Knowledge Base</h2>
              </div>
              <button onClick={() => setNotesOpen(false)} className="text-zinc-400 hover:text-white text-lg transition">✕</button>
            </div>

            {/* Search */}
            <div className="p-3 border-b border-white/5">
              <input
                className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none"
                placeholder="Search notes…"
                value={notesSearch}
                onChange={(e) => setNotesSearch(e.target.value)}
              />
            </div>

            {/* Filter tabs */}
            <div className="px-3 py-2 flex gap-1 overflow-auto border-b border-white/5">
              <button
                onClick={() => setNotesFilter("all")}
                className={cx("px-2.5 py-1 rounded-lg text-[10px] font-medium transition", notesFilter === "all" ? "bg-indigo-500/20 text-indigo-400" : "text-zinc-400 hover:bg-white/5")}
              >All</button>
              {TABS.map((t) => (
                <button key={t.key} onClick={() => setNotesFilter(t.key)} className={cx(
                  "px-2.5 py-1 rounded-lg text-[10px] font-medium transition whitespace-nowrap",
                  notesFilter === t.key ? "bg-indigo-500/20 text-indigo-400" : "text-zinc-400 hover:bg-white/5"
                )}>{t.icon} {t.label}</button>
              ))}
            </div>

            {/* Notes content */}
            <div className="flex-1 overflow-auto p-3 space-y-3">
              {/* New / Edit note form */}
              <div className="glass-light rounded-xl p-3 space-y-2">
                <div className="text-[10px] font-semibold text-zinc-400 uppercase">{noteEditId ? "Edit Note" : "New Note"}</div>
                <input
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none"
                  placeholder="Title"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                />
                <textarea
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none resize-none h-24"
                  placeholder="Content (markdown supported: **bold**, *italic*, - lists, # headings)"
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <select
                    className="rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-[10px] text-zinc-400 outline-none"
                    value={noteTab}
                    onChange={(e) => setNoteTab(e.target.value as TabKey)}
                  >
                    {TABS.map((t) => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
                  </select>
                  <button
                    onClick={handleSaveNote}
                    disabled={!noteTitle.trim()}
                    className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 text-xs font-medium hover:bg-indigo-500/30 disabled:opacity-30 transition"
                  >
                    {noteEditId ? "Update" : "Save"}
                  </button>
                  {noteEditId && (
                    <button onClick={() => { setNoteEditId(null); setNoteTitle(""); setNoteContent(""); }} className="text-xs text-zinc-500 hover:text-white transition">Cancel</button>
                  )}
                </div>
              </div>

              {/* Folder view */}
              {notesFilter === "all" && !notesSearch ? (
                <div className="space-y-2">
                  {TABS.map((tab) => {
                    const folder = notesByFolder[tab.key];
                    if (!folder?.length) return null;
                    return (
                      <div key={tab.key} className="glass-light rounded-xl overflow-hidden">
                        <div className="px-3 py-2 flex items-center gap-2 border-b border-white/5">
                          <span className="text-xs">{tab.icon}</span>
                          <span className="text-xs font-semibold text-zinc-100">{tab.label}</span>
                          <span className="text-[10px] text-zinc-500 ml-auto">{folder.length} note{folder.length !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="divide-y divide-white/5">
                          {folder.map((n) => (
                            <div key={n.id} className="px-3 py-2 flex items-start gap-2 group hover:bg-white/5 transition">
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium text-white">{n.title}</div>
                                <div className="text-[10px] text-zinc-500 truncate">{n.content || "Empty"}</div>
                              </div>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                                <button onClick={() => handleEditNote(n)} className="text-[10px] text-zinc-400 hover:text-white">✏️</button>
                                <button onClick={() => { deleteNote(n.id); setNotesTick((t) => t + 1); }} className="text-[10px] text-zinc-400 hover:text-red-400">🗑️</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {allNotes.length === 0 && (
                    <div className="py-8 text-center text-zinc-500 text-xs">No notes yet. Create your first note above!</div>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filteredNotes.map((n) => {
                    const t = TABS.find((tab) => tab.key === n.tab);
                    return (
                      <div key={n.id} className="glass-light rounded-xl px-3 py-2.5 flex items-start gap-2 group hover:bg-white/5 transition">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px]">{t?.icon}</span>
                            <span className="text-xs font-medium text-white">{n.title}</span>
                          </div>
                          <div className="text-[10px] text-zinc-500 mt-0.5 line-clamp-2">{n.content || "Empty"}</div>
                          <div className="text-[10px] text-zinc-600 mt-1">{new Date(n.updatedAt).toLocaleDateString()}</div>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                          <button onClick={() => handleEditNote(n)} className="text-[10px] text-zinc-400 hover:text-white">✏️</button>
                          <button onClick={() => { deleteNote(n.id); setNotesTick((t) => t + 1); }} className="text-[10px] text-zinc-400 hover:text-red-400">🗑️</button>
                        </div>
                      </div>
                    );
                  })}
                  {filteredNotes.length === 0 && (
                    <div className="py-6 text-center text-zinc-500 text-xs">No notes in this filter</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════
     ROUTING / RENDER
     ═══════════════════════════════════════════════════ */

  // Loading
  if (authed === null) {
    return (
      <main className="min-h-screen bg-[#050507] text-white flex items-center justify-center">
        <div className="text-center animate-fade-in">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-lg font-bold mb-4 shadow-lg shadow-indigo-500/20 animate-pulse-soft">
            MCC
          </div>
          <div className="text-sm text-zinc-400">Loading…</div>
        </div>
      </main>
    );
  }

  // Not authed
  if (!authed) {
    return <Login onSuccess={refreshAuthAndBootstrap} />;
  }

  // Main dashboard
  return (
    <main className="min-h-screen bg-[#050507] text-white">
      <Header />

      <div className="mx-auto max-w-[1600px] flex">
        <Sidebar />

        <div className="flex-1 p-3 md:p-4 min-w-0">
          {/* Desktop: side-by-side layout */}
          <div className="hidden md:grid md:grid-cols-[1fr_420px] gap-4">
            <ChatPanel />
            <div className="space-y-3 overflow-auto max-h-[calc(100vh-90px)] pb-4">
              <WidgetPanel activeTab={activeTab} />
            </div>
          </div>

          {/* Mobile: stacked with chat toggle */}
          <div className="md:hidden space-y-3">
            {!mobileChatOpen && <WidgetPanel activeTab={activeTab} />}
            {mobileChatOpen && <ChatPanel />}
          </div>
        </div>
      </div>

      {/* Mobile chat FAB */}
      <button
        onClick={() => setMobileChatOpen(!mobileChatOpen)}
        className={cx(
          "md:hidden fixed bottom-6 right-6 z-30 w-14 h-14 rounded-2xl shadow-2xl flex items-center justify-center text-xl transition-all",
          `bg-gradient-to-r ${tabMeta.gradient} text-white`,
          mobileChatOpen && "rotate-45"
        )}
      >
        {mobileChatOpen ? "✕" : "💬"}
      </button>

      {/* Overlays */}
      <CommandPalette />
      <NotesDrawer />
    </main>
  );
}

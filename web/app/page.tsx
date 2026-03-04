"use client";

import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import Login from "../components/Login";
import WidgetPanel from "../components/WidgetPanel";
import type { LessonClickInfo } from "../components/WidgetPanel";
import { apiGet, apiPost, apiPatch, apiDelete, apiFetch, streamChat, authMe, logout } from "@/lib/api";
import { TABS, type TabKey, type Agent, type Msg, type Note } from "@/lib/types";
import { getNotes, saveNote, deleteNote, searchAll } from "@/lib/store";
import type { Doc } from "@/lib/store";
import { getAllAgents, addAgent as addAgentToRegistry } from "@/lib/agents";
import {
  connectAll,
  disconnectAll,
  onSessionChange,
  getSession,
  type AgentSession,
} from "@/lib/agentSession";
import {
  getWorkspace,
  switchToTab,
  switchToAgent,
  setWorkspace,
  setLastSessionForAgent,
} from "@/lib/workspace";
import { useChatScroll } from "@/hooks/useChatScroll";

function cx(...c: (string | false | undefined | null)[]) {
  return c.filter(Boolean).join(" ");
}

const glowMap: Record<string, string> = {
  home: "glow-cyan", school: "glow-violet", jobs: "glow-emerald",
  skills: "glow-amber", sports: "glow-rose", stocks: "glow-lime", research: "glow-indigo",
  notes: "glow-teal", settings: "glow-zinc",
};

/* ─────────────────────────────────────────────────────
   THEME HINT COLORS — maps [THEME:*] tags to CSS vars
   ───────────────────────────────────────────────────── */
const THEME_COLORS: Record<string, string> = {
  ORANGE: "#f97316",   // Knicks
  BLUE: "#0078d0",     // Chargers / Tottenham
  GARNET: "#73000a",   // Gamecocks
  BROWN: "#2f241d",    // Padres
  RED: "#ef4444",
  GREEN: "#22c55e",
  PURPLE: "#a855f7",
  CYAN: "#06b6d4",
  DEFAULT: "#6366f1",
};
const THEME_TAG_RE = /\[THEME:(\w+)\]/;
const THEME_STRIP_RE = /\[THEME:\w+\]/g;

/* ─────────────────────────────────────────────────────
   MessageInput — Decoupled from parent state so typing
   does NOT re-render the entire chat/dashboard.
   ───────────────────────────────────────────────────── */
const MAX_INPUT_HEIGHT = 160;

const MessageInput = React.memo(function MessageInput({
  onSend,
  busy,
  placeholder,
  gradient,
  suggestedText,
  onSuggestionConsumed,
  onFileUpload,
}: {
  onSend: (text: string) => void;
  busy: boolean;
  placeholder: string;
  gradient: string;
  suggestedText: string;
  onSuggestionConsumed: () => void;
  onFileUpload?: (file: File) => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // "Adjusting state during render" pattern — avoids useEffect + setState lint error.
  // React re-renders once more with the new text; no cascading effects.
  const [prevSuggested, setPrevSuggested] = useState("");
  if (suggestedText && suggestedText !== prevSuggested) {
    setPrevSuggested(suggestedText);
    setText(suggestedText);
    onSuggestionConsumed();
  }

  // Auto-resize textarea to fit content (up to max-height)
  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, MAX_INPUT_HEIGHT) + "px";
  }, []);

  // Focus input after suggestion is applied & resize
  useEffect(() => {
    if (text && inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.focus();
    }
    autoResize();
  }, [text, autoResize]);

  function handleSend() {
    if (!text.trim() || busy) return;
    onSend(text.trim());
    setText("");
    // Reset height after clearing
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.style.height = "auto";
      }
    });
  }

  return (
    <div className="shrink-0 p-3 border-t border-white/5 flex gap-2 items-end">
      {onFileUpload && (
        <>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.txt,.md,.csv,.json,.zip,.png,.jpg,.jpeg,.gif,.webp,.docx,.xlsx"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFileUpload(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="rounded-xl bg-white/5 border border-white/10 px-2.5 py-2.5 text-sm text-zinc-400 hover:text-white hover:bg-white/10 transition shrink-0"
            title="Attach file"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >📎</button>
        </>
      )}
      <textarea
        ref={inputRef}
        rows={1}
        className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3.5 py-2.5 outline-none text-sm text-white placeholder-zinc-500 focus:border-indigo-500/30 transition resize-none overflow-y-auto break-words"
        style={{ maxHeight: MAX_INPUT_HEIGHT }}
        placeholder={placeholder}
        value={text}
        onChange={(e) => { setText(e.target.value); autoResize(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
        }}
        disabled={busy}
      />
      <button
        className={cx(
          "rounded-xl px-4 py-2.5 font-semibold text-sm transition-all disabled:opacity-30 shrink-0",
          `bg-gradient-to-r ${gradient} text-white shadow-lg`
        )}
        disabled={busy || !text.trim()}
        onClick={handleSend}
      >
        {busy ? "…" : "Send"}
      </button>
    </div>
  );
});

export default function Home() {
  /* ─── Auth ─── */
  const [authed, setAuthed] = useState<boolean | null>(null);

  /* ─── UI ─── */
  const [activeTab, setActiveTabRaw] = useState<TabKey>(() => getWorkspace().tab);
  const [activeAgentIdFromWs] = useState(() => getWorkspace().agentId);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Doc[]>([]);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  /* ─── Agents ─── */
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgentId, setActiveAgentIdRaw] = useState<string>(activeAgentIdFromWs);
  const [agentSessions, setAgentSessions] = useState<Record<string, AgentSession>>({});
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [collabMode, setCollabMode] = useState(false);
  const [collabAgentIds, setCollabAgentIds] = useState<Set<string>>(new Set());
  const [addAgentOpen, setAddAgentOpen] = useState(false);

  /* ─── Workspace-aware switching ─── */
  const handleSwitchTab = useCallback((tab: TabKey) => {
    const ws = switchToTab(tab);
    setActiveTabRaw(ws.tab);
    setActiveAgentIdRaw(ws.agentId);
  }, []);

  const handleSwitchAgent = useCallback((agentId: string) => {
    const ws = switchToAgent(agentId);
    setActiveTabRaw(ws.tab);
    setActiveAgentIdRaw(ws.agentId);
  }, []);

  /* ─── Chat ─── */
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [suggestedText, setSuggestedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [themeAccent, setThemeAccent] = useState(THEME_COLORS.DEFAULT);
  const { scrollRef: chatScrollRef, atBottom: chatAtBottom, unreadCount: chatUnread, jumpToBottom: chatJumpToBottom, snapToBottom: chatSnapToBottom, onNewMessage: chatOnNewMessage, onStreamDelta: chatOnStreamDelta } = useChatScroll();

  // Per-agent message cache — survives agent switching
  const chatCacheRef = useRef<Record<string, { msgs: Msg[]; convId: string | null }>>({});

  /* ─── Chat sessions (D1-backed history) ─── */
  interface ChatSessionItem { id: string; agent_id: string; title: string; updated_at: string; pinned: number }
  const [chatSessions, setChatSessions] = useState<ChatSessionItem[]>([]);
  const [sessionsOpen, setSessionsOpen] = useState(false);

  const loadSessions = useCallback(async (agentId: string) => {
    try {
      const data = await apiGet<{ sessions: ChatSessionItem[] }>(`/chat/sessions?agentId=${encodeURIComponent(agentId)}`);
      setChatSessions(data.sessions || []);
    } catch {
      // D1 not available — non-fatal
      setChatSessions([]);
    }
  }, []);

  // Reload sessions when agent changes
  useEffect(() => {
    if (authed) loadSessions(activeAgentId);
  }, [activeAgentId, authed, loadSessions]);

  async function handleNewChat() {
    try {
      const data = await apiPost<{ sessionId: string }>("/chat/sessions", { agentId: activeAgentId });
      setConversationId(data.sessionId);
      setMessages([]);
      chatSnapToBottom();
      loadSessions(activeAgentId);
    } catch {
      // D1 not available — use a local random ID
      setConversationId(crypto.randomUUID());
      setMessages([]);
    }
    setSessionsOpen(false);
  }

  async function handleSelectSession(sessionId: string) {
    try {
      const data = await apiGet<{ session: ChatSessionItem; messages: { role: string; content: string }[] }>(`/chat/sessions/${sessionId}`);
      setConversationId(sessionId);
      setMessages((data.messages || []).map((m) => ({
        role: m.role === "user" ? "user" as const : "agent" as const,
        content: m.content,
      })));
      chatSnapToBottom();
    } catch {
      // D1 not available — just switch the ID
      setConversationId(sessionId);
      setMessages([]);
    }
    setSessionsOpen(false);
  }

  /* ─── File upload ─── */
  interface FileItem { id: string; name: string; mime: string; size: number; created_at: string }
  const [chatFiles, setChatFiles] = useState<FileItem[]>([]);

  const loadChatFiles = useCallback(async (sessionId: string) => {
    try {
      const d = await apiGet<{ files: FileItem[] }>(`/files?scopeType=chat_session&scopeId=${encodeURIComponent(sessionId)}`);
      setChatFiles(d.files || []);
    } catch { setChatFiles([]); }
  }, []);

  useEffect(() => {
    if (conversationId) loadChatFiles(conversationId);
    else setChatFiles([]);
  }, [conversationId, loadChatFiles]);

  async function handleFileUpload(file: File) {
    if (!conversationId) return;
    setError(null);
    try {
      const meta = await apiPost<{ ok: boolean; fileId: string; storageKey: string; uploadUrl: string; error?: string }>("/files", {
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        scope: { type: "chat_session", id: conversationId },
      });
      if (!meta.ok) { setError(meta.error || "Upload failed"); return; }
      const csrf = typeof window !== "undefined" ? localStorage.getItem("mcc.csrf") : null;
      const headers: Record<string, string> = { "Content-Type": file.type || "application/octet-stream" };
      if (csrf) headers["X-CSRF"] = csrf;
      await apiFetch(`/files/${meta.fileId}/upload`, {
        method: "PUT",
        headers,
        body: file,
      });
      loadChatFiles(conversationId);
      setMessages((m) => [...m, { role: "user", content: `📎 Uploaded: ${file.name}` }]);
      chatOnNewMessage();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  }

  /* ─── Chat history management ─── */
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  async function handleRenameSession(sessionId: string, newTitle: string) {
    if (!newTitle.trim()) return;
    try {
      await apiPatch(`/chat/sessions/${sessionId}`, { title: newTitle.trim() });
      loadSessions(activeAgentId);
    } catch { /* non-fatal */ }
    setEditingSessionId(null);
    setEditingTitle("");
  }

  async function handleDeleteSession(sessionId: string) {
    try {
      await apiDelete(`/chat/sessions/${sessionId}`);
      if (conversationId === sessionId) {
        setConversationId(null);
        setMessages([]);
      }
      loadSessions(activeAgentId);
    } catch { /* non-fatal */ }
  }
  const [lessonContext, setLessonContext] = useState<LessonClickInfo | null>(null);

  const openLessonChat = useCallback(async (info: LessonClickInfo) => {
    setLessonContext(info);
    // Ensure we're on the skills tab
    const ws = switchToTab("skills");
    setActiveTabRaw(ws.tab);
    setActiveAgentIdRaw(ws.agentId);

    try {
      // Find-or-create a session for this lesson
      const data = await apiPost<{ sessionId: string; title: string; created: boolean }>("/chat/sessions", {
        agentId: ws.agentId,
        title: `📖 ${info.lessonTitle}`,
        contextType: "lesson",
        contextId: info.lessonId,
      });

      const sessionId = data.sessionId;
      setConversationId(sessionId);

      // Load existing messages from D1
      const detail = await apiGet<{ session: ChatSessionItem; messages: { role: string; content: string }[] }>(`/chat/sessions/${sessionId}`);
      const msgs: Msg[] = (detail.messages || []).map((m) => ({
        role: m.role === "user" ? "user" as const : "agent" as const,
        content: m.content,
      }));
      setMessages(msgs);
      chatSnapToBottom();
      loadSessions(ws.agentId);

      // On mobile, open the chat pane
      setMobileChatOpen(true);
    } catch {
      // D1 not available — open chat with a new random session
      setConversationId(crypto.randomUUID());
      setMessages([]);
    }
  }, [chatSnapToBottom, loadSessions]);

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
  const agentTree = useMemo(() => {
    const all = agents;
    const roots = all.filter((a) => !a.parentId);
    return roots.map((root) => ({
      ...root,
      children: all.filter((a) => a.parentId === root.id),
    }));
  }, [agents]);

  /* ─── Session status listener ─── */
  useEffect(() => {
    const unsub = onSessionChange(setAgentSessions);
    return () => { unsub(); };
  }, []);

  /* ─── Auth + Bootstrap ─── */
  const refreshAuthAndBootstrap = useCallback(async () => {
    setError(null);
    try {
      const me = await authMe();
      setAuthed(me.authed);
      if (!me.authed) { setAgents([]); setConversationId(null); setMessages([]); disconnectAll(); return; }

      // Merge API agents with client-side custom agents
      const data = await apiGet<{ agents: Agent[] }>("/agents");
      const apiAgents = data.agents || [];
      const custom = getAllAgents().filter(
        (ca) => !apiAgents.some((a) => a.id === ca.id)
      );
      const list = [...apiAgents, ...custom];
      setAgents(list);
      const nextId = list.find((a) => a.id === activeAgentId)?.id ? activeAgentId : list[0]?.id || "main";
      handleSwitchAgent(nextId);

      // Warm up all agents immediately — no cold starts
      connectAll(list);
    } catch (e: unknown) {
      setAuthed(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [activeAgentId, handleSwitchAgent]);

  useEffect(() => { refreshAuthAndBootstrap(); return () => { disconnectAll(); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function newConversation(agentId: string) {
    // Check in-memory cache first — restore messages if user is switching back
    const cached = chatCacheRef.current[agentId];
    if (cached) {
      setConversationId(cached.convId);
      setMessages(cached.msgs);
      return;
    }
    // Try to resume the most recent D1 session for this agent
    try {
      const sessionData = await apiGet<{ sessions: ChatSessionItem[] }>(`/chat/sessions?agentId=${encodeURIComponent(agentId)}`);
      const latest = sessionData.sessions?.[0];
      if (latest) {
        const detail = await apiGet<{ session: ChatSessionItem; messages: { role: string; content: string }[] }>(`/chat/sessions/${latest.id}`);
        setConversationId(latest.id);
        setMessages((detail.messages || []).map((m) => ({
          role: m.role === "user" ? "user" as const : "agent" as const,
          content: m.content,
        })));
        return;
      }
    } catch {
      // D1 not available — fall through
    }
    // No prior session — start fresh with a new ID
    try {
      const data = await apiPost<{ sessionId?: string; conversationId?: string }>("/chat/sessions", { agentId });
      const newId = data.sessionId || data.conversationId || crypto.randomUUID();
      setConversationId(newId);
    } catch {
      setConversationId(crypto.randomUUID());
    }
    setMessages([]);
  }

  // Save current chat to cache before switching agents
  const prevAgentRef = useRef(activeAgentId);
  useEffect(() => {
    if (!authed || !agents.length) return;
    // Save outgoing agent's messages to cache
    const prev = prevAgentRef.current;
    if (prev !== activeAgentId) {
      chatCacheRef.current[prev] = { msgs: messages, convId: conversationId };
      prevAgentRef.current = activeAgentId;
    }
    newConversation(activeAgentId).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [activeAgentId, authed, agents.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep cache in sync as messages stream in + persist sessionId to workspace
  useEffect(() => {
    chatCacheRef.current[activeAgentId] = { msgs: messages, convId: conversationId };
    if (conversationId) {
      setLastSessionForAgent(activeAgentId, conversationId);
      setWorkspace({ sessionId: conversationId });
    }
  }, [messages, conversationId, activeAgentId]);

  async function send(userText: string) {
    if (!conversationId || !userText || busy) return;
    setError(null);

    // In collab mode, tag which agents should respond
    const respondingAgents = collabMode && collabAgentIds.size > 0
      ? Array.from(collabAgentIds)
      : [activeAgentId];

    setMessages((m) => [...m, { role: "user", content: userText }, { role: "agent", content: "" }]);
    chatOnNewMessage();
    setBusy(true);
    try {
      // Pass session + agent routing headers for Telegram-speed dispatch
      const session = getSession(activeAgentId);
      await streamChat(
        {
          conversationId,
          message: userText,
          agentId: activeAgentId,
          sessionId: session?.sessionId,
          collaborators: respondingAgents.length > 1 ? respondingAgents : undefined,
        },
        (delta) => {
          // Parse [THEME:*] UI-Hints from agent output
          const themeMatch = delta.match(THEME_TAG_RE);
          if (themeMatch) {
            const key = themeMatch[1].toUpperCase();
            if (THEME_COLORS[key]) {
              setThemeAccent(THEME_COLORS[key]);
            }
          }
          // Strip theme tags from visible content
          const clean = delta.replace(THEME_STRIP_RE, "");
          if (clean) {
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              if (last?.role === "agent") last.content += clean;
              return copy;
            });
            chatOnStreamDelta();
          }
        },
        undefined,
        {
          agentId: activeAgentId,
          sessionId: session?.sessionId,
          collaborators: respondingAgents.length > 1 ? respondingAgents : undefined,
        },
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      loadSessions(activeAgentId);
    }
  }

  async function handleLogout() {
    try { await logout(); } catch { /* ignore */ } finally {
      setAuthed(false); setAgents([]); setConversationId(null); setMessages([]);
    }
  }

  const clearSuggestion = useCallback(() => setSuggestedText(""), []);

  // Snap chat to bottom when switching agents (messages replaced)
  useEffect(() => { chatSnapToBottom(); }, [activeAgentId, chatSnapToBottom]);

  // Keyboard shortcut: Cmd+K for search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearchOpen((s) => !s); }
      if (e.key === "Escape") { setSearchOpen(false); setNotesOpen(false); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Search handler — tries API (D1) first, falls back to localStorage
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const data = await apiGet<{ results: Record<string, { id: string; title: string; preview: string; type: string }[]> }>(`/search?q=${encodeURIComponent(searchQuery)}`);
        const apiResults: Doc[] = [];
        for (const [collection, items] of Object.entries(data.results || {})) {
          for (const item of items) {
            apiResults.push({
              id: item.id,
              collection,
              searchText: `${item.title} ${item.preview}`,
              tags: [item.type],
              meta: item,
              createdAt: "",
              updatedAt: "",
            });
          }
        }
        if (apiResults.length > 0) {
          setSearchResults(apiResults);
          return;
        }
      } catch {
        // D1/API not available — fall through to localStorage
      }
      setSearchResults(searchAll(searchQuery, 15));
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  /* ─── Add Agent Dialog ─── */
  const [newAgentId, setNewAgentId] = useState("");
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentEmoji, setNewAgentEmoji] = useState("🤖");
  const [newAgentModel, setNewAgentModel] = useState("");
  const [newAgentParent, setNewAgentParent] = useState("");
  const [newAgentDesc, setNewAgentDesc] = useState("");

  /* ─── Notes helpers ─── */
  const allNotes = useMemo(() => getNotes(), [notesTick]); // eslint-disable-line react-hooks/exhaustive-deps
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
      <header className="shrink-0 z-40 glass border-b border-white/5">
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
                onClick={() => handleSwitchTab(t.key)}
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
              onClick={() => handleSwitchTab(t.key)}
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
    function toggleExpand(id: string) {
      setExpandedAgents((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    }
    function toggleCollab(id: string) {
      setCollabAgentIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    }
    function sessionStatus(id: string) {
      const s = agentSessions[id];
      if (!s) return "disconnected";
      return s.status;
    }
    const statusDot: Record<string, string> = {
      connected: "bg-emerald-500",
      busy: "bg-amber-500",
      disconnected: "bg-zinc-600",
    };

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
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCollabMode((c) => !c)}
                  className={cx("text-[10px] px-1.5 py-0.5 rounded-md transition",
                    collabMode ? "bg-indigo-500/20 text-indigo-400" : "text-zinc-500 hover:text-zinc-300"
                  )}
                  title="Toggle collaboration mode"
                >👥 Collab</button>
                <button onClick={() => setAddAgentOpen(true)} className="text-[10px] text-zinc-500 hover:text-zinc-300 px-1 transition" title="Add agent">＋</button>
              </div>
            </div>
            <div className="space-y-0.5">
              {agentTree.map((a) => {
                const st = sessionStatus(a.id);
                const children = a.children || [];
                const isExpanded = expandedAgents.has(a.id);
                return (
                  <div key={a.id}>
                    <div className="flex items-center gap-1">
                      {/* Expand toggle (only if has sub-agents) */}
                      {children.length > 0 ? (
                        <button onClick={() => toggleExpand(a.id)} className="text-[10px] text-zinc-500 w-4 shrink-0">{isExpanded ? "▾" : "▸"}</button>
                      ) : <span className="w-4 shrink-0" />}

                      {/* Collab checkbox */}
                      {collabMode && (
                        <input type="checkbox" checked={collabAgentIds.has(a.id)} onChange={() => toggleCollab(a.id)}
                          className="h-3 w-3 rounded border-zinc-600 bg-transparent accent-indigo-500 shrink-0" />
                      )}

                      <button
                        onClick={() => handleSwitchAgent(a.id)}
                        className={cx(
                          "flex-1 text-left rounded-xl px-2.5 py-2 transition-all min-w-0",
                          a.id === activeAgentId
                            ? "bg-white/10 border border-white/10"
                            : "hover:bg-white/5"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm shrink-0">{a.emoji}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-white truncate">{a.name}</div>
                            <div className="text-[10px] text-zinc-500 truncate">{a.model || a.id}</div>
                          </div>
                          <span className={cx("relative flex h-2 w-2 shrink-0", statusDot[st])}>
                            {st === "connected" && a.id === activeAgentId && (
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            )}
                            <span className={cx("relative inline-flex rounded-full h-2 w-2", statusDot[st])} />
                          </span>
                        </div>
                      </button>
                    </div>

                    {/* Sub-agents */}
                    {isExpanded && children.length > 0 && (
                      <div className="ml-5 mt-0.5 space-y-0.5 border-l border-white/5 pl-2">
                        {children.map((sub) => {
                          const subSt = sessionStatus(sub.id);
                          return (
                            <div key={sub.id} className="flex items-center gap-1">
                              {collabMode && (
                                <input type="checkbox" checked={collabAgentIds.has(sub.id)} onChange={() => toggleCollab(sub.id)}
                                  className="h-3 w-3 rounded border-zinc-600 bg-transparent accent-indigo-500 shrink-0" />
                              )}
                              <button
                                onClick={() => handleSwitchAgent(sub.id)}
                                className={cx(
                                  "flex-1 text-left rounded-lg px-2 py-1.5 transition-all min-w-0",
                                  sub.id === activeAgentId ? "bg-white/10 border border-white/10" : "hover:bg-white/5"
                                )}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-xs">{sub.emoji}</span>
                                  <span className="text-[11px] text-zinc-300 truncate">{sub.name}</span>
                                  <span className={cx("ml-auto relative flex h-1.5 w-1.5 shrink-0 rounded-full", statusDot[subSt])} />
                                </div>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {agents.length === 0 && (
                <div className="text-xs text-zinc-500 py-3 text-center">No agents connected</div>
              )}
            </div>
            {collabMode && collabAgentIds.size > 0 && (
              <div className="mt-2 pt-2 border-t border-white/5 text-[10px] text-indigo-400">
                👥 {collabAgentIds.size} agent{collabAgentIds.size > 1 ? "s" : ""} selected for collaboration
              </div>
            )}
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
              <button onClick={() => { handleSwitchTab("research"); apiPost("/research/scan", {}).catch(() => {}); }} className="w-full text-left rounded-lg hover:bg-white/5 px-2.5 py-1.5 text-xs text-zinc-400 transition">🌐 Scan Web</button>
              <button onClick={() => { handleSwitchTab("notes"); setNotesOpen(true); }} className="w-full text-left rounded-lg hover:bg-white/5 px-2.5 py-1.5 text-xs text-zinc-400 transition">📝 Knowledge Base</button>
              <button onClick={() => setSearchOpen(true)} className="w-full text-left rounded-lg hover:bg-white/5 px-2.5 py-1.5 text-xs text-zinc-400 transition">🔍 Search Everything</button>
              <button onClick={() => { handleSwitchTab("skills"); setTimeout(() => document.getElementById("skills-continue")?.scrollIntoView({ behavior: "smooth" }), 100); }} className="w-full text-left rounded-lg hover:bg-white/5 px-2.5 py-1.5 text-xs text-zinc-400 transition">🧠 Continue Learning</button>
              <button onClick={() => { handleSwitchTab("jobs"); apiPost("/jobs/refresh", {}).catch(() => {}); }} className="w-full text-left rounded-lg hover:bg-white/5 px-2.5 py-1.5 text-xs text-zinc-400 transition">💼 Check Job Feed</button>
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
        { text: "My teams today", prompt: "Check scores and updates for the Knicks (NBA), Chargers (NFL), Tottenham (EPL), Gamecocks (NCAA), and Padres (MLB). What's happening today?" },
        { text: "Game predictions", prompt: "Give me predictions and analysis for today's Knicks, Chargers, Tottenham, Gamecocks, and Padres games." },
      ],
      stocks: [
        { text: "Market analysis", prompt: "Give me a brief analysis of today's market movements and cybersecurity stock performance." },
        { text: "Portfolio review", prompt: "Review my watchlist stocks: AAPL, MSFT, CRWD, PANW, NET." },
      ],
      research: [
        { text: "Latest cyber news", prompt: "What are the most important cybersecurity news stories from today?" },
        { text: "Deep dive topic", prompt: "Give me a deep dive lesson on a cutting-edge cybersecurity topic." },
      ],
      notes: [
        { text: "Organize my notes", prompt: "Help me organize and categorize my notes across all workspaces." },
        { text: "Summarize recent notes", prompt: "Give me a summary of my most recent notes and key takeaways." },
      ],
      settings: [
        { text: "System status", prompt: "Show me the current status of all my connectors and integrations." },
        { text: "Optimize my setup", prompt: "Suggest improvements for my My Control Center configuration." },
      ],
    };

    const suggestions = suggestionsMap[activeTab] || suggestionsMap.home;

    return (
      <section className={cx("glass-light rounded-2xl flex flex-col h-full min-h-0", glowMap[activeTab])}>
        {/* A) Sticky header with session controls */}
        <div className="shrink-0 p-3 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">{activeAgent?.emoji || "🤖"}</span>
            <div>
              <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                {lessonContext ? `📖 ${lessonContext.lessonTitle}` : (activeAgent?.name || "Agent")}
                {agentSessions[activeAgentId]?.status === "connected" && (
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" title="Connected — no cold start" />
                )}
              </div>
              <div className="text-[10px] text-zinc-500">
                {lessonContext ? lessonContext.moduleTitle || "Lesson chat" : (activeAgent?.model || `${tabMeta.icon} ${tabMeta.label}`)}
                {collabMode && collabAgentIds.size > 0 && ` · 👥 ${collabAgentIds.size} collab`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lessonContext && (
              <button
                onClick={() => { setLessonContext(null); handleNewChat(); }}
                className="text-[10px] text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg px-2 py-1 transition"
                title="Back to general chat"
              >← General</button>
            )}
            <button
              onClick={() => { setLessonContext(null); handleNewChat(); }}
              className="text-[10px] text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg px-2 py-1 transition"
              title="New chat"
            >＋ New</button>
            <button
              onClick={() => setSessionsOpen((s) => !s)}
              className="text-[10px] text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg px-2 py-1 transition"
              title="Chat history"
            >📋 {chatSessions.length > 0 ? chatSessions.length : ""}</button>
          </div>
        </div>

        {/* Session list dropdown */}
        {sessionsOpen && (
          <div className="shrink-0 border-b border-white/5 max-h-48 overflow-y-auto bg-black/20">
            {chatSessions.length === 0 && (
              <div className="text-[10px] text-zinc-500 text-center py-3">No saved sessions</div>
            )}
            {chatSessions.map((s) => (
              <div
                key={s.id}
                className={cx(
                  "px-3 py-2 text-xs transition hover:bg-white/5 flex items-center gap-2 group",
                  s.id === conversationId ? "text-white bg-white/5" : "text-zinc-400"
                )}
              >
                {editingSessionId === s.id ? (
                  <input
                    autoFocus
                    className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleRenameSession(s.id, editingTitle); if (e.key === "Escape") setEditingSessionId(null); }}
                    onBlur={() => handleRenameSession(s.id, editingTitle)}
                  />
                ) : (
                  <button onClick={() => handleSelectSession(s.id)} className="flex-1 text-left truncate min-w-0">
                    {s.pinned ? "📌 " : ""}{s.title}
                  </button>
                )}
                <span className="text-[9px] text-zinc-600 shrink-0">
                  {new Date(s.updated_at).toLocaleDateString()}
                </span>
                <button
                  onClick={() => { setEditingSessionId(s.id); setEditingTitle(s.title); }}
                  className="text-[10px] text-zinc-500 hover:text-white opacity-0 group-hover:opacity-100 transition shrink-0"
                  title="Rename"
                >✏️</button>
                <button
                  onClick={() => { if (confirm("Delete this chat and all its messages?")) handleDeleteSession(s.id); }}
                  className="text-[10px] text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition shrink-0"
                  title="Delete"
                >🗑️</button>
              </div>
            ))}
          </div>
        )}

        {/* B) Scrollable messages */}
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 relative">
          {messages.length === 0 && (
            <div className="text-center py-8 animate-fade-in" role="status">
              <div className="text-3xl mb-3">{tabMeta.icon}</div>
              <div className="text-sm font-semibold text-white mb-1">{tabMeta.label} Agent</div>
              <div className="text-xs text-zinc-400 mb-4">{tabMeta.description}</div>
              <div className="grid gap-2 sm:grid-cols-2 max-w-sm mx-auto">
                {suggestions.map((s) => (
                  <button
                    key={s.text}
                    className="text-left rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 px-3 py-2.5 text-xs text-zinc-300 transition"
                    onClick={() => setSuggestedText(s.prompt)}
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
                "rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words",
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
        </div>

        {/* Jump to latest indicator */}
        {!chatAtBottom && messages.length > 0 && (
          <div className="shrink-0 flex justify-center -mt-10 relative z-10 pointer-events-none">
            <button
              onClick={chatJumpToBottom}
              className="pointer-events-auto rounded-full bg-white/10 backdrop-blur border border-white/10 px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-white/20 transition shadow-lg flex items-center gap-1.5"
            >
              ↓ Jump to latest{chatUnread > 0 && <span className="bg-indigo-500 text-white rounded-full px-1.5 text-[10px] font-semibold">{chatUnread}</span>}
            </button>
          </div>
        )}

        {/* File attachments */}
        {chatFiles.length > 0 && (
          <div className="shrink-0 px-3 py-2 border-t border-white/5 flex gap-2 overflow-x-auto">
            {chatFiles.map((f) => (
              <a
                key={f.id}
                href={`/api/files/${f.id}/download`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-[10px] text-zinc-300 hover:bg-white/10 transition shrink-0"
                title={`Download ${f.name}`}
              >
                📄 <span className="truncate max-w-[100px]">{f.name}</span>
                <span className="text-zinc-500">{f.size < 1024 ? `${f.size}B` : `${Math.round(f.size / 1024)}KB`}</span>
              </a>
            ))}
          </div>
        )}

        {/* C) Sticky input */}
        <MessageInput
          onSend={send}
          busy={busy}
          placeholder={`Message ${activeAgent?.name || "agent"}…`}
          gradient={tabMeta.gradient}
          suggestedText={suggestedText}
          onSuggestionConsumed={clearSuggestion}
          onFileUpload={handleFileUpload}
        />
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
              {searchResults.map((doc) => {
                const collToTab: Record<string, TabKey> = { notes: "notes", assignments: "school", jobs: "jobs", research: "research", sessions: "home" };
                const targetTab = collToTab[doc.collection] || "home";
                return (
                <button
                  key={doc.id}
                  className="w-full text-left rounded-xl px-3 py-2.5 hover:bg-white/5 transition"
                  onClick={() => { handleSwitchTab(targetTab); setSearchOpen(false); setSearchQuery(""); }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-500 uppercase bg-white/5 rounded px-1.5 py-0.5">{doc.collection}</span>
                    <span className="text-xs text-white truncate">{(doc.meta as Record<string, string>)?.title || doc.searchText.slice(0, 60)}</span>
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 flex gap-2">
                    {doc.tags.slice(0, 3).map((t) => <span key={t} className="bg-white/5 rounded px-1">{t}</span>)}
                  </div>
                </button>
                );
              })}
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
     ADD AGENT DIALOG
     ═══════════════════════════════════════════════════ */
  function AddAgentDialog() {
    if (!addAgentOpen) return null;

    function handleAdd() {
      if (!newAgentId.trim() || !newAgentName.trim()) return;
      const agent = addAgentToRegistry({
        id: newAgentId.trim(),
        name: newAgentName.trim(),
        emoji: newAgentEmoji || "🤖",
        model: newAgentModel || undefined,
        parentId: newAgentParent || null,
        description: newAgentDesc || undefined,
        capabilities: [],
      });
      setAgents((prev) => [...prev, agent]);
      // Connect the new agent immediately — no cold start
      connectAll([agent]);
      setAddAgentOpen(false);
      setNewAgentId(""); setNewAgentName(""); setNewAgentEmoji("🤖"); setNewAgentModel(""); setNewAgentParent(""); setNewAgentDesc("");
    }

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setAddAgentOpen(false)}>
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div className="relative w-full max-w-md mx-4 animate-slide-up" onClick={(e) => e.stopPropagation()}>
          <div className="glass rounded-2xl overflow-hidden border border-white/10 shadow-2xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">➕ Add Agent</h2>
            <div className="grid grid-cols-[48px_1fr] gap-2">
              <input className="rounded-lg bg-white/5 border border-white/10 px-2 py-2 text-center text-sm text-white outline-none" placeholder="🤖" value={newAgentEmoji} onChange={(e) => setNewAgentEmoji(e.target.value)} maxLength={4} />
              <input className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none" placeholder="Agent name" value={newAgentName} onChange={(e) => setNewAgentName(e.target.value)} />
            </div>
            <input className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none" placeholder="Unique ID (e.g. research-agent)" value={newAgentId} onChange={(e) => setNewAgentId(e.target.value)} />
            <input className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none" placeholder="Model (e.g. openai-codex/gpt-5.3-codex)" value={newAgentModel} onChange={(e) => setNewAgentModel(e.target.value)} />
            <select className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-zinc-400 outline-none" value={newAgentParent} onChange={(e) => setNewAgentParent(e.target.value)}>
              <option value="">No parent (top-level agent)</option>
              {agents.filter((a) => !a.parentId).map((a) => (
                <option key={a.id} value={a.id}>{a.emoji} {a.name} (sub-agent of)</option>
              ))}
            </select>
            <input className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 outline-none" placeholder="Description (optional)" value={newAgentDesc} onChange={(e) => setNewAgentDesc(e.target.value)} />
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setAddAgentOpen(false)} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white transition">Cancel</button>
              <button onClick={handleAdd} disabled={!newAgentId.trim() || !newAgentName.trim()} className="px-4 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 text-xs font-medium hover:bg-indigo-500/30 disabled:opacity-30 transition">Add Agent</button>
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

  // Main dashboard — full-height, no page scroll
  return (
    <main className="h-screen flex flex-col overflow-hidden bg-[#050507] text-white" style={{ "--theme-accent": themeAccent } as React.CSSProperties}>
      {Header()}

      <div className="mx-auto max-w-[1600px] flex flex-1 min-h-0 w-full">
        {Sidebar()}

        <div className="flex-1 p-3 md:p-4 min-w-0 min-h-0 flex flex-col">
          {/* Desktop: side-by-side dual-pane, internal scroll only */}
          <div className="hidden md:grid md:grid-cols-[1fr_420px] gap-4 flex-1 min-h-0">
            {ChatPanel()}
            <div className="overflow-y-auto min-h-0 space-y-3 pb-4">
              <WidgetPanel activeTab={activeTab} onLessonClick={openLessonChat} />
            </div>
          </div>

          {/* Mobile: stacked with chat toggle */}
          <div className="md:hidden flex-1 min-h-0 flex flex-col">
            {!mobileChatOpen && (
              <div className="flex-1 overflow-y-auto space-y-3">
                <WidgetPanel activeTab={activeTab} onLessonClick={openLessonChat} />
              </div>
            )}
            {mobileChatOpen && ChatPanel()}
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
      {CommandPalette()}
      {NotesDrawer()}
      {AddAgentDialog()}
    </main>
  );
}

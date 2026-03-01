"use client";

import { useEffect, useMemo, useState } from "react";
import Login from "../components/Login";
import { apiGet, apiPost, streamChat, authMe, logout } from "@/lib/api";

type Agent = { id: string; name: string; emoji: string };
type Msg = { role: "user" | "agent"; content: string };

type TabKey =
  | "home"
  | "school"
  | "jobs"
  | "skills"
  | "sports"
  | "stocks"
  | "research";

const TABS: { key: TabKey; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "school", label: "School" },
  { key: "jobs", label: "Jobs" },
  { key: "skills", label: "Skills" },
  { key: "sports", label: "Sports" },
  { key: "stocks", label: "Stocks" },
  { key: "research", label: "Research" },
];

function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

export default function Home() {
  // ---- auth ----
  const [authed, setAuthed] = useState<boolean | null>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // agents
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string>("main");

  // chat
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeAgent = useMemo(
    () => agents.find((a) => a.id === activeAgentId),
    [agents, activeAgentId]
  );

  async function refreshAuthAndBootstrap() {
    setError(null);

    try {
      const me = await authMe();
      setAuthed(me.authed);

      if (!me.authed) {
        // clear state when logged out / not authed
        setAgents([]);
        setConversationId(null);
        setMessages([]);
        return;
      }

      // load agents
      const data = await apiGet<{ agents: Agent[] }>("/api/agents");
      const list = data.agents || [];
      setAgents(list);

      const nextAgentId = list.find((a) => a.id === activeAgentId)?.id
        ? activeAgentId
        : list[0]?.id || "main";
      setActiveAgentId(nextAgentId);
    } catch (e: any) {
      setAuthed(false);
      setError(String(e?.message || e));
    }
  }

  // initial auth check
  useEffect(() => {
    refreshAuthAndBootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function newConversation(agentId: string) {
    const data = await apiPost("/api/conversations", {
      agentId,
      title: `${agentId} chat`,
    });
    setConversationId(data.conversationId);
    setMessages([]);
  }

  // auto create a conversation when agent changes (only if authed)
  useEffect(() => {
    if (!authed) return;
    if (!agents.length) return;

    newConversation(activeAgentId).catch((e: any) =>
      setError(String(e?.message || e))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgentId, authed, agents.length]);

  async function send() {
    if (!conversationId || !text.trim() || busy) return;

    setError(null);
    const userText = text.trim();
    setText("");

    setMessages((m) => [
      ...m,
      { role: "user", content: userText },
      { role: "agent", content: "" },
    ]);

    setBusy(true);

    try {
      await streamChat(
        { conversationId, message: userText },
        (delta) => {
          setMessages((m) => {
            const copy = [...m];
            const last = copy[copy.length - 1];
            if (last?.role === "agent") last.content += delta;
            return copy;
          });
        }
      );
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // ignore
    } finally {
      setAuthed(false);
      setAgents([]);
      setConversationId(null);
      setMessages([]);
    }
  }

  // ---------- UI building blocks ----------
  function Header() {
    return (
      <header className="sticky top-0 z-30 bg-black/70 backdrop-blur border-b border-zinc-900">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3">
          <button
            className="md:hidden rounded-lg border border-zinc-800 px-3 py-2 text-sm hover:bg-zinc-900"
            onClick={() => setSidebarOpen((s) => !s)}
            aria-label="Toggle sidebar"
          >
            ☰
          </button>

          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-zinc-900 border border-zinc-800 grid place-items-center text-sm">
              MCC
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">My Control Center</div>
              <div className="text-xs text-zinc-400">
                {activeAgent?.emoji} {activeAgent?.name || "—"}
              </div>
            </div>
          </div>

          <nav className="ml-auto hidden md:flex items-center gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={cx(
                  "px-3 py-2 rounded-lg text-sm border transition",
                  activeTab === t.key
                    ? "bg-white text-black border-white"
                    : "bg-zinc-950 text-zinc-200 border-zinc-900 hover:bg-zinc-900"
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <button
            className="ml-2 hidden md:inline-flex rounded-lg border border-zinc-800 px-3 py-2 text-sm hover:bg-zinc-900"
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>

        {/* mobile tabs + logout */}
        <div className="md:hidden px-4 pb-3 flex gap-2 overflow-auto items-center">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cx(
                "whitespace-nowrap px-3 py-2 rounded-lg text-sm border transition",
                activeTab === t.key
                  ? "bg-white text-black border-white"
                  : "bg-zinc-950 text-zinc-200 border-zinc-900 hover:bg-zinc-900"
              )}
            >
              {t.label}
            </button>
          ))}
          <button
            className="ml-auto whitespace-nowrap rounded-lg border border-zinc-800 px-3 py-2 text-sm hover:bg-zinc-900"
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
      </header>
    );
  }

  function Sidebar() {
    return (
      <aside
        className={cx(
          "md:sticky md:top-[72px] md:h-[calc(100vh-72px)] md:block",
          "md:w-[320px] shrink-0",
          sidebarOpen ? "block" : "hidden"
        )}
      >
        <div className="h-full p-4">
          <div className="rounded-2xl bg-zinc-950 border border-zinc-900 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100">Agents</h2>
              <span className="text-xs text-zinc-500">{agents.length}</span>
            </div>

            <div className="mt-3 space-y-2">
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setActiveAgentId(a.id)}
                  className={cx(
                    "w-full text-left rounded-xl px-3 py-2 border transition",
                    a.id === activeAgentId
                      ? "bg-zinc-900 border-zinc-700"
                      : "bg-zinc-950 border-zinc-900 hover:bg-zinc-900"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{a.emoji}</span>
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{a.name}</div>
                      <div className="text-[11px] text-zinc-400">ID: {a.id}</div>
                    </div>
                    <div className="ml-auto text-zinc-500">›</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-zinc-900 text-xs text-zinc-500">
              Tip: pick an agent, then use tabs to switch workspaces.
            </div>
          </div>
        </div>
      </aside>
    );
  }

  function WidgetPanel() {
    const Card = (props: { title: string; children: any }) => (
      <div className="rounded-2xl bg-zinc-950 border border-zinc-900 p-4">
        <div className="text-sm font-semibold">{props.title}</div>
        <div className="mt-2 text-sm text-zinc-300">{props.children}</div>
      </div>
    );

    if (activeTab === "sports")
      return (
        <div className="space-y-3">
          <Card title="Recent Scores">Hook your sports agent later → sidebar feed.</Card>
          <Card title="Watchlist">Teams / players you track.</Card>
        </div>
      );

    if (activeTab === "stocks")
      return (
        <div className="space-y-3">
          <Card title="Market Pulse">Watchlist + % change (later).</Card>
          <Card title="News">Top headlines (later).</Card>
        </div>
      );

    if (activeTab === "jobs")
      return (
        <div className="space-y-3">
          <Card title="New Postings">Your job agent will drop links here.</Card>
          <Card title="Outreach">Templates + follow-ups.</Card>
        </div>
      );

    if (activeTab === "skills")
      return (
        <div className="space-y-3">
          <Card title="Skill Progress">
            Splunk, Security+, etc. (progress bars later).
          </Card>
          <Card title="Next Lesson">Clickable lesson plan cards later.</Card>
        </div>
      );

    if (activeTab === "school")
      return (
        <div className="space-y-3">
          <Card title="Assignments">Due dates feed (later).</Card>
          <Card title="Notes">Quick notes + study plans (later).</Card>
        </div>
      );

    if (activeTab === "research")
      return (
        <div className="space-y-3">
          <Card title="Reading Queue">Papers + links + summaries (later).</Card>
          <Card title="Drafts">Writeups and outlines.</Card>
        </div>
      );

    return (
      <div className="space-y-3">
        <Card title="Today">Top 3 tasks + quick actions.</Card>
        <Card title="Quick Links">Dashboard, Resume, GitHub, Notes.</Card>
      </div>
    );
  }

  function ChatPanel() {
    return (
      <section className="rounded-2xl bg-zinc-950 border border-zinc-900 flex flex-col min-h-[72vh]">
        <div className="p-4 border-b border-zinc-900 flex items-center justify-between">
          <div className="font-semibold text-sm">
            {activeAgent?.emoji} {activeAgent?.name}
            <span className="ml-2 text-xs text-zinc-500">
              • {activeTab.toUpperCase()}
            </span>
          </div>
          <div className="text-xs text-zinc-500">
            convo: {conversationId?.slice(0, 8)}…
          </div>
        </div>

        <div className="flex-1 p-4 overflow-auto space-y-3">
          {messages.length === 0 && (
            <div className="text-zinc-400 text-sm">
              Start in <span className="text-white">{activeTab}</span>. Try:
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <button
                  className="text-left rounded-xl border border-zinc-900 bg-black/40 hover:bg-zinc-900 px-3 py-2 text-sm"
                  onClick={() =>
                    setText("Give me a concise plan for today with 3 priorities.")
                  }
                >
                  Plan my day → 3 priorities
                </button>
                <button
                  className="text-left rounded-xl border border-zinc-900 bg-black/40 hover:bg-zinc-900 px-3 py-2 text-sm"
                  onClick={() =>
                    setText(
                      "Ask me 3 quick questions to personalize your help in this workspace."
                    )
                  }
                >
                  Personalize this workspace
                </button>
              </div>
            </div>
          )}

          {messages.map((m, idx) => (
            <div key={idx} className={cx("max-w-[92%]", m.role === "user" && "ml-auto")}>
              <div
                className={cx(
                  "rounded-2xl px-3 py-2 border text-sm whitespace-pre-wrap",
                  m.role === "user"
                    ? "bg-white text-black border-white"
                    : "bg-black/40 text-white border-zinc-900"
                )}
              >
                {m.content}
              </div>
            </div>
          ))}

          {error && (
            <div className="text-sm text-red-300 bg-red-950/40 border border-red-900 rounded-xl p-3">
              {error}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-zinc-900 flex gap-2">
          <input
            className="flex-1 rounded-xl bg-black border border-zinc-800 px-3 py-2 outline-none text-sm"
            placeholder={`Message ${activeAgent?.name || "agent"}...`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={busy}
          />
          <button
            className="rounded-xl bg-white text-black px-4 font-semibold disabled:opacity-50"
            disabled={busy || !text.trim()}
            onClick={send}
          >
            {busy ? "..." : "Send"}
          </button>
        </div>
      </section>
    );
  }

  // ---------- ROUTING ----------
  if (authed === null) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-sm text-zinc-400">Loading...</div>
      </main>
    );
  }

  // Not authed → show password login screen
  if (!authed) {
    return <Login onSuccess={refreshAuthAndBootstrap} />;
  }

  // ---------- main app ----------
  return (
    <main className="min-h-screen bg-black text-white">
      <Header />

      <div className="mx-auto max-w-7xl grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4">
        <Sidebar />

        <div className="p-4 md:p-6 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          <ChatPanel />
          <div className="space-y-4">
            <div className="rounded-2xl bg-zinc-950 border border-zinc-900 p-4">
              <div className="text-sm font-semibold">Workspace</div>
              <div className="mt-1 text-xs text-zinc-500">
                Tab controls what widgets show on the right.
              </div>
            </div>
            <WidgetPanel />
          </div>
        </div>
      </div>
    </main>
  );
}
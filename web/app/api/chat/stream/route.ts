export const runtime = "edge";
// web/app/api/chat/stream/route.ts

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1 } from "@/lib/d1";

/** Read an env var from process.env. */
function getEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * Try to persist a chat message to D1. Non-blocking — never fails the stream.
 */
async function persistMessage(
  userId: string,
  sessionId: string | null,
  agentId: string | null,
  role: "user" | "agent" | "system",
  content: string,
) {
  if (!sessionId || !content) return;
  const db = getD1();
  if (!db) return;

  try {
    const now = new Date().toISOString();
    const msgId = crypto.randomUUID();

    // Auto-create session if it doesn't exist yet
    const existing = await db
      .prepare(`SELECT id FROM chat_sessions WHERE id = ?`)
      .bind(sessionId)
      .first();

    if (!existing) {
      await db
        .prepare(
          `INSERT INTO chat_sessions (id, user_id, agent_id, title, created_at, updated_at)
           VALUES (?, ?, ?, 'New chat', ?, ?)`
        )
        .bind(sessionId, userId, agentId || "main", now, now)
        .run();
    }

    await db
      .prepare(
        `INSERT INTO chat_messages (id, session_id, role, content, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(msgId, sessionId, role, content, now)
      .run();

    // Update session timestamp; auto-title from first user message
    if (role === "user") {
      const title = content.slice(0, 40) + (content.length > 40 ? "…" : "");
      await db
        .prepare(
          `UPDATE chat_sessions
           SET updated_at = ?,
               title = CASE WHEN title = 'New chat' THEN ? ELSE title END
           WHERE id = ?`
        )
        .bind(now, title, sessionId)
        .run();
    } else {
      await db
        .prepare(`UPDATE chat_sessions SET updated_at = ? WHERE id = ?`)
        .bind(now, sessionId)
        .run();
    }
  } catch (e) {
    console.error("[chat/stream] D1 persist error (non-fatal):", e);
  }
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session: authSession }) => {
    const upstream = getEnv("MCC_VPS_SSE_URL");
    if (!upstream) {
      return Response.json({ ok: false, error: "MCC_VPS_SSE_URL not configured — set it in .env.local (VPS) or wrangler.toml (Cloudflare)" }, { status: 500 });
    }

    // Parse body to extract session/agent info for persistence
    const bodyBytes = await req.arrayBuffer();
    let chatSessionId: string | null = null;
    let chatAgentId: string | null = null;
    let userMessage = "";
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bodyBytes)) as Record<string, unknown>;
      chatSessionId = (parsed.conversationId as string) || (parsed.sessionId as string) || null;
      chatAgentId = (parsed.agentId as string) || null;
      userMessage = (parsed.message as string) || "";
    } catch {
      // Body parse failed — continue without persistence
    }

    // Persist user message — await to ensure it's saved before stream ends
    if (userMessage && chatSessionId) {
      await persistMessage(authSession.user_id, chatSessionId, chatAgentId, "user", userMessage).catch(() => {});
    }

    // Build upstream request headers — agent context rides in headers
    // so the VPS can route to the warm agent without parsing the body
    const upstreamHeaders = new Headers();
    upstreamHeaders.set("Accept", "text/event-stream");
    upstreamHeaders.set("Content-Type", req.headers.get("content-type") || "application/json");
    upstreamHeaders.set("X-Request-Id", crypto.randomUUID());

    // Forward agent routing context as headers for instant dispatch
    const agentId = req.headers.get("x-agent-id");
    const sessionId = req.headers.get("x-agent-session");
    const collaborators = req.headers.get("x-collab-agents");
    if (agentId) upstreamHeaders.set("X-Agent-Id", agentId);
    if (sessionId) upstreamHeaders.set("X-Agent-Session", sessionId);
    if (collaborators) upstreamHeaders.set("X-Collab-Agents", collaborators);

    // Call VPS with keep-alive for connection reuse
    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: upstreamHeaders,
      body: bodyBytes,
      keepalive: true,
    });

    // If upstream fails, return useful info
    if (!upstreamRes.ok) {
      const ct = upstreamRes.headers.get("content-type") || "";
      const text = await upstreamRes.text().catch(() => "");
      if (ct.includes("application/json")) {
        try {
          const j = JSON.parse(text);
          return Response.json(
            { ok: false, error: "Upstream error", upstreamStatus: upstreamRes.status, upstream: j },
            { status: 502 }
          );
        } catch {
          // fall through
        }
      }
      return Response.json(
        { ok: false, error: "Upstream error", upstreamStatus: upstreamRes.status, upstreamText: text || `HTTP ${upstreamRes.status}` },
        { status: 502 }
      );
    }

    if (!upstreamRes.body) {
      return Response.json({ ok: false, error: "Upstream returned no body" }, { status: 502 });
    }

    // Stream through a TransformStream that intercepts SSE events for persistence
    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";
    let agentContent = "";
    let agentPersisted = false;
    const userId = authSession.user_id;

    const stream = new ReadableStream({
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) {
          // Persist accumulated agent response — await to ensure it's saved
          if (agentContent && chatSessionId && !agentPersisted) {
            agentPersisted = true;
            await persistMessage(userId, chatSessionId, chatAgentId, "agent", agentContent).catch(() => {});
          }
          controller.close();
          return;
        }

        // Forward raw bytes to client immediately
        controller.enqueue(value);

        // Parse SSE events to accumulate agent content (non-blocking)
        sseBuffer += decoder.decode(value, { stream: true });
        const chunks = sseBuffer.split("\n\n");
        sseBuffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const lines = chunk.split("\n").filter(Boolean);
          const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim() || "message";
          const dataLine = lines.find((l) => l.startsWith("data:"))?.slice(5).trim();
          if (!dataLine) continue;

          if (event === "delta" || event === "message") {
            try {
              const data = JSON.parse(dataLine) as { text?: string };
              if (typeof data.text === "string") {
                agentContent += data.text;
              }
            } catch {
              // Not JSON delta — might be raw text
              if (typeof dataLine === "string" && event === "delta") {
                agentContent += dataLine;
              }
            }
          }
        }
      },
      cancel() {
        // Persist partial agent response on early disconnect (only if not already done)
        if (agentContent && chatSessionId && !agentPersisted) {
          agentPersisted = true;
          persistMessage(userId, chatSessionId, chatAgentId, "agent", agentContent);
        }
        reader.cancel();
      },
    });

    // Stream response immediately — no buffering
    const headers = new Headers();
    headers.set("Content-Type", "text/event-stream; charset=utf-8");
    headers.set("Cache-Control", "no-cache, no-transform");
    headers.set("Connection", "keep-alive");
    headers.set("X-Accel-Buffering", "no");

    return new Response(stream, { status: 200, headers });
  });
}


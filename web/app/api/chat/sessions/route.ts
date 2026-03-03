export const runtime = "edge";
// web/app/api/chat/sessions/route.ts — List + Create chat sessions

import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { requireD1, d1ErrorResponse } from "@/lib/d1";

/**
 * GET /api/chat/sessions?agentId=...
 * Returns newest-first list of sessions for that agent (excludes archived).
 */
export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    try {
      const db = requireD1();
      const url = new URL(req.url);
      const agentId = url.searchParams.get("agentId");

      let results;
      if (agentId) {
        results = await db
          .prepare(
            `SELECT id, agent_id, title, created_at, updated_at, pinned, archived
             FROM chat_sessions
             WHERE user_id = ? AND agent_id = ? AND archived = 0
             ORDER BY pinned DESC, updated_at DESC
             LIMIT 50`
          )
          .bind(userId, agentId)
          .all();
      } else {
        results = await db
          .prepare(
            `SELECT id, agent_id, title, created_at, updated_at, pinned, archived
             FROM chat_sessions
             WHERE user_id = ? AND archived = 0
             ORDER BY pinned DESC, updated_at DESC
             LIMIT 50`
          )
          .bind(userId)
          .all();
      }

      return Response.json({ sessions: results.results });
    } catch (err) {
      return d1ErrorResponse("GET /api/chat/sessions", err);
    }
  });
}

/**
 * POST /api/chat/sessions
 * Creates a new session. Body: { agentId: string }
 */
export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    try {
      const db = requireD1();
      const body = await req.json() as { agentId?: string };
      const agentId = body.agentId;
      if (!agentId || typeof agentId !== "string") {
        return Response.json({ error: "agentId is required" }, { status: 400 });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await db
        .prepare(
          `INSERT INTO chat_sessions (id, user_id, agent_id, title, created_at, updated_at)
           VALUES (?, ?, ?, 'New chat', ?, ?)`
        )
        .bind(id, session.user_id, agentId, now, now)
        .run();

      return Response.json({ sessionId: id, title: "New chat" }, { status: 201 });
    } catch (err) {
      return d1ErrorResponse("POST /api/chat/sessions", err);
    }
  });
}

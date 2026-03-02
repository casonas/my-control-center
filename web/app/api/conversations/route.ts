export const runtime = "edge";
// web/app/api/conversations/route.ts

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1 } from "@/lib/d1";

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const body = await req.json().catch(() => ({})) as { agentId?: string; title?: string };
    const agentId = body.agentId || "main";
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Try D1 persistence; fall back to mock ID if unavailable
    const db = getD1();
    if (db) {
      try {
        await db
          .prepare(
            `INSERT INTO chat_sessions (id, user_id, agent_id, title, created_at, updated_at)
             VALUES (?, ?, ?, 'New chat', ?, ?)`
          )
          .bind(id, session.user_id, agentId, now, now)
          .run();
      } catch (e) {
        console.error("[conversations] D1 insert error (non-fatal):", e);
      }
    }

    return Response.json({ conversationId: id });
  });
}


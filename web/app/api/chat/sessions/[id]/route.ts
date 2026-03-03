export const runtime = "edge";
// web/app/api/chat/sessions/[id]/route.ts — Get / Update / Delete a chat session

import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { requireD1, d1ErrorResponse } from "@/lib/d1";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/chat/sessions/:id
 * Returns session metadata + messages ordered by created_at ASC.
 */
export async function GET(_req: Request, ctx: RouteContext) {
  return withReadAuth(async ({ userId }) => {
    try {
      const db = requireD1();
      const { id } = await ctx.params;

      const session = await db
        .prepare(
          `SELECT id, agent_id, title, created_at, updated_at, pinned, archived
           FROM chat_sessions WHERE id = ? AND user_id = ?`
        )
        .bind(id, userId)
        .first();

      if (!session) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }

      const messagesResult = await db
        .prepare(
          `SELECT id, role, content, created_at, meta_json
           FROM chat_messages WHERE session_id = ?
           ORDER BY created_at ASC`
        )
        .bind(id)
        .all();

      return Response.json({
        session,
        messages: messagesResult.results,
      });
    } catch (err) {
      return d1ErrorResponse("GET /api/chat/sessions/:id", err);
    }
  });
}

/**
 * PATCH /api/chat/sessions/:id
 * Body can include: { title?, pinned?, archived? }
 */
export async function PATCH(req: Request, ctx: RouteContext) {
  return withMutatingAuth(req, async ({ session: authSession }) => {
    try {
      const db = requireD1();
      const { id } = await ctx.params;
      const body = await req.json() as {
        title?: string;
        pinned?: boolean;
        archived?: boolean;
      };

      // Verify ownership
      const existing = await db
        .prepare(`SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?`)
        .bind(id, authSession.user_id)
        .first();

      if (!existing) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }

      const sets: string[] = [];
      const vals: unknown[] = [];

      if (typeof body.title === "string") {
        sets.push("title = ?");
        vals.push(body.title.slice(0, 200));
      }
      if (typeof body.pinned === "boolean") {
        sets.push("pinned = ?");
        vals.push(body.pinned ? 1 : 0);
      }
      if (typeof body.archived === "boolean") {
        sets.push("archived = ?");
        vals.push(body.archived ? 1 : 0);
      }

      if (sets.length === 0) {
        return Response.json({ error: "No fields to update" }, { status: 400 });
      }

      sets.push("updated_at = ?");
      vals.push(new Date().toISOString());
      vals.push(id);

      await db
        .prepare(`UPDATE chat_sessions SET ${sets.join(", ")} WHERE id = ?`)
        .bind(...vals)
        .run();

      return Response.json({ ok: true });
    } catch (err) {
      return d1ErrorResponse("PATCH /api/chat/sessions/:id", err);
    }
  });
}

/**
 * DELETE /api/chat/sessions/:id
 * Deletes session + cascades messages.
 */
export async function DELETE(req: Request, ctx: RouteContext) {
  return withMutatingAuth(req, async ({ session: authSession }) => {
    try {
      const db = requireD1();
      const { id } = await ctx.params;

      // Verify ownership
      const existing = await db
        .prepare(`SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?`)
        .bind(id, authSession.user_id)
        .first();

      if (!existing) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }

      // Messages cascade via FK ON DELETE CASCADE
      await db
        .prepare(`DELETE FROM chat_sessions WHERE id = ?`)
        .bind(id)
        .run();

      return Response.json({ ok: true });
    } catch (err) {
      return d1ErrorResponse("DELETE /api/chat/sessions/:id", err);
    }
  });
}

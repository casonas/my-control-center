export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ attachments: [] });
    const url = new URL(req.url);
    const ownerType = url.searchParams.get("ownerType");
    const ownerId = url.searchParams.get("ownerId");
    if (!ownerType || !ownerId) {
      return Response.json({ error: "ownerType and ownerId required" }, { status: 400 });
    }
    try {
      const r = await db.prepare(
        `SELECT a.id, a.owner_type, a.owner_id, a.file_id, a.created_at,
                f.name AS file_name, f.mime AS file_mime, f.size AS file_size
         FROM school_attachments a
         JOIN files f ON a.file_id = f.id
         WHERE a.user_id = ? AND a.owner_type = ? AND a.owner_id = ?
         ORDER BY a.created_at DESC`
      ).bind(userId, ownerType, ownerId).all();
      return Response.json({ attachments: r.results || [] });
    } catch (err) { return d1ErrorResponse("GET /api/school/attachments", err); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const body = (await req.json()) as {
        ownerType: string; ownerId: string; fileId: string;
      };
      const validOwner = ["course", "assignment", "note", "event"];
      if (!body.ownerType || !validOwner.includes(body.ownerType)) {
        return Response.json({ error: "Invalid ownerType" }, { status: 400 });
      }
      if (!body.ownerId || !body.fileId) {
        return Response.json({ error: "ownerId and fileId required" }, { status: 400 });
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO school_attachments (id, user_id, owner_type, owner_id, file_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(id, session.user_id, body.ownerType, body.ownerId, body.fileId, now).run();
      return Response.json({ ok: true, id }, { status: 201 });
    } catch (err) { return d1ErrorResponse("POST /api/school/attachments", err); }
  });
}

export async function DELETE(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      if (!id) return Response.json({ error: "id required" }, { status: 400 });
      await db.prepare(
        `DELETE FROM school_attachments WHERE id = ? AND user_id = ?`
      ).bind(id, session.user_id).run();
      return Response.json({ ok: true });
    } catch (err) { return d1ErrorResponse("DELETE /api/school/attachments", err); }
  });
}

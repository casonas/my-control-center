export const runtime = "edge";
// web/app/api/files/route.ts — List files + upload URL creation

import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";
import { getR2 } from "@/lib/cloudflare";

/**
 * GET /api/files?scopeType=...&scopeId=...
 * List files linked to a scope
 */
export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ files: [] });

    const url = new URL(req.url);
    const scopeType = url.searchParams.get("scopeType");
    const scopeId = url.searchParams.get("scopeId");

    try {
      let query: string;
      let params: unknown[];

      if (scopeType && scopeId) {
        query = `SELECT f.id, f.name, f.mime, f.size, f.created_at
                 FROM files f
                 JOIN file_links fl ON fl.file_id = f.id
                 WHERE fl.user_id = ? AND fl.scope = ? AND fl.scope_id = ?
                 ORDER BY f.created_at DESC`;
        params = [userId, scopeType, scopeId];
      } else {
        query = `SELECT id, name, mime, size, created_at
                 FROM files
                 WHERE user_id = ?
                 ORDER BY created_at DESC
                 LIMIT 50`;
        params = [userId];
      }

      const r = await db.prepare(query).bind(...params).all();
      return Response.json({ files: r.results || [] });
    } catch (err) {
      return d1ErrorResponse("GET /api/files", err);
    }
  });
}

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED_MIMES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/zip",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/**
 * POST /api/files — Create upload (stores metadata, returns upload info)
 * Body: { name, mime, size, scope?: { type, id } }
 */
export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const r2 = getR2();
    if (!r2) {
      return Response.json(
        {
          ok: false,
          where: "files/upload",
          hint: "R2 binding (FILES) not available. Check Pages → Settings → Bindings → R2 bucket name FILES.",
        },
        { status: 400 }
      );
    }

    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    try {
      const body = (await req.json()) as {
        name: string;
        mime: string;
        size: number;
        scope?: { type: string; id: string };
      };

      if (!body.name || !body.mime || !body.size) {
        return Response.json({ ok: false, error: "name, mime, and size are required" }, { status: 400 });
      }
      if (body.size > MAX_FILE_SIZE) {
        return Response.json(
          { ok: false, error: `File too large. Max ${MAX_FILE_SIZE / 1024 / 1024}MB` },
          { status: 400 }
        );
      }
      if (!ALLOWED_MIMES.has(body.mime) && !body.mime.startsWith("text/")) {
        return Response.json({ ok: false, error: `MIME type ${body.mime} not allowed` }, { status: 400 });
      }

      const userId = session.user_id;
      const fileId = crypto.randomUUID();
      const now = new Date();
      const safeName = body.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
      const storageKey = `${userId}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${fileId}_${safeName}`;

      await db
        .prepare(
          `INSERT INTO files (id, user_id, name, mime, size, storage, storage_key, created_at)
           VALUES (?, ?, ?, ?, ?, 'r2', ?, ?)`
        )
        .bind(fileId, userId, body.name, body.mime, body.size, storageKey, now.toISOString())
        .run();

      if (body.scope?.type && body.scope?.id) {
        const linkId = crypto.randomUUID();
        await db
          .prepare(
            `INSERT INTO file_links (id, user_id, file_id, scope, scope_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(linkId, userId, fileId, body.scope.type, body.scope.id, now.toISOString())
          .run();
      }

      return Response.json({
        ok: true,
        fileId,
        storageKey,
        uploadUrl: `/api/files/${fileId}/upload`,
      });
    } catch (err) {
      return d1ErrorResponse("POST /api/files", err);
    }
  });
}

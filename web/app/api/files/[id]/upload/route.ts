export const runtime = "edge";
// web/app/api/files/[id]/upload/route.ts — Upload file body to R2

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1 } from "@/lib/d1";
import { getR2 } from "@/lib/cloudflare";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });
    const r2 = getR2();
    if (!r2) {
      return Response.json(
        { ok: false, where: "files/upload", hint: "R2 binding (FILES) not available." },
        { status: 400 },
      );
    }

    const { id } = await ctx.params;

    try {
      const file = await db
        .prepare(`SELECT storage_key, mime, size FROM files WHERE id = ? AND user_id = ?`)
        .bind(id, session.user_id)
        .first<{ storage_key: string; mime: string; size: number }>();

      if (!file) {
        return Response.json({ ok: false, error: "File not found" }, { status: 404 });
      }

      const body = await req.arrayBuffer();
      if (body.byteLength > MAX_FILE_SIZE) {
        return Response.json({ ok: false, error: `File too large. Max ${MAX_FILE_SIZE / 1024 / 1024}MB` }, { status: 400 });
      }

      await r2.put(file.storage_key, body, {
        httpMetadata: { contentType: file.mime || "application/octet-stream" },
      });

      return Response.json({ ok: true });
    } catch {
      return Response.json({ ok: false, error: "Upload failed" }, { status: 500 });
    }
  });
}

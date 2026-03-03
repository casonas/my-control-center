export const runtime = "edge";
// web/app/api/files/[id]/download/route.ts — Download file from R2

import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

function getR2(): { get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null> } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@cloudflare/next-on-pages");
    const ctx = mod.getRequestContext();
    return ctx?.env?.FILES ?? null;
  } catch { return null; }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    const { id } = await params;
    const r2 = getR2();
    if (!r2) {
      return Response.json(
        { ok: false, where: "files/download", hint: "R2 not configured" },
        { status: 400 }
      );
    }

    try {
      const file = await db
        .prepare(`SELECT storage_key, name, mime FROM files WHERE id = ? AND user_id = ?`)
        .bind(id, userId)
        .first<{ storage_key: string; name: string; mime: string }>();

      if (!file) {
        return Response.json({ ok: false, error: "File not found" }, { status: 404 });
      }

      const obj = await r2.get(file.storage_key);
      if (!obj) {
        return Response.json({ ok: false, error: "File not found in storage" }, { status: 404 });
      }

      return new Response(obj.body, {
        headers: {
          "Content-Type": file.mime,
          "Content-Disposition": `attachment; filename="${file.name.replace(/"/g, '\\"')}"`,
          "Cache-Control": "private, max-age=300",
        },
      });
    } catch {
      return Response.json({ ok: false, error: "Download failed" }, { status: 500 });
    }
  });
}

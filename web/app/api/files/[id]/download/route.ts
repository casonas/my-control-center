export const runtime = "edge";
// web/app/api/files/[id]/download/route.ts — Download file from R2

import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

type R2ObjectLike = {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
};

type R2BucketLike = {
  get: (key: string) => Promise<R2ObjectLike | null>;
};

function getR2(): R2BucketLike | null {
  try {
    const sym = Symbol.for("__cloudflare-request-context__");
    const ctx = (globalThis as Record<symbol, unknown>)[sym] as
      | { env?: Record<string, unknown> }
      | undefined;
    const e = ctx?.env as unknown as { FILES?: R2BucketLike } | undefined;
    return e?.FILES ?? null;
  } catch {
    return null;
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    const r2 = getR2();
    if (!r2) {
      return Response.json(
        { ok: false, where: "files/download", hint: "R2 binding (FILES) not available. Check Pages bindings." },
        { status: 400 }
      );
    }

    const { id } = await ctx.params;

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

      const filename = file.name.replace(/"/g, '\\"');

      return new Response(obj.body, {
        headers: {
          "Content-Type": file.mime || obj.httpMetadata?.contentType || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, max-age=300",
        },
      });
    } catch {
      return Response.json({ ok: false, error: "Download failed" }, { status: 500 });
    }
  });
}

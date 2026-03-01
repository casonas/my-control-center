// web/app/api/debug/r2/route.ts
import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

type EnvLike = Record<string, unknown>;

type R2Like = {
  put: (key: string, value: ArrayBuffer | Uint8Array | string, opts?: { httpMetadata?: { contentType?: string } }) => Promise<void>;
  get: (key: string) => Promise<{ body: ReadableStream<Uint8Array> } | null>;
  delete: (key: string) => Promise<void>;
};

async function streamToText(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(out);
}

export async function GET() {
  const { env } = getRequestContext();
  const e = env as EnvLike;

  const FILES = e["FILES"] as unknown as R2Like | undefined;
  if (!FILES) {
    return Response.json({ ok: false, error: "FILES R2 binding missing" }, { status: 500 });
  }

  const key = `smoke/${crypto.randomUUID()}.txt`;
  const value = `hello-r2-${Date.now()}`;

  await FILES.put(key, value, { httpMetadata: { contentType: "text/plain" } });

  const obj = await FILES.get(key);
  if (!obj) {
    return Response.json({ ok: false, error: "R2 get returned null after put", key }, { status: 500 });
  }

  const readBack = await streamToText(obj.body);

  await FILES.delete(key);
  const afterDelete = await FILES.get(key);

  return Response.json({
    ok: true,
    binding: "FILES",
    wrote: { key, value },
    readBack,
    deleted: afterDelete === null,
  });
}

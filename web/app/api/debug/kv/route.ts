export const runtime = "edge";
// web/app/api/debug/kv/route.ts


type EnvLike = Record<string, unknown>;

type KVLike = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, opts?: { expirationTtl?: number }) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

export async function GET() {
  const e: EnvLike = {};

  const CACHE = e["CACHE"] as unknown as KVLike | undefined;
  if (!CACHE) {
    return Response.json({ ok: false, error: "CACHE KV binding missing" }, { status: 500 });
  }

  const key = `smoke:${crypto.randomUUID()}`;
  const value = `ok-${Date.now()}`;

  await CACHE.put(key, value, { expirationTtl: 60 }); // 60s TTL

  const got = await CACHE.get(key);

  await CACHE.delete(key);
  const afterDelete = await CACHE.get(key);

  return Response.json({
    ok: true,
    binding: "CACHE",
    wrote: { key, value },
    readBack: got,
    deleted: afterDelete === null,
  });
}

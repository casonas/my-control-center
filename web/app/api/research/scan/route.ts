export const runtime = "edge";
// web/app/api/research/scan/route.ts — Trigger research scan (stub, replaced in Task 5)

import { withMutatingAuth } from "@/lib/mutatingAuth";

export async function POST(req: Request) {
  return withMutatingAuth(req, async () => {
    return Response.json({ ok: true, note: "scan scheduled", newItems: 0, sources: 0, tookMs: 0 });
  });
}

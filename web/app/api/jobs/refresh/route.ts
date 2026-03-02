export const runtime = "edge";
// web/app/api/jobs/refresh/route.ts — Trigger job feed refresh (stub)

import { withMutatingAuth } from "@/lib/mutatingAuth";

export async function POST(req: Request) {
  return withMutatingAuth(req, async () => {
    return Response.json({ ok: true, note: "refresh scheduled", newJobs: 0, tookMs: 0 });
  });
}

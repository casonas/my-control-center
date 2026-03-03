export const runtime = "edge";
import { withMutatingAuth } from "@/lib/mutatingAuth";

export async function POST(req: Request) {
  return withMutatingAuth(req, async () => {
    // MVP: stub — in production this triggers the VPS/OpenClaw stocks agent
    // via the existing bridge endpoint (MCC_VPS_SSE_URL)
    return Response.json({ ok: true, note: "Insight generation triggered. The stocks agent will analyze your watchlist and store results." });
  });
}

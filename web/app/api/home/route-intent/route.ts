export const runtime = "edge";
// web/app/api/home/route-intent/route.ts — Classify user request and route to specialist

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

const ROUTES: [RegExp, string, string][] = [
  [/\b(job|career|resume|interview)\b/i, "jobs", "Routing to Jobs workspace"],
  [/\b(stock|market|portfolio|ticker)\b/i, "stocks", "Routing to Stocks workspace"],
  [/\b(sports?|game|score|odds|bet)\b/i, "sports", "Routing to Sports workspace"],
  [/\b(assignment|homework|class|study|school)\b/i, "school", "Routing to School workspace"],
  [/\b(skill|cert|cyber|security|learn)\b/i, "skills", "Routing to Skills workspace"],
  [/\b(research|article|news|paper)\b/i, "research", "Routing to Research workspace"],
];

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    try {
      const body = (await req.json()) as { message?: string };
      if (!body.message) {
        return Response.json({ error: "message required" }, { status: 400 });
      }

      const msg = body.message;

      for (const [pattern, route, label] of ROUTES) {
        if (pattern.test(msg)) {
          let handoff_id: string | undefined;

          const db = getD1();
          if (db) {
            try {
              handoff_id = crypto.randomUUID();
              const now = new Date().toISOString();
              await db
                .prepare(
                  `INSERT INTO home_agent_handoffs
                   (id, user_id, source_agent, target_agent, payload_json, status, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
                )
                .bind(
                  handoff_id,
                  session.user_id,
                  "home",
                  route,
                  JSON.stringify({ message: msg }),
                  "pending",
                  now,
                )
                .run();
            } catch {
              handoff_id = undefined;
            }
          }

          return Response.json({
            route,
            handoff_id,
            message: label,
          });
        }
      }

      return Response.json({
        route: "home",
        message: "Handling directly in Home workspace",
      });
    } catch (err) {
      return d1ErrorResponse("POST /api/home/route-intent", err);
    }
  });
}

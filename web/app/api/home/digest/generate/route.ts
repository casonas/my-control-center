export const runtime = "edge";
// web/app/api/home/digest/generate/route.ts — Generate a rule-based digest

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db)
      return Response.json({ error: "D1 not available" }, { status: 500 });

    try {
      const body = (await req.json()) as { type?: "morning" | "evening" };
      const digestType = body.type === "evening" ? "evening" : "morning";
      const userId = session.user_id;
      const dateKey = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();

      // Gather state
      const stateRow = await db
        .prepare(
          `SELECT due_count, unread_count, job_new_count
           FROM home_daily_state
           WHERE user_id = ? AND date_key = ?`,
        )
        .bind(userId, dateKey)
        .first<{
          due_count: number;
          unread_count: number;
          job_new_count: number;
        }>()
        .catch(() => null);

      const dueCount = stateRow?.due_count ?? 0;
      const unreadCount = stateRow?.unread_count ?? 0;
      const jobNewCount = stateRow?.job_new_count ?? 0;

      let title: string;
      let bodyMd: string;

      if (digestType === "morning") {
        // Top 3 pending actions
        let actionLines = "- No pending actions";
        try {
          const r = await db
            .prepare(
              `SELECT title FROM home_actions
               WHERE user_id = ? AND status IN ('new','accepted')
               ORDER BY priority ASC LIMIT 3`,
            )
            .bind(userId)
            .all<{ title: string }>();
          if (r.results && r.results.length > 0) {
            actionLines = r.results.map((a) => `- ${a.title}`).join("\n");
          }
        } catch {
          /* table may not exist */
        }

        title = `Morning Briefing — ${dateKey}`;
        bodyMd = [
          "# Morning Briefing\n",
          "## Today's Overview",
          `- ${dueCount} items due`,
          `- ${unreadCount} unread articles`,
          `- ${jobNewCount} jobs tracked\n`,
          "## Top Priorities",
          actionLines,
        ].join("\n");
      } else {
        // Evening summary
        let doneCount = 0;
        let remainingCount = 0;
        try {
          const doneRow = await db
            .prepare(
              `SELECT COUNT(*) AS cnt FROM home_actions
               WHERE user_id = ? AND status = 'done'
               AND updated_at >= ?`,
            )
            .bind(userId, dateKey)
            .first<{ cnt: number }>();
          doneCount = doneRow?.cnt ?? 0;
        } catch {
          /* ignore */
        }
        try {
          const remRow = await db
            .prepare(
              `SELECT COUNT(*) AS cnt FROM home_actions
               WHERE user_id = ? AND status IN ('new','accepted')`,
            )
            .bind(userId)
            .first<{ cnt: number }>();
          remainingCount = remRow?.cnt ?? 0;
        } catch {
          /* ignore */
        }

        title = `Evening Summary — ${dateKey}`;
        bodyMd = [
          "# Evening Summary\n",
          "## Completed Today",
          `${doneCount} action(s) marked done\n`,
          "## Rolling Over",
          `${remainingCount} action(s) still new or accepted`,
        ].join("\n");
      }

      const id = crypto.randomUUID();
      await db
        .prepare(
          `INSERT INTO home_digest_history
           (id, user_id, digest_type, title, body_md, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, userId, digestType, title, bodyMd, now)
        .run();

      return Response.json(
        {
          digest: {
            id,
            digest_type: digestType,
            title,
            body_md: bodyMd,
            created_at: now,
          },
        },
        { status: 201 },
      );
    } catch (err) {
      return d1ErrorResponse("POST /api/home/digest/generate", err);
    }
  });
}

export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ events: [] });
    const url = new URL(req.url);
    const from = url.searchParams.get("from") || new Date().toISOString().slice(0, 10);
    const to = url.searchParams.get("to") || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const format = url.searchParams.get("format");

    try {
      const r = await db.prepare(
        `SELECT a.id, a.title, a.due_at, a.status, a.priority, c.code AS course_code, c.name AS course_name
         FROM school_assignments a LEFT JOIN courses c ON a.course_id = c.id
         WHERE a.user_id = ? AND a.due_at >= ? AND a.due_at <= ?
         ORDER BY a.due_at ASC`
      ).bind(userId, from + "T00:00:00Z", to + "T23:59:59Z").all<{
        id: string; title: string; due_at: string; status: string; priority?: string;
        course_code?: string; course_name?: string;
      }>();

      const events = (r.results || []).map((a) => ({
        id: a.id,
        title: `${a.course_code ? a.course_code + ": " : ""}${a.title}`,
        start: a.due_at,
        status: a.status,
        priority: a.priority,
        course: a.course_code || a.course_name || null,
      }));

      if (format === "ics") {
        return generateICS(events);
      }

      return Response.json({ events });
    } catch { return Response.json({ events: [] }); }
  });
}

interface CalEvent {
  id: string;
  title: string;
  start: string;
  status: string;
  priority?: string;
  course?: string | null;
}

function generateICS(events: CalEvent[]): Response {
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  let ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//MCC//School Calendar//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n`;

  for (const ev of events) {
    const dtstart = new Date(ev.start).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const dtend = dtstart; // point event
    const summary = ev.title.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n").replace(/\r/g, "");
    ics += `BEGIN:VEVENT\r\n`;
    ics += `UID:${ev.id}@mcc\r\n`;
    ics += `DTSTAMP:${now}\r\n`;
    ics += `DTSTART:${dtstart}\r\n`;
    ics += `DTEND:${dtend}\r\n`;
    ics += `SUMMARY:${summary}\r\n`;
    if (ev.status) ics += `STATUS:${ev.status === "done" ? "COMPLETED" : "NEEDS-ACTION"}\r\n`;
    if (ev.priority === "high") ics += `PRIORITY:1\r\n`;
    ics += `END:VEVENT\r\n`;
  }

  ics += `END:VCALENDAR\r\n`;

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="mcc-school-calendar.ics"`,
    },
  });
}

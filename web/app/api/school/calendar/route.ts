export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1, d1ErrorResponse } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ events: [] });
    const url = new URL(req.url);
    const from = url.searchParams.get("from") || new Date().toISOString().slice(0, 10);
    const to = url.searchParams.get("to") || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const format = url.searchParams.get("format");
    const courseId = url.searchParams.get("courseId");
    const view = url.searchParams.get("view") || "month";

    try {
      // 1) Assignment due dates
      let assignQ = `SELECT a.id, a.title, a.due_at, a.status, a.priority,
               c.code AS course_code, c.name AS course_name
         FROM school_assignments a LEFT JOIN courses c ON a.course_id = c.id
         WHERE a.user_id = ? AND a.due_at >= ? AND a.due_at <= ?`;
      const assignP: unknown[] = [userId, from + "T00:00:00Z", to + "T23:59:59Z"];
      if (courseId) { assignQ += ` AND a.course_id = ?`; assignP.push(courseId); }
      assignQ += ` ORDER BY a.due_at ASC`;

      const r = await db.prepare(assignQ).bind(...assignP).all<{
        id: string; title: string; due_at: string; status: string; priority?: string;
        course_code?: string; course_name?: string;
      }>();

      const assignmentEvents = (r.results || []).map((a) => ({
        id: a.id,
        title: `${a.course_code ? a.course_code + ": " : ""}${a.title}`,
        start: a.due_at,
        end: a.due_at,
        type: "assignment" as const,
        status: a.status,
        priority: a.priority,
        course: a.course_code || a.course_name || null,
      }));

      // 2) Calendar events
      let calQ = `SELECT e.id, e.title, e.starts_at, e.ends_at, e.type, e.location,
               c.code AS course_code, c.name AS course_name
         FROM school_calendar_events e LEFT JOIN courses c ON e.course_id = c.id
         WHERE e.user_id = ? AND e.starts_at >= ? AND e.starts_at <= ?`;
      const calP: unknown[] = [userId, from + "T00:00:00Z", to + "T23:59:59Z"];
      if (courseId) { calQ += ` AND e.course_id = ?`; calP.push(courseId); }
      calQ += ` ORDER BY e.starts_at ASC`;

      let calendarEvents: CalEvent[] = [];
      try {
        const cr = await db.prepare(calQ).bind(...calP).all<{
          id: string; title: string; starts_at: string; ends_at?: string;
          type: string; location?: string; course_code?: string; course_name?: string;
        }>();
        calendarEvents = (cr.results || []).map((e) => ({
          id: e.id,
          title: `${e.course_code ? e.course_code + ": " : ""}${e.title}`,
          start: e.starts_at,
          end: e.ends_at || e.starts_at,
          type: e.type as CalEvent["type"],
          status: "confirmed",
          priority: undefined,
          course: e.course_code || e.course_name || null,
          location: e.location,
        }));
      } catch { /* table may not exist yet */ }

      const events = [...assignmentEvents, ...calendarEvents].sort(
        (a, b) => a.start.localeCompare(b.start)
      );

      if (format === "ics") {
        return generateICS(events);
      }

      return Response.json({ events, view });
    } catch { return Response.json({ events: [] }); }
  });
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db) return Response.json({ error: "D1 not available" }, { status: 500 });
    try {
      const body = (await req.json()) as {
        courseId?: string; type?: string; title: string;
        startsAt: string; endsAt?: string; location?: string;
        linkedAssignmentId?: string;
      };
      if (!body.title || !body.startsAt) {
        return Response.json({ error: "title and startsAt required" }, { status: 400 });
      }
      const validTypes = ["class", "exam", "assignment", "milestone", "office_hours"];
      const type = validTypes.includes(body.type || "") ? body.type! : "class";
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO school_calendar_events
         (id, user_id, course_id, type, title, starts_at, ends_at, location, source, linked_assignment_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)`
      ).bind(
        id, session.user_id, body.courseId || null, type, body.title,
        body.startsAt, body.endsAt || null, body.location || null,
        body.linkedAssignmentId || null, now, now
      ).run();
      return Response.json({ ok: true, id }, { status: 201 });
    } catch (err) { return d1ErrorResponse("POST /api/school/calendar", err); }
  });
}

interface CalEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  type?: "assignment" | "class" | "exam" | "milestone" | "office_hours";
  status: string;
  priority?: string;
  course?: string | null;
  location?: string;
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

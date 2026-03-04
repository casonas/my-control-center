export const runtime = "edge";

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1 } from "@/lib/d1";

// Canonical market name mapping
const MARKET_ALIASES: Record<string, string> = {
  pts: "points",
  reb: "rebounds",
  ast: "assists",
  "3pm": "threes",
  threes: "threes",
  points: "points",
  rebounds: "rebounds",
  assists: "assists",
};

function normalizeMarket(raw: string): string {
  const key = raw.trim().toLowerCase();
  return MARKET_ALIASES[key] ?? key;
}

/** Simple edge heuristic: bigger absolute odds imply value */
function computeEdge(odds: number | null | undefined): number {
  if (odds == null) return 0;
  // Convert American odds to implied probability, then score
  const prob =
    odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
  // Edge = deviation from 50% (higher = more lopsided)
  return Math.round((Math.abs(prob - 0.5) * 100) * 10) / 10;
}

/**
 * Compute a deterministic hash of the active board rows.
 * Uses core fields: eventId|player|market|line|odds|book
 */
async function computeBoardHash(
  rows: { eventId?: string; player: string; market: string; line?: number | null; odds?: number | null; book?: string }[]
): Promise<string> {
  const sorted = rows
    .map(
      (r) =>
        `${r.eventId ?? ""}|${r.player}|${r.market}|${r.line ?? ""}|${r.odds ?? ""}|${r.book ?? ""}`
    )
    .sort();
  const payload = sorted.join("\n");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

interface PropInput {
  eventId?: string;
  homeTeam?: string;
  awayTeam?: string;
  player: string;
  market: string;
  line?: number | null;
  odds?: number | null;
  book?: string;
  uncertain?: boolean;
  reason?: string;
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db)
      return Response.json(
        { ok: false, error: "D1 not available" },
        { status: 500 }
      );

    let body: { league?: string; source?: string; props?: PropInput[] };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json(
        { ok: false, error: "Invalid JSON" },
        { status: 400 }
      );
    }

    const league = (body.league ?? "nba").trim().toLowerCase();
    const props = body.props;
    if (!Array.isArray(props) || props.length === 0) {
      return Response.json(
        { ok: false, error: "props array required" },
        { status: 400 }
      );
    }

    const userId = session.user_id;
    const now = new Date().toISOString();

    // Build normalized rows
    const activeRows: PropInput[] = [];
    let inserted = 0;
    let updated = 0;
    let passed = 0;

    for (const p of props) {
      if (!p.player || !p.market) continue;

      const market = normalizeMarket(p.market);
      const status = p.uncertain ? "pass" : "active";
      if (status === "pass") passed++;

      const edgeScore = computeEdge(p.odds);

      const row = {
        eventId: p.eventId?.trim(),
        player: p.player.trim(),
        market,
        line: p.line ?? null,
        odds: p.odds ?? null,
        book: p.book?.trim() ?? null,
      };
      if (status === "active") activeRows.push(row);

      // Upsert: match on user+league+player+market+book
      const existing = await db
        .prepare(
          `SELECT id FROM sports_props_board
           WHERE user_id = ? AND league = ? AND player = ? AND market = ? AND book = ?
           LIMIT 1`
        )
        .bind(userId, league, row.player, row.market, row.book)
        .first<{ id: string }>();

      const boardHashPlaceholder = "__pending__";

      if (existing) {
        await db
          .prepare(
            `UPDATE sports_props_board
             SET event_id = ?, home_team = ?, away_team = ?, line = ?, odds = ?,
                 edge_score = ?, status = ?, reason = ?, fetched_at = ?, board_hash = ?
             WHERE id = ?`
          )
          .bind(
            row.eventId ?? null,
            p.homeTeam?.trim() ?? null,
            p.awayTeam?.trim() ?? null,
            row.line,
            row.odds,
            edgeScore,
            status,
            p.reason ?? null,
            now,
            boardHashPlaceholder,
            existing.id
          )
          .run();
        updated++;
      } else {
        const id = crypto.randomUUID();
        await db
          .prepare(
            `INSERT INTO sports_props_board
             (id, user_id, league, event_id, home_team, away_team, player, market,
              line, odds, book, edge_score, status, reason, fetched_at, board_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            id,
            userId,
            league,
            row.eventId ?? null,
            p.homeTeam?.trim() ?? null,
            p.awayTeam?.trim() ?? null,
            row.player,
            row.market,
            row.line,
            row.odds,
            row.book ?? null,
            edgeScore,
            status,
            p.reason ?? null,
            now,
            boardHashPlaceholder
          )
          .run();
        inserted++;
      }
    }

    // Compute board_hash from active rows only
    const boardHash = await computeBoardHash(activeRows);

    // Update all rows from this batch with the real board_hash
    await db
      .prepare(
        `UPDATE sports_props_board
         SET board_hash = ?
         WHERE user_id = ? AND league = ? AND board_hash = '__pending__'`
      )
      .bind(boardHash, userId, league)
      .run();

    // Count total active
    const countResult = await db
      .prepare(
        `SELECT COUNT(*) as cnt FROM sports_props_board
         WHERE user_id = ? AND league = ? AND status = 'active'`
      )
      .bind(userId, league)
      .first<{ cnt: number }>();

    return Response.json({
      ok: true,
      inserted,
      updated,
      passed,
      board_hash: boardHash,
      total_active: countResult?.cnt ?? 0,
    });
  });
}

export const runtime = "edge";
import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";
import { normalizeGameRow, normalizeNewsRow, normalizeOddsRow, normalizePredictionRow } from "@/lib/sports/serialize";

type Ctx = { params: Promise<{ gameId: string }> };

function yyyymmdd(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function parseEventIdFromGameId(gameId: string): { league: string; eventId: string } | null {
  const m = gameId.match(/^espn_(nba|nfl|mlb|nhl)_(\d+)$/i);
  if (!m) return null;
  return { league: m[1].toLowerCase(), eventId: m[2] };
}

const ESPN_LEAGUE_MAP: Record<string, string> = {
  nba: "basketball/nba",
  nfl: "football/nfl",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
};

async function fetchEspnEvent(league: string, eventId: string, startTime?: string): Promise<Record<string, unknown> | null> {
  const path = ESPN_LEAGUE_MAP[league];
  if (!path) return null;
  const dates = startTime ? [`?dates=${yyyymmdd(startTime)}`, ""] : [""];
  for (const q of dates) {
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard${q}`, {
        headers: { "User-Agent": "MCC-Sports/2.0", Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const json = await res.json() as { events?: unknown[] };
      const events = Array.isArray(json.events) ? json.events : [];
      const found = events.find((e) => typeof e === "object" && e && String((e as Record<string, unknown>).id || "") === eventId);
      if (found && typeof found === "object") return found as Record<string, unknown>;
    } catch {
      // non-fatal
    }
  }
  return null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function statValue(competitor: Record<string, unknown> | undefined, key: string): number | null {
  const stats = Array.isArray(competitor?.statistics) ? competitor?.statistics as Record<string, unknown>[] : [];
  const s = stats.find((r) => String(r.name || "").toLowerCase() === key.toLowerCase());
  return s ? num(s.displayValue) : null;
}

function leaderText(competitor: Record<string, unknown> | undefined, key: string): string | null {
  const leaders = Array.isArray(competitor?.leaders) ? competitor?.leaders as Record<string, unknown>[] : [];
  const group = leaders.find((r) => String(r.name || "").toLowerCase() === key.toLowerCase());
  const first = Array.isArray(group?.leaders) ? (group?.leaders as Record<string, unknown>[])[0] : null;
  if (!first) return null;
  const athlete = first.athlete && typeof first.athlete === "object" ? first.athlete as Record<string, unknown> : null;
  const name = athlete ? String(athlete.displayName || athlete.fullName || "") : "";
  const value = String(first.displayValue || "");
  return name && value ? `${name} (${value})` : null;
}

function buildInsights(
  homeName: string,
  awayName: string,
  home: Record<string, unknown> | undefined,
  away: Record<string, unknown> | undefined,
): string[] {
  const notes: string[] = [];
  const homePpg = statValue(home, "avgPoints");
  const awayPpg = statValue(away, "avgPoints");
  const homeReb = statValue(home, "avgRebounds");
  const awayReb = statValue(away, "avgRebounds");
  const homeAst = statValue(home, "avgAssists");
  const awayAst = statValue(away, "avgAssists");
  const home3p = statValue(home, "threePointPct");
  const away3p = statValue(away, "threePointPct");

  if (homePpg != null && awayPpg != null) {
    const diff = +(homePpg - awayPpg).toFixed(1);
    if (Math.abs(diff) >= 2) notes.push(`${diff > 0 ? homeName : awayName} has stronger scoring profile (${homePpg} vs ${awayPpg} PPG).`);
  }
  if (homeReb != null && awayReb != null) {
    const diff = +(homeReb - awayReb).toFixed(1);
    if (Math.abs(diff) >= 1.5) notes.push(`${diff > 0 ? homeName : awayName} holds the rebounding edge (${homeReb} vs ${awayReb} RPG).`);
  }
  if (homeAst != null && awayAst != null) {
    const diff = +(homeAst - awayAst).toFixed(1);
    if (Math.abs(diff) >= 1.5) notes.push(`${diff > 0 ? homeName : awayName} is moving the ball better (${homeAst} vs ${awayAst} APG).`);
  }
  if (home3p != null && away3p != null) {
    const diff = +(home3p - away3p).toFixed(1);
    if (Math.abs(diff) >= 1) notes.push(`${diff > 0 ? homeName : awayName} is shooting better from three (${home3p}% vs ${away3p}%).`);
  }
  return notes.slice(0, 4);
}

export async function GET(_req: Request, ctx: Ctx) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ game: null });
    try {
      const { gameId } = await ctx.params;
      let game = await db.prepare(`SELECT * FROM sports_games WHERE id = ? AND user_id = ?`).bind(gameId, userId).first<Record<string, unknown>>();
      if (!game) game = await db.prepare(`SELECT * FROM sports_games WHERE id = ?`).bind(gameId).first<Record<string, unknown>>();
      if (!game) return Response.json({ error: "Game not found" }, { status: 404 });

      const oddsResult = await db.prepare(`SELECT * FROM sports_odds_market WHERE game_id = ? AND user_id = ? ORDER BY asof DESC LIMIT 10`).bind(gameId, userId).all<Record<string, unknown>>();
      const prediction = await db.prepare(`SELECT * FROM sports_model_predictions WHERE game_id = ? AND user_id = ? ORDER BY generated_at DESC LIMIT 1`).bind(gameId, userId).first<Record<string, unknown>>();

      // Get team-related news
      const homeTeamId = String(game.home_team_id || "");
      const awayTeamId = String(game.away_team_id || "");
      const newsResult = await db.prepare(
        `SELECT * FROM sports_news_items WHERE user_id = ? AND (team_id = ? OR team_id = ?) ORDER BY published_at DESC LIMIT 10`
      ).bind(userId, homeTeamId, awayTeamId).all<Record<string, unknown>>();

      // Pull richer game context directly from ESPN (free) for analysis-first UI.
      let gameAnalysis: Record<string, unknown> | null = null;
      const parsed = parseEventIdFromGameId(gameId);
      if (parsed) {
        const ev = await fetchEspnEvent(parsed.league, parsed.eventId, String(game.start_time || ""));
        if (ev) {
          const compRaw = Array.isArray((ev.competitions as Record<string, unknown>[] | undefined))
            ? (ev.competitions as Record<string, unknown>[])[0]
            : null;
          const competitors = Array.isArray(compRaw?.competitors) ? compRaw?.competitors as Record<string, unknown>[] : [];
          const home = competitors.find((c) => String(c.homeAway || "") === "home");
          const away = competitors.find((c) => String(c.homeAway || "") === "away");
          const homeName = String(home?.team && typeof home.team === "object" ? (home.team as Record<string, unknown>).displayName || "" : game.home_team_name || "Home");
          const awayName = String(away?.team && typeof away.team === "object" ? (away.team as Record<string, unknown>).displayName || "" : game.away_team_name || "Away");

          const homeRecords = Array.isArray(home?.records) ? home?.records : [];
          const awayRecords = Array.isArray(away?.records) ? away?.records : [];
          const findRec = (rows: unknown[], type: string) => {
            const rec = (rows as Record<string, unknown>[]).find((r) => String(r.type || "").toLowerCase() === type);
            return rec ? String(rec.summary || "") : null;
          };

          gameAnalysis = {
            insights: buildInsights(homeName, awayName, home, away),
            home: {
              record_overall: findRec(homeRecords as unknown[], "total"),
              record_home: findRec(homeRecords as unknown[], "home"),
              ppg: statValue(home, "avgPoints"),
              rpg: statValue(home, "avgRebounds"),
              apg: statValue(home, "avgAssists"),
              fg_pct: statValue(home, "fieldGoalPct"),
              three_pct: statValue(home, "threePointPct"),
              leaders: {
                points: leaderText(home, "pointsPerGame"),
                rebounds: leaderText(home, "reboundsPerGame"),
                assists: leaderText(home, "assistsPerGame"),
              },
            },
            away: {
              record_overall: findRec(awayRecords as unknown[], "total"),
              record_away: findRec(awayRecords as unknown[], "road"),
              ppg: statValue(away, "avgPoints"),
              rpg: statValue(away, "avgRebounds"),
              apg: statValue(away, "avgAssists"),
              fg_pct: statValue(away, "fieldGoalPct"),
              three_pct: statValue(away, "threePointPct"),
              leaders: {
                points: leaderText(away, "pointsPerGame"),
                rebounds: leaderText(away, "reboundsPerGame"),
                assists: leaderText(away, "assistsPerGame"),
              },
            },
          };
        }
      }

      return Response.json({
        game: normalizeGameRow(game),
        odds: (oddsResult.results || []).map(normalizeOddsRow),
        prediction: prediction ? normalizePredictionRow(prediction) : null,
        news: (newsResult.results || []).map(normalizeNewsRow),
        analysis: gameAnalysis,
      });
    } catch { return Response.json({ game: null }); }
  });
}

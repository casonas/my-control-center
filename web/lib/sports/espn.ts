// web/lib/sports/espn.ts — ESPN public scoreboard provider (free)
//
// ESPN exposes public JSON scoreboards at:
//   https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard
// No API key required. Rate-limit friendly at ≤1 req/min/league.

import { fetchWithRetry } from "./fetchWithRetry";
import type { League, NormalizedGame, ProviderResult } from "./types";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

const LEAGUE_MAP: Record<League, string> = {
  nba: "basketball/nba",
  nfl: "football/nfl",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
};

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function dedupeGames(rows: NormalizedGame[]): NormalizedGame[] {
  const byId = new Map<string, NormalizedGame>();
  for (const g of rows) byId.set(g.id, g);
  return [...byId.values()];
}

async function fetchScoreboardJson(path: string, dateStr?: string): Promise<Record<string, unknown> | null> {
  const url = dateStr
    ? `${ESPN_BASE}/${path}/scoreboard?dates=${encodeURIComponent(dateStr)}`
    : `${ESPN_BASE}/${path}/scoreboard`;
  const text = await fetchWithRetry(url);
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapStatus(espnStatus: string): NormalizedGame["status"] {
  const s = (espnStatus || "").toLowerCase();
  if (s.includes("final")) return "final";
  if (s.includes("progress") || s.includes("in ")) return "live";
  if (s.includes("postponed") || s.includes("canceled")) return "postponed";
  return "scheduled";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseScoreboard(raw: any, league: League): NormalizedGame[] {
  const events = raw?.events || [];
  const games: NormalizedGame[] = [];

  for (const ev of events) {
    try {
      const comp = ev.competitions?.[0];
      if (!comp) continue;

      const home = comp.competitors?.find((c: any) => c.homeAway === "home");
      const away = comp.competitors?.find((c: any) => c.homeAway === "away");
      if (!home || !away) continue;

      const statusDetail = comp.status?.type?.description || ev.status?.type?.description || "scheduled";
      const period = comp.status?.period?.toString() || null;
      const clock = comp.status?.displayClock || null;

      games.push({
        id: `espn_${league}_${ev.id}`,
        league,
        home_team_id: home.team?.abbreviation || home.team?.id || "UNK",
        home_team_name: home.team?.displayName || home.team?.shortDisplayName || "Home",
        away_team_id: away.team?.abbreviation || away.team?.id || "UNK",
        away_team_name: away.team?.displayName || away.team?.shortDisplayName || "Away",
        home_score: home.score != null ? Number(home.score) : null,
        away_score: away.score != null ? Number(away.score) : null,
        status: mapStatus(statusDetail),
        period,
        clock,
        start_time: ev.date || comp.date || new Date().toISOString(),
        source: "espn",
      });
    } catch {
      // skip malformed event
    }
  }
  return games;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Fetch live/recent scoreboard from ESPN for a single league.
 */
export async function fetchEspnScores(league: League): Promise<ProviderResult<NormalizedGame>> {
  const path = LEAGUE_MAP[league];
  if (!path) return { ok: false, data: [], source: "espn", error: `Unknown league: ${league}` };

  try {
    const primary = await fetchScoreboardJson(path);
    const primaryGames = primary ? parseScoreboard(primary, league) : [];
    if (primaryGames.length > 0) {
      return { ok: true, data: dedupeGames(primaryGames), source: "espn" };
    }

    // If no games returned for "today" endpoint, probe nearby dates.
    const dayOffsets = [-1, 1, 2];
    const now = new Date();
    const windows: NormalizedGame[] = [];
    for (const offset of dayOffsets) {
      const d = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
      const json = await fetchScoreboardJson(path, yyyymmdd(d));
      if (!json) continue;
      windows.push(...parseScoreboard(json, league));
    }

    return { ok: true, data: dedupeGames(windows), source: "espn" };
  } catch (err) {
    return { ok: false, data: [], source: "espn", error: err instanceof Error ? err.message : "Fetch/parse error" };
  }
}

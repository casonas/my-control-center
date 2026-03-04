// web/lib/sports/odds.ts — Pluggable odds provider adapter
//
// Provider A (free): The Odds API (free tier: 500 req/month)
//   https://the-odds-api.com — requires API key in env THE_ODDS_API_KEY
// Provider B (paid): placeholder for future premium source
//
// Falls back gracefully: if no API key or provider fails, returns empty with error.

import { fetchWithRetry } from "./fetchWithRetry";
import type { League, NormalizedOdds, ProviderResult } from "./types";

const ODDS_API_BASE = "https://api.the-odds-api.com/v4/sports";

const LEAGUE_SPORT_MAP: Record<League, string> = {
  nba: "basketball_nba",
  nfl: "americanfootball_nfl",
  mlb: "baseball_mlb",
  nhl: "icehockey_nhl",
};

function americanToDecimal(american: number): number {
  return american > 0 ? american / 100 + 1 : 100 / Math.abs(american) + 1;
}

function impliedProb(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseOddsApiResponse(data: any[], league: League): NormalizedOdds[] {
  const results: NormalizedOdds[] = [];
  const now = new Date().toISOString();

  for (const event of data) {
    const gameId = `espn_${league}_${event.id}`;

    for (const bookmaker of event.bookmakers || []) {
      const book = bookmaker.key || bookmaker.title || "unknown";
      let spreadHome: number | null = null;
      let spreadAway: number | null = null;
      let total: number | null = null;
      let mlHome: number | null = null;
      let mlAway: number | null = null;

      for (const market of bookmaker.markets || []) {
        if (market.key === "spreads") {
          for (const outcome of market.outcomes || []) {
            if (outcome.name === event.home_team) spreadHome = outcome.point;
            else spreadAway = outcome.point;
          }
        } else if (market.key === "totals") {
          const over = (market.outcomes || []).find((o: any) => o.name === "Over");
          if (over) total = over.point;
        } else if (market.key === "h2h") {
          for (const outcome of market.outcomes || []) {
            if (outcome.name === event.home_team) mlHome = outcome.price;
            else mlAway = outcome.price;
          }
        }
      }

      // Convert decimal odds to american if needed
      const toAmerican = (dec: number | null): number | null => {
        if (dec == null) return null;
        if (dec >= 2) return Math.round((dec - 1) * 100);
        return Math.round(-100 / (dec - 1));
      };

      // the-odds-api returns decimal by default
      results.push({
        game_id: gameId,
        book,
        spread_home: spreadHome,
        spread_away: spreadAway,
        total,
        moneyline_home: typeof mlHome === "number" && mlHome > 1 ? toAmerican(mlHome) : mlHome,
        moneyline_away: typeof mlAway === "number" && mlAway > 1 ? toAmerican(mlAway) : mlAway,
        asof: now,
      });
    }
  }
  return results;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Fetch odds from the free-tier Odds API.
 * Requires THE_ODDS_API_KEY environment variable.
 */
export async function fetchOdds(league: League): Promise<ProviderResult<NormalizedOdds>> {
  const apiKey = process.env.THE_ODDS_API_KEY;
  if (!apiKey) {
    return { ok: false, data: [], source: "the-odds-api", error: "THE_ODDS_API_KEY not set — odds unavailable" };
  }

  const sport = LEAGUE_SPORT_MAP[league];
  if (!sport) return { ok: false, data: [], source: "the-odds-api", error: `Unknown league: ${league}` };

  const url = `${ODDS_API_BASE}/${sport}/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=decimal`;
  const text = await fetchWithRetry(url);
  if (!text) return { ok: false, data: [], source: "the-odds-api", error: "Fetch failed" };

  try {
    const json = JSON.parse(text);
    const odds = parseOddsApiResponse(Array.isArray(json) ? json : [], league);
    return { ok: true, data: odds, source: "the-odds-api" };
  } catch (err) {
    return { ok: false, data: [], source: "the-odds-api", error: err instanceof Error ? err.message : "Parse error" };
  }
}

// Re-export utilities for analyst engine
export { americanToDecimal, impliedProb };

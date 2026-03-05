// web/lib/sports/odds.ts - Pluggable odds provider adapter
//
// Provider A (free): The Odds API (free tier)
//   https://the-odds-api.com - requires THE_ODDS_API_KEY or THE_ODDS_API_KEYS
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

const ESPN_SCOREBOARD_MAP: Record<League, string> = {
  nba: "basketball/nba",
  nfl: "football/nfl",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
};

const APISPORTS_ODDS_URL_ENV: Record<League, string> = {
  nba: "APISPORTS_ODDS_URL_NBA",
  nfl: "APISPORTS_ODDS_URL_NFL",
  mlb: "APISPORTS_ODDS_URL_MLB",
  nhl: "APISPORTS_ODDS_URL_NHL",
};

function getOddsApiKeys(): string[] {
  const csv = (process.env.THE_ODDS_API_KEYS || "").trim();
  const single = (process.env.THE_ODDS_API_KEY || "").trim();
  const keys = [
    ...csv.split(",").map((k) => k.trim()).filter(Boolean),
    ...(single ? [single] : []),
  ];
  return Array.from(new Set(keys));
}

function pickKey(keys: string[], league: League, attempt: number): string | null {
  if (keys.length === 0) return null;
  const seed = league.split("").reduce((sum, c) => sum + c.charCodeAt(0), 0);
  return keys[(seed + attempt) % keys.length] || null;
}

function normalizeTeamName(input: string | null | undefined): string {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|fc|sc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dateKey(input: string | null | undefined): string {
  if (!input) return "";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function matchKey(home: string, away: string, when: string): string {
  return `${normalizeTeamName(home)}|${normalizeTeamName(away)}|${dateKey(when)}`;
}

async function fetchEspnGameIdMap(league: League): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const path = ESPN_SCOREBOARD_MAP[league];
  if (!path) return map;
  const text = await fetchWithRetry(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`);
  if (!text) return map;
  try {
    const json = JSON.parse(text) as { events?: unknown[] };
    const events = Array.isArray(json.events) ? json.events : [];
    for (const ev of events) {
      if (!ev || typeof ev !== "object") continue;
      const obj = ev as Record<string, unknown>;
      const evId = String(obj.id || "");
      const when = String(obj.date || "");
      const comps = Array.isArray((obj.competitions as unknown[] | undefined)) ? (obj.competitions as unknown[]) : [];
      const comp = (comps[0] && typeof comps[0] === "object") ? (comps[0] as Record<string, unknown>) : null;
      const competitors = Array.isArray(comp?.competitors as unknown[] | undefined) ? (comp?.competitors as unknown[]) : [];
      let home = "";
      let away = "";
      for (const c of competitors) {
        if (!c || typeof c !== "object") continue;
        const co = c as Record<string, unknown>;
        const ha = String(co.homeAway || "");
        const team = (co.team && typeof co.team === "object") ? (co.team as Record<string, unknown>) : {};
        const name = String(team.displayName || team.shortDisplayName || team.name || "");
        if (ha === "home") home = name;
        if (ha === "away") away = name;
      }
      if (home && away && evId) {
        map.set(matchKey(home, away, when), `espn_${league}_${evId}`);
      }
    }
  } catch {
    return map;
  }
  return map;
}

function americanToDecimal(american: number): number {
  return american > 0 ? american / 100 + 1 : 100 / Math.abs(american) + 1;
}

function impliedProb(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

function decimalToAmerican(dec: number | null): number | null {
  if (dec == null || !Number.isFinite(dec) || dec <= 1) return null;
  if (dec >= 2) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
}

function asAmerican(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (Math.abs(raw) >= 100) return Math.round(raw);
    if (raw > 1) return decimalToAmerican(raw);
    return null;
  }
  if (typeof raw === "string") {
    const n = Number(raw.trim());
    if (Number.isFinite(n)) return asAmerican(n);
  }
  return null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseOddsApiResponse(data: any[], league: League, gameIdMap: Map<string, string>): NormalizedOdds[] {
  const results: NormalizedOdds[] = [];
  const now = new Date().toISOString();

  for (const event of data) {
    const mappedId = gameIdMap.get(matchKey(event.home_team, event.away_team, event.commence_time));
    const gameId = mappedId || `espn_${league}_${event.id}`;

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

      results.push({
        game_id: gameId,
        book,
        spread_home: spreadHome,
        spread_away: spreadAway,
        total,
        moneyline_home: typeof mlHome === "number" && mlHome > 1 ? decimalToAmerican(mlHome) : mlHome,
        moneyline_away: typeof mlAway === "number" && mlAway > 1 ? decimalToAmerican(mlAway) : mlAway,
        asof: now,
      });
    }
  }
  return results;
}

function parseApiSportsResponse(data: any, league: League, gameIdMap: Map<string, string>): NormalizedOdds[] {
  const rows: NormalizedOdds[] = [];
  const now = new Date().toISOString();
  const response = Array.isArray(data?.response) ? data.response : [];

  for (const item of response) {
    const homeTeam =
      item?.teams?.home?.name ||
      item?.home?.name ||
      item?.home_team?.name ||
      item?.match?.home?.name ||
      "";
    const awayTeam =
      item?.teams?.away?.name ||
      item?.away?.name ||
      item?.away_team?.name ||
      item?.match?.away?.name ||
      "";
    const when = item?.fixture?.date || item?.date || item?.game?.date || item?.commence_time || "";
    const rawId = item?.fixture?.id || item?.game?.id || item?.id || crypto.randomUUID();
    const gameId = gameIdMap.get(matchKey(homeTeam, awayTeam, when)) || `espn_${league}_${rawId}`;

    const books = Array.isArray(item?.bookmakers) ? item.bookmakers : (Array.isArray(item?.books) ? item.books : []);
    if (books.length === 0) {
      const mlHome = asAmerican(item?.odds?.home || item?.moneyline_home);
      const mlAway = asAmerican(item?.odds?.away || item?.moneyline_away);
      if (mlHome != null || mlAway != null) {
        rows.push({
          game_id: gameId,
          book: "api-sports",
          spread_home: null,
          spread_away: null,
          total: null,
          moneyline_home: mlHome,
          moneyline_away: mlAway,
          asof: now,
        });
      }
      continue;
    }

    for (const book of books) {
      const bookName = String(book?.name || book?.title || "api-sports");
      let spreadHome: number | null = null;
      let spreadAway: number | null = null;
      let total: number | null = null;
      let mlHome: number | null = null;
      let mlAway: number | null = null;

      const markets = Array.isArray(book?.bets) ? book.bets : (Array.isArray(book?.markets) ? book.markets : []);
      for (const market of markets) {
        const mName = String(market?.name || market?.key || "").toLowerCase();
        const values = Array.isArray(market?.values) ? market.values : (Array.isArray(market?.outcomes) ? market.outcomes : []);
        if (mName.includes("winner") || mName.includes("h2h") || mName.includes("moneyline")) {
          for (const v of values) {
            const vName = String(v?.value || v?.name || "").toLowerCase();
            const odd = asAmerican(v?.odd ?? v?.price);
            if (odd == null) continue;
            if (vName.includes("home") || normalizeTeamName(vName) === normalizeTeamName(homeTeam)) mlHome = odd;
            if (vName.includes("away") || normalizeTeamName(vName) === normalizeTeamName(awayTeam)) mlAway = odd;
          }
        } else if (mName.includes("spread") || mName.includes("handicap")) {
          for (const v of values) {
            const vName = String(v?.value || v?.name || "").toLowerCase();
            const point = Number(v?.handicap ?? v?.point ?? NaN);
            if (!Number.isFinite(point)) continue;
            if (vName.includes("home") || normalizeTeamName(vName) === normalizeTeamName(homeTeam)) spreadHome = point;
            if (vName.includes("away") || normalizeTeamName(vName) === normalizeTeamName(awayTeam)) spreadAway = point;
          }
        } else if (mName.includes("total") || mName.includes("over/under") || mName.includes("ou")) {
          for (const v of values) {
            const vName = String(v?.value || v?.name || "").toLowerCase();
            if (vName.includes("over")) {
              const point = Number(v?.handicap ?? v?.point ?? NaN);
              if (Number.isFinite(point)) total = point;
            }
          }
        }
      }

      if (mlHome != null || mlAway != null || spreadHome != null || spreadAway != null || total != null) {
        rows.push({
          game_id: gameId,
          book: bookName,
          spread_home: spreadHome,
          spread_away: spreadAway,
          total,
          moneyline_home: mlHome,
          moneyline_away: mlAway,
          asof: now,
        });
      }
    }
  }

  return rows;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Fetch odds from the Odds API.
 * Supports key pools with THE_ODDS_API_KEYS=key1,key2,key3.
 */
export async function fetchOdds(league: League): Promise<ProviderResult<NormalizedOdds>> {
  const gameIdMap = await fetchEspnGameIdMap(league);

  const apiKeys = getOddsApiKeys();

  const sport = LEAGUE_SPORT_MAP[league];
  if (!sport) return { ok: false, data: [], source: "odds", error: `Unknown league: ${league}` };

  let lastError = "";

  if (apiKeys.length > 0) {
    for (let attempt = 0; attempt < apiKeys.length; attempt++) {
      const apiKey = pickKey(apiKeys, league, attempt);
      if (!apiKey) continue;

      const url = `${ODDS_API_BASE}/${sport}/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=decimal`;
      const text = await fetchWithRetry(url);
      if (!text) {
        lastError = "the-odds-api fetch failed";
        continue;
      }

      try {
        const json = JSON.parse(text);
        if (json && typeof json === "object" && !Array.isArray(json) && "message" in json) {
          lastError = String((json as Record<string, unknown>).message || "the-odds-api error");
          continue;
        }
        const odds = parseOddsApiResponse(Array.isArray(json) ? json : [], league, gameIdMap);
        if (odds.length > 0) {
          return { ok: true, data: odds, source: "the-odds-api" };
        }
        lastError = "the-odds-api returned no odds rows";
      } catch (err) {
        lastError = err instanceof Error ? err.message : "the-odds-api parse error";
      }
    }
  } else {
    lastError = "THE_ODDS_API_KEY(S) not set";
  }

  const apiSportsKey = (process.env.API_SPORTS_API_KEY || "").trim();
  const apiSportsUrl = (process.env[APISPORTS_ODDS_URL_ENV[league]] || "").trim();
  if (!apiSportsKey || !apiSportsUrl) {
    return {
      ok: false,
      data: [],
      source: "api-sports",
      error: `${lastError}; API_SPORTS_API_KEY or ${APISPORTS_ODDS_URL_ENV[league]} not configured`,
    };
  }

  try {
    const res = await fetch(apiSportsUrl, {
      headers: {
        "x-apisports-key": apiSportsKey,
        "X-ApiSports-Key": apiSportsKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      return { ok: false, data: [], source: "api-sports", error: `${lastError}; api-sports HTTP ${res.status}` };
    }
    const json = await res.json();
    const odds = parseApiSportsResponse(json, league, gameIdMap);
    if (odds.length === 0) {
      return { ok: false, data: [], source: "api-sports", error: `${lastError}; api-sports returned no odds rows` };
    }
    return { ok: true, data: odds, source: "api-sports" };
  } catch (err) {
    return {
      ok: false,
      data: [],
      source: "api-sports",
      error: `${lastError}; api-sports failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// Re-export utilities for analyst engine
export { americanToDecimal, impliedProb };

// web/lib/sports/pipeline.ts — Sports data refresh pipeline
//
// Orchestrates: scores → odds → news → analyst
// Each stage is independent — failures in one don't block others.

import type { D1Database } from "@/lib/d1";
import type { League, NormalizedGame, NormalizedOdds, NormalizedNews } from "./types";
import { fetchEspnScores } from "./espn";
import { fetchOdds } from "./odds";
import { fetchSportsNews } from "./news";
import { analyzeEdges } from "./analyst";

interface PipelineResult {
  games: number;
  odds: number;
  news: number;
  predictions: number;
  errors: string[];
  source: string;
  sourceHealth: Record<string, { ok: boolean; items: number; error?: string }>;
}

/**
 * Upsert games into D1.
 */
async function upsertGames(db: D1Database, userId: string, games: NormalizedGame[]): Promise<number> {
  let count = 0;
  for (const g of games) {
    try {
      await db.prepare(
        `INSERT INTO sports_games (id, user_id, league, start_time, status, home_team_id, home_team_name, away_team_id, away_team_name, home_score, away_score, period, clock, updated_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status=excluded.status, home_score=excluded.home_score, away_score=excluded.away_score,
           period=excluded.period, clock=excluded.clock, updated_at=excluded.updated_at`
      ).bind(
        g.id, userId, g.league, g.start_time, g.status,
        g.home_team_id, g.home_team_name, g.away_team_id, g.away_team_name,
        g.home_score, g.away_score, g.period, g.clock,
        new Date().toISOString(), g.source
      ).run();
      count++;
    } catch (err) {
      console.warn(`[pipeline] Failed to upsert game ${g.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return count;
}

/**
 * Record odds history for line movement tracking.
 */
async function recordOddsHistory(
  db: D1Database,
  userId: string,
  o: NormalizedOdds
): Promise<void> {
  const historyId = `${userId}_${o.game_id}_${o.book}_spread_${Date.now()}`;
  try {
    await db.prepare(
      `INSERT INTO sports_odds_history (id, user_id, game_id, book, market, line, price, recorded_at)
       VALUES (?, ?, ?, ?, 'spread', ?, ?, ?)`
    ).bind(historyId, userId, o.game_id, o.book, o.spread_home, null, new Date().toISOString()).run();

    // Keep only last 10 records per game+book+market
    await db.prepare(
      `DELETE FROM sports_odds_history
       WHERE user_id = ? AND game_id = ? AND book = ? AND market = 'spread'
         AND id NOT IN (
           SELECT id FROM sports_odds_history
           WHERE user_id = ? AND game_id = ? AND book = ? AND market = 'spread'
           ORDER BY recorded_at DESC LIMIT 10
         )`
    ).bind(userId, o.game_id, o.book, userId, o.game_id, o.book).run();
  } catch { /* non-fatal */ }
}

/**
 * Upsert odds into D1.
 */
async function upsertOdds(db: D1Database, userId: string, odds: NormalizedOdds[]): Promise<number> {
  let count = 0;
  for (const o of odds) {
    try {
      // Record history before upserting
      await recordOddsHistory(db, userId, o);

      const id = `${o.game_id}_${o.book}_${o.asof}`;
      await db.prepare(
        `INSERT OR REPLACE INTO sports_odds_market (id, user_id, game_id, book, spread_home, spread_away, total, moneyline_home, moneyline_away, asof)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id, userId, o.game_id, o.book,
        o.spread_home, o.spread_away, o.total,
        o.moneyline_home, o.moneyline_away, o.asof
      ).run();
      count++;
    } catch (err) {
      console.warn(`[pipeline] Failed to upsert odds:`, err instanceof Error ? err.message : err);
    }
  }
  return count;
}

/**
 * Upsert news into D1.
 */
async function upsertNews(db: D1Database, userId: string, news: NormalizedNews[]): Promise<number> {
  let count = 0;
  for (const n of news) {
    try {
      const id = `news_${n.dedupe_key}`;
      await db.prepare(
        `INSERT OR IGNORE INTO sports_news_items (id, user_id, league, team_id, title, source, url, published_at, fetched_at, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id, userId, n.league, n.team_id, n.title, n.source, n.url,
        n.published_at, new Date().toISOString(), n.dedupe_key
      ).run();
      count++;
    } catch {
      // duplicate dedupe_key — expected
    }
  }
  return count;
}

/**
 * Run analyst and upsert predictions.
 */
async function runAnalyst(db: D1Database, userId: string, league: League): Promise<number> {
  try {
    // Get upcoming/live games
    const gamesResult = await db.prepare(
      `SELECT * FROM sports_games WHERE user_id = ? AND league = ? AND status IN ('scheduled', 'live') ORDER BY start_time LIMIT 50`
    ).bind(userId, league).all();
    const games = (gamesResult.results || []) as unknown as Array<{
      id: string; league: string; home_team_id: string; home_team_name: string;
      away_team_id: string; away_team_name: string; home_score: number | null;
      away_score: number | null; status: string; start_time: string;
    }>;

    // Get all games for form calculation
    const allGamesResult = await db.prepare(
      `SELECT * FROM sports_games WHERE user_id = ? AND league = ? ORDER BY start_time DESC LIMIT 200`
    ).bind(userId, league).all();
    const allGames = (allGamesResult.results || []) as typeof games;

    // Get latest odds per game
    const oddsMap = new Map<string, { game_id: string; book: string; spread_home: number | null; total: number | null; moneyline_home: number | null; moneyline_away: number | null }>();
    for (const g of games) {
      const oddsRow = await db.prepare(
        `SELECT * FROM sports_odds_market WHERE user_id = ? AND game_id = ? ORDER BY asof DESC LIMIT 1`
      ).bind(userId, g.id).first();
      if (oddsRow) {
        oddsMap.set(g.id, oddsRow as unknown as { game_id: string; book: string; spread_home: number | null; total: number | null; moneyline_home: number | null; moneyline_away: number | null });
      }
    }

    const predictions = analyzeEdges(games, allGames, oddsMap, 3);

    let count = 0;
    for (const p of predictions) {
      const id = `pred_${p.game_id}_${p.model_name}_${Date.now()}`;
      try {
        await db.prepare(
          `INSERT OR REPLACE INTO sports_model_predictions (id, user_id, game_id, model_name, proj_spread_home, proj_total, win_prob_home, edge_spread, edge_total, recommended_bet_json, explanation_md, generated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          id, userId, p.game_id, p.model_name,
          p.proj_spread_home, p.proj_total, p.win_prob_home,
          p.edge_spread, p.edge_total,
          p.recommended_bet_json, p.explanation_md,
          new Date().toISOString()
        ).run();
        count++;
      } catch (err) {
        console.warn(`[pipeline] Failed to upsert prediction:`, err instanceof Error ? err.message : err);
      }
    }
    return count;
  } catch (err) {
    console.warn(`[pipeline] Analyst error:`, err instanceof Error ? err.message : err);
    return 0;
  }
}

/**
 * Full refresh pipeline for a league.
 * Runs scores → odds → news → analyst in sequence.
 * Each stage is independent: failures don't block subsequent stages.
 */
export async function runSportsRefresh(
  db: D1Database,
  userId: string,
  league: League
): Promise<PipelineResult> {
  const errors: string[] = [];
  const sourceHealth: Record<string, { ok: boolean; items: number; error?: string }> = {};
  let gameCount = 0;
  let oddsCount = 0;
  let newsCount = 0;
  let predCount = 0;

  // 1. Scores
  const scoresResult = await fetchEspnScores(league);
  if (scoresResult.ok) {
    gameCount = await upsertGames(db, userId, scoresResult.data);
    sourceHealth.espn = { ok: true, items: gameCount };
  } else {
    errors.push(`Scores: ${scoresResult.error}`);
    sourceHealth.espn = { ok: false, items: 0, error: scoresResult.error };
  }

  // 2. Odds
  const oddsResult = await fetchOdds(league);
  if (oddsResult.ok) {
    oddsCount = await upsertOdds(db, userId, oddsResult.data);
    sourceHealth["the-odds-api"] = { ok: true, items: oddsCount };
  } else {
    errors.push(`Odds: ${oddsResult.error}`);
    sourceHealth["the-odds-api"] = { ok: false, items: 0, error: oddsResult.error };
  }

  // 3. News
  const newsResult = await fetchSportsNews(league);
  if (newsResult.ok) {
    newsCount = await upsertNews(db, userId, newsResult.data);
    sourceHealth.rss = { ok: true, items: newsCount };
  } else {
    errors.push(`News: ${newsResult.error}`);
    sourceHealth.rss = { ok: false, items: 0, error: newsResult.error };
  }

  // 4. Analyst (runs after scores + odds are updated)
  predCount = await runAnalyst(db, userId, league);
  sourceHealth.analyst = { ok: true, items: predCount };

  return {
    games: gameCount,
    odds: oddsCount,
    news: newsCount,
    predictions: predCount,
    errors,
    source: "espn+odds-api+rss",
    sourceHealth,
  };
}

// web/lib/sports/analyst.ts — Deterministic edge-finding engine
//
// Analyzes latest odds + recent game results to find betting edges.
// No paid AI required — uses simple probability models.
//
// Inputs: current odds, recent team form, news/injury flags
// Output: predictions with edge_pct, confidence, risk labels

import type { Prediction } from "./types";

interface GameRow {
  id: string;
  league: string;
  home_team_id: string;
  home_team_name: string;
  away_team_id: string;
  away_team_name: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
  start_time: string;
}

interface OddsRow {
  game_id: string;
  book: string;
  spread_home: number | null;
  total: number | null;
  moneyline_home: number | null;
  moneyline_away: number | null;
}

interface TeamForm {
  teamId: string;
  wins: number;
  losses: number;
  avgPointsFor: number;
  avgPointsAgainst: number;
  recentWinRate: number;
}

// --- Probability helpers ---

/** Convert American odds to implied probability */
function impliedProb(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

/** Convert probability to fair American odds */
function probToAmerican(prob: number): number {
  if (prob <= 0 || prob >= 1) return 0;
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

/** Simple Elo-like win probability from recent form */
function formWinProb(homeForm: TeamForm, awayForm: TeamForm): number {
  // Base: home advantage ~ 3-4% in most sports
  const HOME_EDGE = 0.035;

  // Win rate differential
  const homeWR = homeForm.recentWinRate || 0.5;
  const awayWR = awayForm.recentWinRate || 0.5;

  // Scoring differential factor
  const homeNetPts = homeForm.avgPointsFor - homeForm.avgPointsAgainst;
  const awayNetPts = awayForm.avgPointsFor - awayForm.avgPointsAgainst;
  const netDiff = (homeNetPts - awayNetPts) / 20; // normalize

  // Combine signals
  const rawProb = 0.5 + (homeWR - awayWR) * 0.3 + netDiff * 0.15 + HOME_EDGE;

  // Clamp
  return Math.max(0.1, Math.min(0.9, rawProb));
}

/** Estimate projected spread from win probability */
function projSpreadFromProb(prob: number): number {
  // Rough mapping: every 1% of win prob ≈ 0.3 points of spread
  return -((prob - 0.5) * 60);
}

/** Risk label based on edge magnitude and confidence */
function riskLabel(edgePct: number, confidence: number): "low" | "medium" | "high" {
  if (confidence >= 65 && Math.abs(edgePct) < 8) return "low";
  if (confidence >= 45) return "medium";
  return "high";
}

/**
 * Compute team form from recent completed games.
 */
export function computeTeamForm(games: GameRow[], teamId: string, limit = 10): TeamForm {
  const relevant = games
    .filter((g) => g.status === "final" && (g.home_team_id === teamId || g.away_team_id === teamId))
    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
    .slice(0, limit);

  if (relevant.length === 0) {
    return { teamId, wins: 0, losses: 0, avgPointsFor: 0, avgPointsAgainst: 0, recentWinRate: 0.5 };
  }

  let wins = 0;
  let losses = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;

  for (const g of relevant) {
    const isHome = g.home_team_id === teamId;
    const myScore = isHome ? (g.home_score ?? 0) : (g.away_score ?? 0);
    const oppScore = isHome ? (g.away_score ?? 0) : (g.home_score ?? 0);
    pointsFor += myScore;
    pointsAgainst += oppScore;
    if (myScore > oppScore) wins++;
    else losses++;
  }

  return {
    teamId,
    wins,
    losses,
    avgPointsFor: pointsFor / relevant.length,
    avgPointsAgainst: pointsAgainst / relevant.length,
    recentWinRate: wins / relevant.length,
  };
}

/**
 * Run the betting analyst for a set of upcoming/live games with odds.
 * Returns predictions sorted by edge descending.
 */
export function analyzeEdges(
  games: GameRow[],
  allGames: GameRow[],
  oddsMap: Map<string, OddsRow>,
  minEdgePct = 4,
): Prediction[] {
  const predictions: Prediction[] = [];

  for (const game of games) {
    if (game.status === "final") continue; // skip completed games

    const odds = oddsMap.get(game.id);
    if (!odds || (odds.moneyline_home == null && odds.spread_home == null)) continue;

    // Compute recent form
    const homeForm = computeTeamForm(allGames, game.home_team_id);
    const awayForm = computeTeamForm(allGames, game.away_team_id);

    // Model win probability
    const modelProb = formWinProb(homeForm, awayForm);

    // Compare to market implied probability
    let marketImplied = 0.5;
    let edgeSpread: number | null = null;
    let edgeTotal: number | null = null;

    if (odds.moneyline_home != null) {
      marketImplied = impliedProb(odds.moneyline_home);
    }

    const edgePct = (modelProb - marketImplied) * 100;

    // Projected spread
    const projSpread = odds.spread_home != null
      ? projSpreadFromProb(modelProb)
      : null;

    if (odds.spread_home != null && projSpread != null) {
      edgeSpread = projSpread - odds.spread_home;
    }

    // Projected total from historical scoring
    const projTotal = homeForm.avgPointsFor + awayForm.avgPointsFor > 0
      ? Math.round(homeForm.avgPointsFor + awayForm.avgPointsFor)
      : null;

    if (odds.total != null && projTotal != null) {
      edgeTotal = projTotal - odds.total;
    }

    // Confidence: higher if more data + larger edge
    const dataPts = homeForm.wins + homeForm.losses + awayForm.wins + awayForm.losses;
    const dataConfidence = Math.min(70, dataPts * 5);
    const edgeConfidence = Math.min(30, Math.abs(edgePct) * 3);
    const confidence = Math.round(dataConfidence + edgeConfidence);

    // Only surface meaningful edges
    if (Math.abs(edgePct) < minEdgePct) continue;

    const risk = riskLabel(Math.abs(edgePct), confidence);

    // Build rationale
    const parts: string[] = [];
    parts.push(`Model win prob: ${(modelProb * 100).toFixed(1)}% vs market ${(marketImplied * 100).toFixed(1)}%`);
    parts.push(`${game.home_team_name} form: ${homeForm.wins}-${homeForm.losses} (last ${homeForm.wins + homeForm.losses})`);
    parts.push(`${game.away_team_name} form: ${awayForm.wins}-${awayForm.losses} (last ${awayForm.wins + awayForm.losses})`);
    if (projSpread != null) parts.push(`Proj spread: ${projSpread > 0 ? "+" : ""}${projSpread.toFixed(1)}`);
    if (projTotal != null) parts.push(`Proj total: ${projTotal}`);

    // Recommended bet
    const side = edgePct > 0 ? game.home_team_name : game.away_team_name;
    const betType = odds.spread_home != null ? "spread" : "moneyline";
    const recommended = {
      type: betType,
      side,
      edge: `${edgePct > 0 ? "+" : ""}${edgePct.toFixed(1)}%`,
      risk,
    };

    predictions.push({
      game_id: game.id,
      model_name: "mcc-form-v1",
      proj_spread_home: projSpread != null ? Math.round(projSpread * 10) / 10 : null,
      proj_total: projTotal,
      win_prob_home: Math.round(modelProb * 1000) / 1000,
      edge_spread: edgeSpread != null ? Math.round(edgeSpread * 10) / 10 : null,
      edge_total: edgeTotal != null ? Math.round(edgeTotal * 10) / 10 : null,
      confidence,
      risk_label: risk,
      recommended_bet_json: JSON.stringify(recommended),
      explanation_md: parts.join(" · "),
    });
  }

  // Sort by absolute edge descending
  predictions.sort((a, b) => {
    const aEdge = Math.abs((a.win_prob_home ?? 0.5) - 0.5);
    const bEdge = Math.abs((b.win_prob_home ?? 0.5) - 0.5);
    return bEdge - aEdge;
  });

  return predictions;
}

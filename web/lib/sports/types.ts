// web/lib/sports/types.ts — Shared types for Sports Intelligence

export type League = "nba" | "nfl" | "mlb" | "nhl";

export const ALL_LEAGUES: League[] = ["nba", "nfl", "mlb", "nhl"];

export interface NormalizedGame {
  id: string;
  league: League;
  home_team_id: string;
  home_team_name: string;
  away_team_id: string;
  away_team_name: string;
  home_score: number | null;
  away_score: number | null;
  status: "scheduled" | "live" | "final" | "postponed";
  period: string | null;
  clock: string | null;
  start_time: string;
  source: string;
}

export interface NormalizedOdds {
  game_id: string;
  book: string;
  spread_home: number | null;
  spread_away: number | null;
  total: number | null;
  moneyline_home: number | null;
  moneyline_away: number | null;
  asof: string;
}

export interface NormalizedNews {
  league: League;
  team_id: string | null;
  title: string;
  url: string;
  source: string;
  published_at: string | null;
  summary: string | null;
  rumor_flag: number;
  dedupe_key: string;
}

export interface Prediction {
  game_id: string;
  model_name: string;
  proj_spread_home: number | null;
  proj_total: number | null;
  win_prob_home: number | null;
  edge_spread: number | null;
  edge_total: number | null;
  confidence: number;
  risk_label: "low" | "medium" | "high";
  recommended_bet_json: string | null;
  explanation_md: string;
}

export interface ProviderResult<T> {
  ok: boolean;
  data: T[];
  source: string;
  error?: string;
}

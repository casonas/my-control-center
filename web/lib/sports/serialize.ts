function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string {
  return v == null ? "" : String(v);
}

export function normalizeGameRow(row: Record<string, unknown>) {
  return {
    id: toStr(row.id),
    league: toStr(row.league).toLowerCase(),
    home_team_id: toStr(row.home_team_id),
    home_team_name: toStr(row.home_team_name),
    away_team_id: toStr(row.away_team_id),
    away_team_name: toStr(row.away_team_name),
    home_score: toNum(row.home_score),
    away_score: toNum(row.away_score),
    status: toStr(row.status).toLowerCase() || "scheduled",
    period: row.period == null ? null : toStr(row.period),
    clock: row.clock == null ? null : toStr(row.clock),
    start_time: toStr(row.start_time),
    source: toStr(row.source),
    updated_at: row.updated_at == null ? null : toStr(row.updated_at),
  };
}

export function normalizeOddsRow(row: Record<string, unknown>) {
  return {
    id: toStr(row.id),
    game_id: toStr(row.game_id),
    book: toStr(row.book),
    market_type: toStr(row.market_type),
    spread_home: toNum(row.spread_home),
    spread_away: toNum(row.spread_away),
    total: toNum(row.total),
    moneyline_home: toNum(row.moneyline_home),
    moneyline_away: toNum(row.moneyline_away),
    asof: row.asof == null ? null : toStr(row.asof),
    home_team_name: toStr(row.home_team_name),
    away_team_name: toStr(row.away_team_name),
    start_time: row.start_time == null ? null : toStr(row.start_time),
  };
}

export function normalizeNewsRow(row: Record<string, unknown>) {
  return {
    id: toStr(row.id),
    league: toStr(row.league).toLowerCase(),
    team_id: row.team_id == null ? null : toStr(row.team_id),
    title: toStr(row.title),
    source: toStr(row.source),
    url: toStr(row.url),
    published_at: row.published_at == null ? null : toStr(row.published_at),
    fetched_at: row.fetched_at == null ? null : toStr(row.fetched_at),
    summary: row.summary == null ? null : toStr(row.summary),
    rumor_flag: toNum(row.rumor_flag) ?? 0,
  };
}

export function normalizePredictionRow(row: Record<string, unknown>) {
  return {
    id: toStr(row.id),
    game_id: toStr(row.game_id),
    model_name: toStr(row.model_name),
    proj_spread_home: toNum(row.proj_spread_home),
    proj_total: toNum(row.proj_total),
    win_prob_home: toNum(row.win_prob_home),
    edge_spread: toNum(row.edge_spread),
    edge_total: toNum(row.edge_total),
    confidence: toNum(row.confidence) ?? 0,
    risk_label: toStr(row.risk_label).toLowerCase() || "medium",
    recommended_bet_json: row.recommended_bet_json == null ? null : toStr(row.recommended_bet_json),
    explanation_md: toStr(row.explanation_md),
    generated_at: row.generated_at == null ? null : toStr(row.generated_at),
  };
}

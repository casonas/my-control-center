// web/lib/stockProviders.ts — Stock Intel API adapter + free RSS fallback
//
// Primary: Stock Intel API at STOCK_INTEL_API_BASE (default http://127.0.0.1:18093)
// Fallback: cached D1 rows (never emit placeholder/zero values)
//
// Reliability contract per source call:
//   • hard timeout  8 s
//   • 1 retry with random jitter (500–1500 ms)
//   • source-level isolation (one failure doesn't block others)
//   • every response carries: sourceHealth[], freshness { asof, ageSeconds, stale }

import type { D1Database } from "./d1";

/* ================================================================
   Public types — consumed by routes, UI, cron
   ================================================================ */

export interface QuoteData {
  ticker: string;
  price: number;
  change_pct: number;
  volume: number | null;
  premarket_price: number | null;
  premarket_change_pct: number | null;
  source: string;
}

export interface IndexData {
  symbol: string;
  value: number;
  change_pct: number;
  source: string;
}

export interface SourceHealth {
  name: string;
  status: "ok" | "error" | "timeout";
  latencyMs: number;
  error?: string;
}

export interface Freshness {
  asof: string;          // ISO timestamp of data
  ageSeconds: number;    // seconds since asof
  stale: boolean;        // true if ageSeconds > STALE_THRESHOLD_SEC
  source: string;        // e.g. "stock-intel" | "d1-cache"
}

/** 10 min — beyond this any cached row is flagged stale */
const STALE_THRESHOLD_SEC = 600;

/* ================================================================
   Env helper
   ================================================================ */

export function getStockIntelBase(): string {
  return process.env.STOCK_INTEL_API_BASE || "http://127.0.0.1:18093";
}

/* ================================================================
   fetchWithRetry — 8 s timeout, 1 retry, jitter
   ================================================================ */

const TIMEOUT_MS = 8_000;
const MAX_RETRIES = 1;

async function fetchWithRetry(
  url: string,
  opts: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const { method = "GET", body, headers = {} } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "MCC-Stocks/2.0", ...headers },
        ...(body ? { body } : {}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        const jitter = 500 + Math.random() * 1000;          // 500-1500 ms
        await new Promise((r) => setTimeout(r, jitter));
      }
    }
  }
  throw lastError;
}

/** Build a SourceHealth for a failed call */
function failHealth(name: string, start: number, err: unknown): SourceHealth {
  const msg = err instanceof Error ? err.message : String(err);
  const status: SourceHealth["status"] = msg.includes("Timeout") || msg.includes("timeout") ? "timeout" : "error";
  return { name, status, latencyMs: Date.now() - start, error: msg };
}

/* ================================================================
   Freshness helpers  (shared by routes)
   ================================================================ */

export function buildFreshness(asof: string | null | undefined, source: string): Freshness {
  if (!asof) return { asof: "", ageSeconds: 0, stale: true, source };
  const age = Math.round((Date.now() - new Date(asof).getTime()) / 1000);
  return { asof, ageSeconds: Math.max(0, age), stale: age > STALE_THRESHOLD_SEC, source };
}

/* ================================================================
   Catalyst classifier + sentiment scorer  (rule-based, free)
   ================================================================ */

const CATALYST_RULES: { pattern: RegExp; type: string }[] = [
  { pattern: /\bearnings?\b|\bquarter(ly)?\b|\brevenue\b|\bbeat\b|\bmiss\b|\beps\b/i, type: "earnings" },
  { pattern: /\bguidance\b|\boutlook\b|\bforecast\b|\braise[ds]?\b|\blower[eds]?\b/i, type: "guidance" },
  { pattern: /\bproduct\b|\blaunch\b|\brelease[ds]?\b|\bshipment\b|\bfda\b|\bapproval\b/i, type: "product" },
  { pattern: /\blegal\b|\blaw ?suit\b|\bsettl\b|\bfine[ds]?\b|\binvestigat\b|\bsec\b/i, type: "legal" },
  { pattern: /\bacquisition\b|\bmerger\b|\bm\s*&\s*a\b|\bbuyout\b|\btakeover\b/i, type: "m&a" },
  { pattern: /\bupgrade\b|\bdowngrade\b|\banalyst\b|\bprice target\b|\brating\b/i, type: "analyst_rating" },
  { pattern: /\bfed\b|\binflation\b|\binterest rate\b|\bcpi\b|\bjobs report\b|\bmacro\b/i, type: "macro" },
];
export function classifyCatalyst(title: string, summary?: string | null): string | null {
  const text = `${title} ${summary || ""}`;
  for (const { pattern, type } of CATALYST_RULES) if (pattern.test(text)) return type;
  return null;
}

const BULL = [
  /\bbeat\b|\bsurpass\b|\braise[ds]?\b|\bgrows?\b|\bsurge[ds]?\b|\bsoar\b|\brally\b|\bupgrade\b/i,
  /\brecord high\b|\ball.time high\b|\bstrong\b|\boptimis/i,
  /\boutperform\b|\bbreakout\b|\bbullish\b/i,
];
const BEAR = [
  /\bmiss\b|\bfall[s]?\b|\bdecline[ds]?\b|\bdrop[s]?\b|\bplunge[ds]?\b|\bcrash\b|\bdowngrade\b/i,
  /\bwarn[s]?\b|\bcut[s]?\b|\blower\b|\bweak\b|\bpessimis/i,
  /\bunderperform\b|\bbearish\b|\bselloff\b|\bsell.off\b/i,
];
export function scoreSentiment(title: string, summary?: string | null): number {
  const text = `${title} ${summary || ""}`;
  let s = 0;
  for (const p of BULL) if (p.test(text)) s += 0.3;
  for (const p of BEAR) if (p.test(text)) s -= 0.3;
  return Math.max(-1, Math.min(1, s));
}

/* ================================================================
   StockIntelProvider — primary adapter
   ================================================================ */

export class StockIntelProvider {
  readonly name = "stock-intel";
  private base: string;
  constructor(base?: string) { this.base = base || getStockIntelBase(); }

  /* ── health ──────────────────────────────────────── */
  async checkHealth(): Promise<SourceHealth> {
    const t = Date.now();
    try {
      await fetchWithRetry(`${this.base}/health`);
      return { name: this.name, status: "ok", latencyMs: Date.now() - t };
    } catch (err) { return failHealth(this.name, t, err); }
  }

  /* ── universe sync (POST /universe/sync) ─────────── */
  async syncUniverse(tickers: string[]): Promise<SourceHealth> {
    const t = Date.now();
    try {
      await fetchWithRetry(`${this.base}/universe/sync`, {
        method: "POST",
        body: JSON.stringify({ symbols: tickers }),
        headers: { "Content-Type": "application/json" },
      });
      return { name: `${this.name}/universe`, status: "ok", latencyMs: Date.now() - t };
    } catch (err) { return failHealth(`${this.name}/universe`, t, err); }
  }

  /* ── trigger upstream ingest (POST /update) ──────── */
  async triggerUpdate(): Promise<SourceHealth> {
    const t = Date.now();
    try {
      await fetchWithRetry(`${this.base}/update`, { method: "POST" });
      return { name: `${this.name}/update`, status: "ok", latencyMs: Date.now() - t };
    } catch (err) { return failHealth(`${this.name}/update`, t, err); }
  }

  /* ── quotes: Yahoo Finance first, Stock Intel fallback ───── */
  async fetchQuotes(tickers: string[]): Promise<{ quotes: QuoteData[]; health: SourceHealth }> {
    const t = Date.now();
    const tickerSet = new Set(tickers.map((s) => s.toUpperCase()));
    const quotes: QuoteData[] = [];
    const seen = new Set<string>();

    // 1) Try Yahoo Finance first
    try {
      const symbols = tickers.join(",");
      const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
      const res = await fetchWithRetry(yahooUrl);
      const body = await res.json() as Record<string, unknown>;
      const qr = body.quoteResponse as Record<string, unknown> | undefined;
      const results = Array.isArray(qr?.result) ? qr.result as Record<string, unknown>[] : [];

      for (const r of results) {
        const sym = String(r.symbol || "").toUpperCase();
        if (!sym || seen.has(sym)) continue;
        const price = Number(r.regularMarketPrice ?? 0);
        if (price <= 0) continue;
        seen.add(sym);
        quotes.push({
          ticker: sym,
          price,
          change_pct: Number(r.regularMarketChangePercent ?? 0),
          volume: r.regularMarketVolume != null ? Number(r.regularMarketVolume) : null,
          premarket_price: r.preMarketPrice != null ? Number(r.preMarketPrice) : null,
          premarket_change_pct: r.preMarketChangePercent != null ? Number(r.preMarketChangePercent) : null,
          source: "yahoo",
        });
      }

      if (quotes.length > 0 && tickers.every((tk) => seen.has(tk.toUpperCase()))) {
        return { quotes, health: { name: "yahoo", status: "ok", latencyMs: Date.now() - t } };
      }
    } catch { /* Yahoo failed — fall through to Stock Intel */ }

    // 2) Fallback to Stock Intel
    try {
      const res = await fetchWithRetry(`${this.base}/alerts/watchlist`);
      const body = await res.json() as unknown;
      const raw = toArray(body, "alerts");

      for (const r of raw) {
        const sym = upper(r, "symbol", "ticker");
        if (!sym || (tickerSet.size > 0 && !tickerSet.has(sym))) continue;
        if (seen.has(sym)) continue;
        seen.add(sym);
        quotes.push(mapQuote(r, sym));
      }

      // back-fill from movers if any watchlist ticker was missing
      if (tickers.some((tk) => !seen.has(tk.toUpperCase()))) {
        try {
          const mr = await fetchWithRetry(`${this.base}/market/movers-by-news`);
          const mb = await mr.json() as unknown;
          for (const m of toArray(mb, "movers")) {
            const sym = upper(m, "symbol", "ticker");
            if (!sym || seen.has(sym) || !tickerSet.has(sym)) continue;
            seen.add(sym);
            quotes.push(mapQuote(m, sym));
          }
        } catch { /* movers is non-critical */ }
      }
    } catch { /* Stock Intel also failed */ }

    const status = quotes.length > 0 ? "ok" : "error";
    return { quotes, health: { name: quotes.some((q) => q.source === "yahoo") ? "yahoo+stock-intel" : this.name, status, latencyMs: Date.now() - t } };
  }

  /* ── indices: Yahoo Finance first, Stock Intel fallback ────── */
  async fetchIndices(): Promise<{ indices: IndexData[]; health: SourceHealth }> {
    const t = Date.now();
    const indices: IndexData[] = [];

    // 1) Try Yahoo Finance for ^GSPC, ^IXIC, BTC-USD
    try {
      const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent("^GSPC,^IXIC,BTC-USD")}`;
      const res = await fetchWithRetry(yahooUrl);
      const body = await res.json() as Record<string, unknown>;
      const qr = body.quoteResponse as Record<string, unknown> | undefined;
      const results = Array.isArray(qr?.result) ? qr.result as Record<string, unknown>[] : [];

      const symbolMap: Record<string, string> = { "^GSPC": "SPX", "^IXIC": "IXIC", "BTC-USD": "BTC" };
      for (const r of results) {
        const rawSym = String(r.symbol || "");
        const mapped = symbolMap[rawSym];
        if (!mapped) continue;
        const price = Number(r.regularMarketPrice ?? 0);
        if (price <= 0) continue;
        indices.push({
          symbol: mapped,
          value: price,
          change_pct: Number(r.regularMarketChangePercent ?? 0),
          source: "yahoo",
        });
      }

      if (indices.length > 0) {
        return { indices, health: { name: "yahoo/indices", status: "ok", latencyMs: Date.now() - t } };
      }
    } catch { /* Yahoo failed — fall through */ }

    // 2) Fallback to Stock Intel summaries
    try {
      const res = await fetchWithRetry(`${this.base}/summaries/daily`);
      const body = await res.json() as unknown;
      const rows = toArray(body, "summaries");

      const s = rows[0] ?? (typeof body === "object" && body !== null ? body as Record<string, unknown> : null);
      if (s) {
        const spx = num(s, "sp500_change", "spx_change");
        const ndx = num(s, "nasdaq_change", "ndx_change");
        const btc = num(s, "btc_change");
        if (spx !== null) indices.push({ symbol: "SPX", value: num(s, "sp500_value", "spx_value") ?? 0, change_pct: spx, source: "stock-intel" });
        if (ndx !== null) indices.push({ symbol: "IXIC", value: num(s, "nasdaq_value", "ndx_value") ?? 0, change_pct: ndx, source: "stock-intel" });
        if (btc !== null) indices.push({ symbol: "BTC", value: num(s, "btc_value") ?? 0, change_pct: btc, source: "stock-intel" });
      }
    } catch { /* Stock Intel also failed */ }

    const status = indices.length > 0 ? "ok" : "error";
    return { indices, health: { name: indices.some((i) => i.source === "yahoo") ? "yahoo/indices" : `${this.name}/summaries`, status, latencyMs: Date.now() - t } };
  }

  /* ── movers (GET /market/movers-by-news) ─────────── */
  async getMovers(): Promise<{ movers: Record<string, unknown>[]; health: SourceHealth }> {
    const t = Date.now();
    try {
      const res = await fetchWithRetry(`${this.base}/market/movers-by-news`);
      const body = await res.json() as unknown;
      return { movers: toArray(body, "movers"), health: { name: `${this.name}/movers`, status: "ok", latencyMs: Date.now() - t } };
    } catch (err) { return { movers: [], health: failHealth(`${this.name}/movers`, t, err) }; }
  }

  /* ── ticker news (GET /ticker/{sym}/news) ────────── */
  async getTickerNews(symbol: string): Promise<{ items: Record<string, unknown>[]; health: SourceHealth }> {
    const t = Date.now();
    try {
      const res = await fetchWithRetry(`${this.base}/ticker/${encodeURIComponent(symbol)}/news`);
      const body = await res.json() as unknown;
      return { items: toArray(body, "items", "news"), health: { name: `${this.name}/ticker-news`, status: "ok", latencyMs: Date.now() - t } };
    } catch (err) { return { items: [], health: failHealth(`${this.name}/ticker-news`, t, err) }; }
  }

  /* ── ticker why (GET /ticker/{sym}/why) ──────────── */
  async getTickerWhy(symbol: string): Promise<{ analysis: Record<string, unknown> | null; health: SourceHealth }> {
    const t = Date.now();
    try {
      const res = await fetchWithRetry(`${this.base}/ticker/${encodeURIComponent(symbol)}/why`);
      const data = await res.json() as Record<string, unknown>;
      return { analysis: data, health: { name: `${this.name}/ticker-why`, status: "ok", latencyMs: Date.now() - t } };
    } catch (err) { return { analysis: null, health: failHealth(`${this.name}/ticker-why`, t, err) }; }
  }

  /* ── daily summary (GET /summaries/daily) ────────── */
  async getDailySummary(): Promise<{ summary: Record<string, unknown> | null; health: SourceHealth }> {
    const t = Date.now();
    try {
      const res = await fetchWithRetry(`${this.base}/summaries/daily`);
      const data = await res.json() as Record<string, unknown>;
      return { summary: data, health: { name: `${this.name}/summaries`, status: "ok", latencyMs: Date.now() - t } };
    } catch (err) { return { summary: null, health: failHealth(`${this.name}/summaries`, t, err) }; }
  }
}

/* ================================================================
   D1 cache layer — used for stale fallback & GET /quotes
   ================================================================ */

export async function storeQuotes(db: D1Database, userId: string, quotes: QuoteData[]): Promise<void> {
  const now = new Date().toISOString();
  for (const q of quotes) {
    await db.prepare(
      `INSERT OR REPLACE INTO stock_quotes
       (user_id, ticker, price, change, change_pct, currency, asof, source, volume, premarket_price, premarket_change_pct)
       VALUES (?, ?, ?, 0, ?, 'USD', ?, ?, ?, ?, ?)`,
    ).bind(
      userId, q.ticker, q.price, q.change_pct, now, q.source,
      q.volume, q.premarket_price, q.premarket_change_pct,
    ).run();
  }
}

export async function storeIndices(db: D1Database, userId: string, indices: IndexData[]): Promise<void> {
  const now = new Date().toISOString();
  for (const idx of indices) {
    await db.prepare(
      `INSERT OR REPLACE INTO market_indices (user_id, symbol, value, change_pct, asof, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(userId, idx.symbol, idx.value, idx.change_pct, now, idx.source).run();
  }
}

/** Load cached quotes from D1 — filters out rows with price=0 (legacy pending) */
export async function loadCachedQuotes(
  db: D1Database, userId: string,
): Promise<{ quotes: QuoteData[]; freshness: Freshness | null }> {
  try {
    const r = await db.prepare(
      `SELECT ticker, price, change_pct, volume, premarket_price, premarket_change_pct, asof, source
       FROM stock_quotes WHERE user_id = ? AND price > 0 ORDER BY ticker`,
    ).bind(userId).all<Record<string, unknown>>();
    const rows = r.results || [];
    if (rows.length === 0) return { quotes: [], freshness: null };

    const quotes: QuoteData[] = rows.map((row) => ({
      ticker: String(row.ticker),
      price: Number(row.price),
      change_pct: Number(row.change_pct ?? 0),
      volume: row.volume != null ? Number(row.volume) : null,
      premarket_price: row.premarket_price != null ? Number(row.premarket_price) : null,
      premarket_change_pct: row.premarket_change_pct != null ? Number(row.premarket_change_pct) : null,
      source: String(row.source || "cached"),
    }));

    const latestAsof = rows.reduce((best, row) => {
      const a = String(row.asof || "");
      return a > best ? a : best;
    }, "");

    return { quotes, freshness: buildFreshness(latestAsof, "d1-cache") };
  } catch {
    return { quotes: [], freshness: null };
  }
}

/** Load cached indices from D1 — filters out rows with value=0 (legacy pending) */
export async function loadCachedIndices(
  db: D1Database, userId: string,
): Promise<{ indices: IndexData[]; freshness: Freshness | null }> {
  try {
    const r = await db.prepare(
      `SELECT symbol, value, change_pct, asof, source
       FROM market_indices WHERE user_id = ? AND (value > 0 OR change_pct != 0) ORDER BY symbol`,
    ).bind(userId).all<Record<string, unknown>>();
    const rows = r.results || [];
    if (rows.length === 0) return { indices: [], freshness: null };

    const indices: IndexData[] = rows.map((row) => ({
      symbol: String(row.symbol),
      value: Number(row.value ?? 0),
      change_pct: Number(row.change_pct ?? 0),
      source: String(row.source || "cached"),
    }));

    const latestAsof = rows.reduce((best, row) => {
      const a = String(row.asof || "");
      return a > best ? a : best;
    }, "");

    return { indices, freshness: buildFreshness(latestAsof, "d1-cache") };
  } catch {
    return { indices: [], freshness: null };
  }
}

/* ================================================================
   Regime snapshot persistence
   ================================================================ */

export async function storeRegimeSnapshot(
  db: D1Database,
  userId: string,
  data: { spx_change?: number; ndx_change?: number; vix_level?: number; breadth_score?: number; risk_mode: string },
): Promise<void> {
  const now = new Date().toISOString();
  try {
    await db.prepare(
      `INSERT OR REPLACE INTO market_regime_snapshots
       (id, user_id, asof, spx_change, ndx_change, vix_level, breadth_score, risk_mode, notes_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
    ).bind(
      crypto.randomUUID(), userId, now,
      data.spx_change ?? null, data.ndx_change ?? null,
      data.vix_level ?? null, data.breadth_score ?? null, data.risk_mode,
    ).run();
  } catch { /* non-fatal */ }
}

/* ================================================================
   RSS news feeds (free fallback when Stock Intel is unavailable)
   ================================================================ */

export const STOCK_NEWS_FEEDS = [
  { name: "MarketWatch", url: "https://feeds.marketwatch.com/marketwatch/topstories/" },
  { name: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" },
];

export interface NewsScanResult {
  newItems: number;
  sources: SourceHealth[];
  staleFallbackUsed: boolean;
}

export async function scanNewsFeeds(
  db: D1Database,
  userId: string,
  parseFeed: (xml: string) => { title: string; url: string; publishedAt: string | null; summary: string | null }[],
  intelProvider?: StockIntelProvider,
): Promise<NewsScanResult> {
  const now = new Date().toISOString();
  let newItems = 0;
  const sources: SourceHealth[] = [];

  // 1) Stock Intel per-ticker news
  if (intelProvider) {
    const start = Date.now();
    try {
      const wl = await db.prepare(`SELECT ticker FROM stock_watchlist WHERE user_id = ?`).bind(userId).all<{ ticker: string }>();
      for (const { ticker } of (wl.results || []).slice(0, 20)) {
        try {
          const { items, health } = await intelProvider.getTickerNews(ticker);
          if (health.status !== "ok") continue;
          for (const item of items) {
            const title = String(item.title || item.headline || "").slice(0, 300);
            const url = String(item.url || item.link || "");
            if (!title || !url) continue;
            const dedupeKey = url.replace(/[?#].*$/, "").toLowerCase();
            const catalyst = classifyCatalyst(title, String(item.summary || ""));
            const sentiment = item.sentiment_score != null ? Number(item.sentiment_score) : scoreSentiment(title, String(item.summary || ""));
            try {
              await db.prepare(
                `INSERT OR IGNORE INTO stock_news_items
                 (id, user_id, ticker, title, source, url, published_at, fetched_at, summary, impact_score, dedupe_key, sentiment_score, catalyst_type)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
              ).bind(
                crypto.randomUUID(), userId, ticker, title, "stock-intel", url,
                String(item.published_at || item.date || ""), now,
                String(item.summary || item.description || "").slice(0, 400) || null,
                dedupeKey, sentiment, catalyst,
              ).run();
              newItems++;
            } catch { /* dedupe */ }
          }
        } catch { /* per-ticker non-fatal */ }
      }
      sources.push({ name: "stock-intel/ticker-news", status: "ok", latencyMs: Date.now() - start });
    } catch (err) {
      sources.push(failHealth("stock-intel/ticker-news", start, err));
    }
  }

  // 2) RSS feeds (always — broad market coverage)
  for (const feed of STOCK_NEWS_FEEDS) {
    const start = Date.now();
    try {
      const res = await fetchWithRetry(feed.url);
      const xml = await res.text();
      for (const item of parseFeed(xml)) {
        if (!item.url || !item.title) continue;
        const dedupeKey = item.url.replace(/[?#].*$/, "").toLowerCase();
        const catalyst = classifyCatalyst(item.title, item.summary);
        const sentiment = scoreSentiment(item.title, item.summary);
        try {
          await db.prepare(
            `INSERT OR IGNORE INTO stock_news_items
             (id, user_id, ticker, title, source, url, published_at, fetched_at, summary, impact_score, dedupe_key, sentiment_score, catalyst_type)
             VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
          ).bind(
            crypto.randomUUID(), userId, item.title.slice(0, 300), feed.name, item.url,
            item.publishedAt, now, item.summary?.slice(0, 400) || null,
            dedupeKey, sentiment, catalyst,
          ).run();
          newItems++;
        } catch { /* dedupe */ }
      }
      sources.push({ name: feed.name, status: "ok", latencyMs: Date.now() - start });
    } catch (err) {
      sources.push(failHealth(feed.name, start, err));
    }
  }

  return { newItems, sources, staleFallbackUsed: sources.every((s) => s.status !== "ok") };
}

/* ================================================================
   Singleton accessor
   ================================================================ */

export function getStockIntelProvider(): StockIntelProvider {
  return new StockIntelProvider();
}

/* ================================================================
   Internal helpers  (JSON shape normalisation)
   ================================================================ */

/** Coerce unknown response body to Record<string,unknown>[] */
function toArray(body: unknown, ...keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (typeof body === "object" && body !== null) {
    for (const k of keys) {
      const v = (body as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
  }
  return [];
}

/** Extract first non-null uppercase string value from keys */
function upper(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v)) return String(v).toUpperCase();
  }
  return "";
}

/** Extract first non-null numeric value from keys */
function num(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && !isNaN(Number(v))) return Number(v);
  }
  return null;
}

/** Map a raw alert/mover object to QuoteData */
function mapQuote(r: Record<string, unknown>, sym: string): QuoteData {
  return {
    ticker: sym,
    price: Number(r.price || r.last_price || 0),
    change_pct: Number(r.change_pct || r.pct_change || 0),
    volume: r.volume != null ? Number(r.volume) : null,
    premarket_price: r.premarket_price != null ? Number(r.premarket_price) : null,
    premarket_change_pct: r.premarket_change_pct != null ? Number(r.premarket_change_pct) : null,
    source: "stock-intel",
  };
}

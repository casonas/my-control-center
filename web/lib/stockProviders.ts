// web/lib/stockProviders.ts — Free-first data provider abstraction
//
// Supports free/public endpoints with pluggable premium fallback.
// Each provider has: timeout, 1 retry + jitter, source-level isolation.

import type { D1Database } from "./d1";

// ─── Types ──────────────────────────────────────────

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

export interface NewsData {
  title: string;
  url: string;
  source: string;
  published_at: string | null;
  summary: string | null;
  ticker: string | null;
}

export interface SourceHealth {
  name: string;
  status: "ok" | "error" | "timeout";
  latencyMs: number;
}

// ─── Catalyst classifier (rule-based) ───────────────

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
  for (const rule of CATALYST_RULES) {
    if (rule.pattern.test(text)) return rule.type;
  }
  return null;
}

// ─── Sentiment scorer (rule-based) ──────────────────

const BULLISH_PATTERNS = [
  /\bbeat\b|\bsurpass\b|\braise[ds]?\b|\bgrows?\b|\bsurge[ds]?\b|\bsoar\b|\brally\b|\bupgrade\b/i,
  /\brecord high\b|\ball.time high\b|\bstrong\b|\boptimis/i,
  /\boutperform\b|\bbreakout\b|\bbullish\b/i,
];

const BEARISH_PATTERNS = [
  /\bmiss\b|\bfall[s]?\b|\bdecline[ds]?\b|\bdrop[s]?\b|\bplunge[ds]?\b|\bcrash\b|\bdowngrade\b/i,
  /\bwarn[s]?\b|\bcut[s]?\b|\blower\b|\bweak\b|\bpessimis/i,
  /\bunderperform\b|\bbearish\b|\bselloff\b|\bsell.off\b/i,
];

export function scoreSentiment(title: string, summary?: string | null): number {
  const text = `${title} ${summary || ""}`;
  let score = 0;
  for (const p of BULLISH_PATTERNS) if (p.test(text)) score += 0.3;
  for (const p of BEARISH_PATTERNS) if (p.test(text)) score -= 0.3;
  return Math.max(-1, Math.min(1, score));
}

// ─── Fetch with timeout + retry + jitter ────────────

async function fetchWithRetry(
  url: string,
  opts: { timeoutMs?: number; retries?: number; userAgent?: string } = {}
): Promise<Response> {
  const { timeoutMs = 8000, retries = 1, userAgent = "MCC-Stocks/2.0" } = opts;
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": userAgent },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastError = err;
      if (i < retries) {
        const jitter = Math.random() * 500 + 500;
        await new Promise((r) => setTimeout(r, jitter));
      }
    }
  }
  throw lastError;
}

// ─── Stock News Feeds ───────────────────────────────

export const STOCK_NEWS_FEEDS = [
  { name: "MarketWatch", url: "https://feeds.marketwatch.com/marketwatch/topstories/" },
  { name: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" },
  { name: "Yahoo Finance", url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL,MSFT,GOOGL,AMZN,NVDA,TSLA&region=US&lang=en-US" },
];

// ─── Provider interface ─────────────────────────────

export interface QuoteProvider {
  name: string;
  fetchQuotes(tickers: string[]): Promise<{ quotes: QuoteData[]; health: SourceHealth }>;
  fetchIndices(): Promise<{ indices: IndexData[]; health: SourceHealth }>;
}

// ─── Free quote provider (placeholder with structure) ──

export class FreeQuoteProvider implements QuoteProvider {
  name = "free-placeholder";

  async fetchQuotes(tickers: string[]): Promise<{ quotes: QuoteData[]; health: SourceHealth }> {
    const start = Date.now();
    try {
      // MVP: Return pending quotes — real data requires YF API or similar
      const quotes: QuoteData[] = tickers.map((t) => ({
        ticker: t,
        price: 0,
        change_pct: 0,
        volume: null,
        premarket_price: null,
        premarket_change_pct: null,
        source: "pending",
      }));
      return { quotes, health: { name: this.name, status: "ok", latencyMs: Date.now() - start } };
    } catch {
      return {
        quotes: [],
        health: { name: this.name, status: "error", latencyMs: Date.now() - start },
      };
    }
  }

  async fetchIndices(): Promise<{ indices: IndexData[]; health: SourceHealth }> {
    const start = Date.now();
    const indices: IndexData[] = [
      { symbol: "SPX", value: 0, change_pct: 0, source: "pending" },
      { symbol: "IXIC", value: 0, change_pct: 0, source: "pending" },
      { symbol: "BTC", value: 0, change_pct: 0, source: "pending" },
    ];
    return { indices, health: { name: this.name, status: "ok", latencyMs: Date.now() - start } };
  }
}

// ─── News scan helper ───────────────────────────────

export interface NewsScanResult {
  newItems: number;
  sources: SourceHealth[];
}

export async function scanNewsFeeds(
  db: D1Database,
  userId: string,
  parseFeed: (xml: string) => { title: string; url: string; publishedAt: string | null; summary: string | null }[]
): Promise<NewsScanResult> {
  const now = new Date().toISOString();
  let newItems = 0;
  const sources: SourceHealth[] = [];

  for (const feed of STOCK_NEWS_FEEDS) {
    const start = Date.now();
    try {
      const res = await fetchWithRetry(feed.url);
      const xml = await res.text();
      const items = parseFeed(xml);
      for (const item of items) {
        if (!item.url || !item.title) continue;
        const id = crypto.randomUUID();
        const dedupeKey = item.url.replace(/[?#].*$/, "").toLowerCase();
        const catalyst = classifyCatalyst(item.title, item.summary);
        const sentiment = scoreSentiment(item.title, item.summary);
        try {
          await db
            .prepare(
              `INSERT OR IGNORE INTO stock_news_items (id, user_id, ticker, title, source, url, published_at, fetched_at, summary, impact_score, dedupe_key, sentiment_score, catalyst_type)
               VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
            )
            .bind(id, userId, item.title.slice(0, 300), feed.name, item.url, item.publishedAt, now, item.summary?.slice(0, 400) || null, dedupeKey, sentiment, catalyst)
            .run();
          newItems++;
        } catch { /* dedupe */ }
      }
      sources.push({ name: feed.name, status: "ok", latencyMs: Date.now() - start });
    } catch {
      sources.push({ name: feed.name, status: "error", latencyMs: Date.now() - start });
    }
  }

  return { newItems, sources };
}

// ─── Store quotes + indices ─────────────────────────

export async function storeQuotes(db: D1Database, userId: string, quotes: QuoteData[]) {
  const now = new Date().toISOString();
  for (const q of quotes) {
    await db
      .prepare(
        `INSERT OR REPLACE INTO stock_quotes (user_id, ticker, price, change, change_pct, currency, asof, source, volume, premarket_price, premarket_change_pct)
         VALUES (?, ?, ?, 0, ?, 'USD', ?, ?, ?, ?, ?)`
      )
      .bind(userId, q.ticker, q.price, q.change_pct, now, q.source, q.volume, q.premarket_price, q.premarket_change_pct)
      .run();
  }
}

export async function storeIndices(db: D1Database, userId: string, indices: IndexData[]) {
  const now = new Date().toISOString();
  for (const idx of indices) {
    await db
      .prepare(
        `INSERT OR REPLACE INTO market_indices (user_id, symbol, value, change_pct, asof, source)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(userId, idx.symbol, idx.value, idx.change_pct, now, idx.source)
      .run();
  }
}

// ─── Market regime snapshot ─────────────────────────

export async function storeRegimeSnapshot(
  db: D1Database,
  userId: string,
  data: { spx_change?: number; ndx_change?: number; vix_level?: number; breadth_score?: number; risk_mode: string }
) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT OR REPLACE INTO market_regime_snapshots (id, user_id, asof, spx_change, ndx_change, vix_level, breadth_score, risk_mode, notes_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')`
      )
      .bind(id, userId, now, data.spx_change ?? null, data.ndx_change ?? null, data.vix_level ?? null, data.breadth_score ?? null, data.risk_mode)
      .run();
  } catch { /* non-fatal */ }
}

// ─── Default provider instance ──────────────────────

export function getQuoteProvider(): QuoteProvider {
  return new FreeQuoteProvider();
}

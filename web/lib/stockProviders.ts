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
import { httpRequest } from "./http";

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
const DEFAULT_PROVIDER_SYMBOL_CAP = 40;
const DEFAULT_PROVIDER_ORDER = ["yahoo", "polygon", "finnhub", "twelvedata", "stock-intel"] as const;
type ProviderName = (typeof DEFAULT_PROVIDER_ORDER)[number];

/* ================================================================
   Env helper
   ================================================================ */

/** Detect whether we're running in a cloud/edge environment (Cloudflare Workers, etc.) */
function isCloudRuntime(): boolean {
  try {
    // Cloudflare Workers expose caches global; Node.js does not by default
    if (typeof globalThis !== "undefined" && typeof (globalThis as Record<string, unknown>).caches !== "undefined") return true;
    if (typeof process !== "undefined" && process.env) {
      if (typeof process.env.CF_PAGES !== "undefined") return true;
      if (typeof process.env.CF_PAGES_URL !== "undefined") return true;
    }
    return false;
  } catch { return false; }
}

export function getStockIntelBase(): string {
  const envBase = process.env.STOCK_INTEL_API_BASE;
  if (envBase) {
    // Block localhost/127.x in cloud runtimes — they can't reach it
    if (isCloudRuntime() && /localhost|127\.\d+\.\d+\.\d+/i.test(envBase)) {
      return "";
    }
    return envBase;
  }
  // No env set: only use localhost default in local dev
  if (isCloudRuntime()) return "";
  return "http://127.0.0.1:18093";
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
  return httpRequest(url, {
    method,
    body,
    headers,
    timeoutMs: TIMEOUT_MS,
    retries: MAX_RETRIES,
    retryDelayMs: 700,
    userAgent: "MCC-Stocks/2.0",
  });
}

function getProviderSymbolCap(): number {
  const n = Number(process.env.STOCK_PROVIDER_SYMBOL_CAP ?? DEFAULT_PROVIDER_SYMBOL_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_PROVIDER_SYMBOL_CAP;
}

function getProviderOrder(): ProviderName[] {
  const raw = process.env.STOCK_PROVIDER_ORDER;
  const parsed = (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) as ProviderName[];
  const list = parsed.length > 0 ? parsed : [...DEFAULT_PROVIDER_ORDER];
  const unique = Array.from(new Set(list)).filter((p) => (DEFAULT_PROVIDER_ORDER as readonly string[]).includes(p));
  return unique.length > 0 ? unique : [...DEFAULT_PROVIDER_ORDER];
}

function providerEnabled(order: ProviderName[], provider: ProviderName): boolean {
  return order.includes(provider);
}

function getApiKeys(...candidates: Array<string | undefined>): string[] {
  for (const c of candidates) {
    if (!c) continue;
    const keys = c.split(",").map((s) => s.trim()).filter(Boolean);
    if (keys.length > 0) return keys;
  }
  return [];
}

function pickApiKey(keys: string[], slot: number): string | null {
  if (keys.length === 0) return null;
  return keys[slot % keys.length] ?? keys[0] ?? null;
}

function unresolvedTickers(tickers: string[], seen: Set<string>, cap: number): string[] {
  return tickers
    .map((t) => t.toUpperCase())
    .filter((t) => t && !seen.has(t))
    .slice(0, cap);
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
  constructor(base?: string) { this.base = base ?? getStockIntelBase(); }

  /** True when Stock Intel API base is configured and reachable */
  get available(): boolean { return this.base.length > 0; }

  /* ── health ──────────────────────────────────────── */
  async checkHealth(): Promise<SourceHealth> {
    if (!this.available) return { name: this.name, status: "error", latencyMs: 0, error: "Stock Intel API base not configured" };
    const t = Date.now();
    try {
      await fetchWithRetry(`${this.base}/health`);
      return { name: this.name, status: "ok", latencyMs: Date.now() - t };
    } catch (err) { return failHealth(this.name, t, err); }
  }

  /* ── universe sync (POST /universe/sync) ─────────── */
  async syncUniverse(tickers: string[]): Promise<SourceHealth> {
    if (!this.available) return { name: `${this.name}/universe`, status: "error", latencyMs: 0, error: "Stock Intel not configured" };
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
    if (!this.available) return { name: `${this.name}/update`, status: "error", latencyMs: 0, error: "Stock Intel not configured" };
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
    const providerOrder = getProviderOrder();
    const symbolCap = getProviderSymbolCap();
    const quotes: QuoteData[] = [];
    const seen = new Set<string>();
    let yahooError: string | undefined;
    let sparkError: string | undefined;
    let polygonError: string | undefined;
    let finnhubError: string | undefined;
    let twelveDataError: string | undefined;

    // 1) Try Yahoo Finance first (primary — works in Cloudflare runtime)
    if (providerEnabled(providerOrder, "yahoo")) {
    try {
      const symbols = tickers.join(",");
      const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
      const res = await fetchWithRetry(yahooUrl);
      const body = await res.json() as Record<string, unknown>;
      const qr = (typeof body === "object" && body !== null)
        ? (body as Record<string, unknown>).quoteResponse as Record<string, unknown> | undefined
        : undefined;
      const results = (qr && Array.isArray(qr.result)) ? qr.result as Record<string, unknown>[] : [];

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
      // Yahoo returned data but parsed 0 valid quotes
      if (quotes.length === 0) {
        yahooError = `Yahoo returned 0 valid quotes (raw results: ${results.length}, symbols: ${symbols.slice(0, 200)})`;
      }
    } catch (err) {
      yahooError = `Yahoo fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    }

    // 1b) Yahoo Spark fallback (works when v7 quote endpoint is blocked)
    if (providerEnabled(providerOrder, "yahoo") && tickers.length > 0 && tickers.some((tk) => !seen.has(tk.toUpperCase()))) {
      try {
        const symbols = tickers.join(",");
        const sparkUrl = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols)}&range=1d&interval=5m`;
        const res = await fetchWithRetry(sparkUrl);
        const body = await res.json() as { spark?: { result?: Array<Record<string, unknown>> } };
        const sparkRows = body.spark?.result ?? [];
        for (const row of sparkRows) {
          const sym = String(row.symbol ?? "").toUpperCase();
          if (!sym || seen.has(sym)) continue;
          const response = Array.isArray(row.response) ? row.response[0] as Record<string, unknown> | undefined : undefined;
          const meta = response && typeof response.meta === "object" && response.meta !== null
            ? response.meta as Record<string, unknown>
            : null;
          const indicators = response && typeof response.indicators === "object" && response.indicators !== null
            ? response.indicators as Record<string, unknown>
            : null;
          const quoteRows = indicators && Array.isArray(indicators.quote) ? indicators.quote as Array<Record<string, unknown>> : [];
          const quote = quoteRows[0];

          const price = Number(meta?.regularMarketPrice ?? lastNumber(quote?.close) ?? 0);
          const prev = Number(meta?.regularMarketPreviousClose ?? meta?.previousClose ?? null);
          if (!Number.isFinite(price) || price <= 0) continue;
          const changePct = Number.isFinite(prev) && prev > 0 ? ((price - prev) / prev) * 100 : 0;

          seen.add(sym);
          quotes.push({
            ticker: sym,
            price,
            change_pct: changePct,
            volume: lastNumber(quote?.volume),
            premarket_price: null,
            premarket_change_pct: null,
            source: "yahoo-spark",
          });
        }
      } catch (err) {
        sparkError = `Yahoo spark fetch failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // 1c) Massive/Polygon fallback (optional)
    if (providerEnabled(providerOrder, "polygon") && tickers.length > 0 && tickers.some((tk) => !seen.has(tk.toUpperCase()))) {
      const polygonKeys = getApiKeys(process.env.MASSIVE_API_KEYS, process.env.POLYGON_API_KEYS, process.env.MASSIVE_API_KEY, process.env.POLYGON_API_KEY);
      if (polygonKeys.length > 0) {
        try {
          const unresolved = unresolvedTickers(tickers, seen, symbolCap);
          let slot = 0;
          for (const sym of unresolved) {
            if (seen.has(sym)) continue;
            const key = pickApiKey(polygonKeys, slot++);
            if (!key) continue;
            const q = await fetchPolygonPrev(sym, key);
            if (!q) continue;
            seen.add(sym);
            quotes.push({
              ticker: sym,
              price: q.price,
              change_pct: q.changePct,
              volume: q.volume,
              premarket_price: null,
              premarket_change_pct: null,
              source: "polygon",
            });
          }
        } catch (err) {
          polygonError = `Polygon fetch failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }

    // 1d) Finnhub fallback (optional, no browser session required)
    if (providerEnabled(providerOrder, "finnhub") && tickers.length > 0 && tickers.some((tk) => !seen.has(tk.toUpperCase()))) {
      const finnhubKeys = getApiKeys(process.env.FINNHUB_API_KEYS, process.env.FINNHUB_API_KEY);
      if (finnhubKeys.length > 0) {
        try {
          const unresolved = unresolvedTickers(tickers, seen, symbolCap);
          let slot = 0;
          for (const sym of unresolved) {
            if (seen.has(sym)) continue;
            const key = pickApiKey(finnhubKeys, slot++);
            if (!key) continue;
            const q = await fetchFinnhubQuote(sym, key);
            if (!q) continue;
            seen.add(sym);
            quotes.push({
              ticker: sym,
              price: q.price,
              change_pct: q.changePct,
              volume: null,
              premarket_price: null,
              premarket_change_pct: null,
              source: "finnhub",
            });
          }
        } catch (err) {
          finnhubError = `Finnhub fetch failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }

    // 1e) TwelveData fallback (optional)
    if (providerEnabled(providerOrder, "twelvedata") && tickers.length > 0 && tickers.some((tk) => !seen.has(tk.toUpperCase()))) {
      const twelveDataKeys = getApiKeys(process.env.TWELVEDATA_API_KEYS, process.env.TWELVEDATA_API_KEY);
      if (twelveDataKeys.length > 0) {
        try {
          const unresolved = unresolvedTickers(tickers, seen, symbolCap);
          let slot = 0;
          for (const sym of unresolved) {
            if (seen.has(sym)) continue;
            const key = pickApiKey(twelveDataKeys, slot++);
            if (!key) continue;
            const q = await fetchTwelveDataQuote(sym, key);
            if (!q) continue;
            seen.add(sym);
            quotes.push({
              ticker: sym,
              price: q.price,
              change_pct: q.changePct,
              volume: q.volume,
              premarket_price: null,
              premarket_change_pct: null,
              source: "twelvedata",
            });
          }
        } catch (err) {
          twelveDataError = `TwelveData fetch failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }

    // 2) Fallback to Stock Intel (only if configured)
    if (providerEnabled(providerOrder, "stock-intel") && this.available) {
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
    } // end if (this.available)

    // Determine actual source label — don't say "stock-intel" if only yahoo was used
    const hasYahoo = quotes.some((q) => q.source.startsWith("yahoo"));
    const hasPolygon = quotes.some((q) => q.source === "polygon");
    const hasFinnhub = quotes.some((q) => q.source === "finnhub");
    const hasTwelveData = quotes.some((q) => q.source === "twelvedata");
    const hasIntel = quotes.some((q) => q.source === "stock-intel");
    const sourceName = hasYahoo && hasIntel
      ? "yahoo+stock-intel"
      : hasYahoo
        ? "yahoo"
        : hasPolygon
          ? "polygon"
        : hasFinnhub
          ? "finnhub"
        : hasTwelveData
          ? "twelvedata"
          : hasIntel
            ? "stock-intel"
            : "none";
    const status = quotes.length > 0 ? "ok" : "error";
    const errorMsg = status === "error"
      ? [yahooError, sparkError, polygonError, finnhubError, twelveDataError, "All sources returned 0 quotes"].filter(Boolean).join("; ")
      : undefined;
    return { quotes, health: { name: sourceName, status, latencyMs: Date.now() - t, ...(errorMsg ? { error: errorMsg } : {}) } };
  }

  /* ── indices: Yahoo Finance first, Stock Intel fallback ────── */
  async fetchIndices(): Promise<{ indices: IndexData[]; health: SourceHealth }> {
    const t = Date.now();
    const providerOrder = getProviderOrder();
    const indices: IndexData[] = [];
    const yahooSymbols = "^GSPC,^IXIC,BTC-USD";
    const symbolCap = getProviderSymbolCap();
    let yahooError: string | undefined;
    let chartError: string | undefined;
    let polygonError: string | undefined;
    let finnhubError: string | undefined;
    let twelveDataError: string | undefined;

    // 1) Try Yahoo Finance for ^GSPC, ^IXIC, BTC-USD
    if (providerEnabled(providerOrder, "yahoo")) {
    try {
      const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(yahooSymbols)}`;
      const res = await fetchWithRetry(yahooUrl);
      const body = await res.json() as Record<string, unknown>;
      const qr = (typeof body === "object" && body !== null)
        ? (body as Record<string, unknown>).quoteResponse as Record<string, unknown> | undefined
        : undefined;
      const results = (qr && Array.isArray(qr.result)) ? qr.result as Record<string, unknown>[] : [];

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
      // Yahoo returned data but parsed 0 valid indices
      yahooError = `Yahoo returned 0 valid indices (raw results: ${results.length}, symbols: ${yahooSymbols})`;
    } catch (err) {
      yahooError = `Yahoo indices fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    }

    // 1b) Yahoo chart fallback for indices
    if (providerEnabled(providerOrder, "yahoo") && indices.length === 0) {
      try {
        const symbolMap: Array<{ raw: string; mapped: string }> = [
          { raw: "^GSPC", mapped: "SPX" },
          { raw: "^IXIC", mapped: "IXIC" },
          { raw: "BTC-USD", mapped: "BTC" },
        ];
        for (const { raw, mapped } of symbolMap) {
          const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(raw)}?range=1d&interval=5m`;
          const res = await fetchWithRetry(chartUrl);
          const body = await res.json() as { chart?: { result?: Array<Record<string, unknown>> } };
          const row = body.chart?.result?.[0];
          if (!row || typeof row !== "object") continue;
          const meta = typeof row.meta === "object" && row.meta !== null ? row.meta as Record<string, unknown> : null;
          const price = Number(meta?.regularMarketPrice ?? 0);
          const prev = Number(meta?.chartPreviousClose ?? meta?.previousClose ?? null);
          if (!Number.isFinite(price) || price <= 0) continue;
          const changePct = Number.isFinite(prev) && prev > 0 ? ((price - prev) / prev) * 100 : 0;
          indices.push({
            symbol: mapped,
            value: price,
            change_pct: changePct,
            source: "yahoo-chart",
          });
        }
      } catch (err) {
        chartError = `Yahoo chart indices fetch failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // 1c) Massive/Polygon fallback with liquid proxies (SPY->SPX, QQQ->IXIC, X:BTCUSD->BTC)
    if (providerEnabled(providerOrder, "polygon") && indices.length === 0) {
      const polygonKeys = getApiKeys(process.env.MASSIVE_API_KEYS, process.env.POLYGON_API_KEYS, process.env.MASSIVE_API_KEY, process.env.POLYGON_API_KEY);
      if (polygonKeys.length > 0) {
        try {
          const proxies: Array<{ sourceSymbol: string; target: "SPX" | "IXIC" | "BTC" }> = [
            { sourceSymbol: "SPY", target: "SPX" },
            { sourceSymbol: "QQQ", target: "IXIC" },
            { sourceSymbol: "X:BTCUSD", target: "BTC" },
          ];
          let slot = 0;
          for (const p of proxies.slice(0, Math.max(1, symbolCap))) {
            const key = pickApiKey(polygonKeys, slot++);
            if (!key) continue;
            const q = await fetchPolygonPrev(p.sourceSymbol, key);
            if (!q) continue;
            indices.push({
              symbol: p.target,
              value: q.price,
              change_pct: q.changePct,
              source: "polygon",
            });
          }
        } catch (err) {
          polygonError = `Polygon indices fetch failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }

    // 1d) Finnhub fallback with liquid proxies (SPY->SPX, QQQ->IXIC, BINANCE:BTCUSDT->BTC)
    if (providerEnabled(providerOrder, "finnhub") && indices.length === 0) {
      const finnhubKeys = getApiKeys(process.env.FINNHUB_API_KEYS, process.env.FINNHUB_API_KEY);
      if (finnhubKeys.length > 0) {
        try {
          const proxies: Array<{ sourceSymbol: string; target: "SPX" | "IXIC" | "BTC" }> = [
            { sourceSymbol: "SPY", target: "SPX" },
            { sourceSymbol: "QQQ", target: "IXIC" },
            { sourceSymbol: "BINANCE:BTCUSDT", target: "BTC" },
          ];
          let slot = 0;
          for (const p of proxies.slice(0, Math.max(1, symbolCap))) {
            const key = pickApiKey(finnhubKeys, slot++);
            if (!key) continue;
            const q = await fetchFinnhubQuote(p.sourceSymbol, key);
            if (!q) continue;
            indices.push({
              symbol: p.target,
              value: q.price,
              change_pct: q.changePct,
              source: "finnhub",
            });
          }
        } catch (err) {
          finnhubError = `Finnhub indices fetch failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }

    // 1e) TwelveData fallback with liquid proxies (SPY->SPX, QQQ->IXIC, BTC/USD->BTC)
    if (providerEnabled(providerOrder, "twelvedata") && indices.length === 0) {
      const twelveDataKeys = getApiKeys(process.env.TWELVEDATA_API_KEYS, process.env.TWELVEDATA_API_KEY);
      if (twelveDataKeys.length > 0) {
        try {
          const proxies: Array<{ sourceSymbol: string; target: "SPX" | "IXIC" | "BTC" }> = [
            { sourceSymbol: "SPY", target: "SPX" },
            { sourceSymbol: "QQQ", target: "IXIC" },
            { sourceSymbol: "BTC/USD", target: "BTC" },
          ];
          let slot = 0;
          for (const p of proxies.slice(0, Math.max(1, symbolCap))) {
            const key = pickApiKey(twelveDataKeys, slot++);
            if (!key) continue;
            const q = await fetchTwelveDataQuote(p.sourceSymbol, key);
            if (!q) continue;
            indices.push({
              symbol: p.target,
              value: q.price,
              change_pct: q.changePct,
              source: "twelvedata",
            });
          }
        } catch (err) {
          twelveDataError = `TwelveData indices fetch failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }

    // 2) Fallback to Stock Intel summaries (only if configured)
    if (providerEnabled(providerOrder, "stock-intel") && this.available) {
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
    } // end if (this.available)

    const status = indices.length > 0 ? "ok" : "error";
    const sourceName = indices.some((i) => i.source.startsWith("yahoo"))
      ? "yahoo/indices"
      : indices.some((i) => i.source === "polygon")
        ? "polygon/indices"
      : indices.some((i) => i.source === "finnhub")
        ? "finnhub/indices"
      : indices.some((i) => i.source === "twelvedata")
        ? "twelvedata/indices"
        : indices.length > 0
          ? `${this.name}/summaries`
          : "none/indices";
    const errorMsg = status === "error"
      ? [yahooError, chartError, polygonError, finnhubError, twelveDataError, `All index sources returned empty (requested: ${yahooSymbols})`].filter(Boolean).join("; ")
      : undefined;
    return { indices, health: { name: sourceName, status, latencyMs: Date.now() - t, ...(errorMsg ? { error: errorMsg } : {}) } };
  }

  /* ── movers (GET /market/movers-by-news) ─────────── */
  async getMovers(): Promise<{ movers: Record<string, unknown>[]; health: SourceHealth }> {
    if (!this.available) return { movers: [], health: { name: `${this.name}/movers`, status: "error", latencyMs: 0, error: "Stock Intel not configured" } };
    const t = Date.now();
    try {
      const res = await fetchWithRetry(`${this.base}/market/movers-by-news`);
      const body = await res.json() as unknown;
      return { movers: toArray(body, "movers"), health: { name: `${this.name}/movers`, status: "ok", latencyMs: Date.now() - t } };
    } catch (err) { return { movers: [], health: failHealth(`${this.name}/movers`, t, err) }; }
  }

  /* ── ticker news (GET /ticker/{sym}/news) ────────── */
  async getTickerNews(symbol: string): Promise<{ items: Record<string, unknown>[]; health: SourceHealth }> {
    if (!this.available) return { items: [], health: { name: `${this.name}/ticker-news`, status: "error", latencyMs: 0, error: "Stock Intel not configured" } };
    const t = Date.now();
    try {
      const res = await fetchWithRetry(`${this.base}/ticker/${encodeURIComponent(symbol)}/news`);
      const body = await res.json() as unknown;
      return { items: toArray(body, "items", "news"), health: { name: `${this.name}/ticker-news`, status: "ok", latencyMs: Date.now() - t } };
    } catch (err) { return { items: [], health: failHealth(`${this.name}/ticker-news`, t, err) }; }
  }

  /* ── ticker why (GET /ticker/{sym}/why) ──────────── */
  async getTickerWhy(symbol: string): Promise<{ analysis: Record<string, unknown> | null; health: SourceHealth }> {
    if (!this.available) return { analysis: null, health: { name: `${this.name}/ticker-why`, status: "error", latencyMs: 0, error: "Stock Intel not configured" } };
    const t = Date.now();
    try {
      const res = await fetchWithRetry(`${this.base}/ticker/${encodeURIComponent(symbol)}/why`);
      const data = await res.json() as Record<string, unknown>;
      return { analysis: data, health: { name: `${this.name}/ticker-why`, status: "ok", latencyMs: Date.now() - t } };
    } catch (err) { return { analysis: null, health: failHealth(`${this.name}/ticker-why`, t, err) }; }
  }

  /* ── daily summary (GET /summaries/daily) ────────── */
  async getDailySummary(): Promise<{ summary: Record<string, unknown> | null; health: SourceHealth }> {
    if (!this.available) return { summary: null, health: { name: `${this.name}/summaries`, status: "error", latencyMs: 0, error: "Stock Intel not configured" } };
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
   Text sanitisation — decode HTML entities, strip tag leftovers
   ================================================================ */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", ndash: "–", mdash: "—", lsquo: "\u2018",
  rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D",
  bull: "•", hellip: "…", trade: "™", copy: "©", reg: "®",
};

/** Decode numeric + named HTML entities, strip leftover tags, collapse whitespace. */
export function sanitizeText(raw: string): string {
  if (!raw) return "";
  let s = raw;
  // numeric entities (dec & hex)
  s = s.replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => {
    const cp = parseInt(hex, 16);
    return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : "";
  });
  s = s.replace(/&#(\d+);/g, (_, dec) => {
    const cp = parseInt(dec, 10);
    return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : "";
  });
  // named entities (strip unresolved ones)
  s = s.replace(/&([A-Za-z]+);/g, (_, name) => NAMED_ENTITIES[name.toLowerCase()] ?? "");
  // strip any remaining broken entity-like fragments (e.g. "&amp" without semicolon)
  s = s.replace(/&[A-Za-z]{2,8}(?=[^;A-Za-z]|$)/g, "");
  // strip any remaining HTML tags
  s = s.replace(/<[^>]*>/g, " ");
  // collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  // trim weird trailing punctuation fragments  ( e.g. "headline ;" or "headline |" )
  s = s.replace(/\s*[;|\\]+\s*$/, "");
  return s;
}

/* ================================================================
   RSS news feeds (free fallback when Stock Intel is unavailable)
   ================================================================ */

export const STOCK_NEWS_FEEDS = [
  { name: "MarketWatch", url: "https://feeds.marketwatch.com/marketwatch/topstories/" },
  { name: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" },
  { name: "Reuters Business", url: "https://feeds.reuters.com/reuters/businessNews" },
  { name: "Reuters Markets", url: "https://feeds.reuters.com/news/wealth" },
  { name: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex" },
  { name: "Google News: Stock Market", url: "https://news.google.com/rss/search?q=stock+market+OR+earnings+OR+guidance&hl=en-US&gl=US&ceid=US:en" },
  { name: "Google News: Large Caps", url: "https://news.google.com/rss/search?q=AAPL+OR+NVDA+OR+TSLA+OR+MSFT+stock&hl=en-US&gl=US&ceid=US:en" },
  { name: "SEC Litigation", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=LIT&dateb=&owner=include&count=40&search_text=&action=getcompany&RSS=1" },
];

/* ================================================================
   Quality gate — high-signal headline filter
   ================================================================ */

const LOW_SIGNAL_PATTERNS = [
  /\bmarket\s*wrap\b/i,
  /\bweekly\s*roundup\b/i,
  /\bmorning\s*brief\b/i,
  /\beverything\s*you\s*need\s*to\s*know\b/i,
  /\bwhat\s*to\s*watch\s*today\b/i,
  /\bpremarket\s*buzz\b/i,
  /\bstock\s*futures\s*(are\s*)?(mixed|flat|little changed)\b/i,
  /\bmarkets?\s*(close|end)\s*(higher|lower|mixed|flat)\b/i,
  /\bhere'?s?\s*what\s*happened\b/i,
  /\btop\s*stories\s*for\b/i,
  /\bshould\s+you\s+(buy|sell)\b/i,
  /\bwhat\s+.{0,30}\s+means\s+for\b/i,
  /\bmarket\s*snapshot\b/i,
  /\bmarket\s*briefing\b/i,
  /\bbest\s+(savings?|cd|bank|credit\s*card|mortgage)\b/i,
  /\bhome\s*buy(ing|ers?)\b/i,
  /\bpersonal\s*finance\b/i,
  /\bretire(ment)?\s*(planning|saving|tips)\b/i,
  /\bhow\s+to\s+(save|invest|budget|pay off)\b/i,
  /\bbest\s+stocks?\s+to\s+buy\b/i,
  /\btop\s+\d+\s+(picks?|stocks?)\b/i,
];

const STRONG_CATALYST_PATTERNS = [
  /\bearnings?\b|\bquarter(ly)?\sresults?\b|\brevenue\b|\bbeat\b|\bmiss(es)?\b|\beps\b/i,
  /\bguidance\b|\boutlook\b|\braise[ds]?\s.*guidance\b|\blower[eds]?\s.*forecast\b/i,
  /\bupgrade[ds]?\b|\bdowngrade[ds]?\b|\bprice\s*target\b|\banalyst\b/i,
  /\bacquisition\b|\bmerger\b|\bm\s*&\s*a\b|\bbuyout\b|\btakeover\b/i,
  /\blaunch(es|ed)?\b|\bfda\s*approv(al|ed)\b|\bnew\s+product\b|\bchip\b|\biphone\b|\bmac\b|\bsoftware\b/i,
  /\blawsuit\b|\bprobe\b|\bsec\s+(charges?|investigat)\b|\bfraud\b/i,
  /\bbankrupt(cy)?\b|\bdefault\b|\bdelisting\b/i,
];

const MARKET_KEYWORDS = [
  /\bstock(s)?\b|\bshares?\b|\bmarket(s)?\b|\bwall\s*street\b/i,
  /\bearnings?\b|\brevenue\b|\beps\b|\bguidance\b|\boutlook\b/i,
  /\banalyst\b|\bupgrade\b|\bdowngrade\b|\bprice\s*target\b/i,
  /\bfed\b|\binflation\b|\bcpi\b|\brates?\b|\byield(s)?\b|\btreasury\b/i,
  /\bnasdaq\b|\bs&p\b|\bdow\b|\brussell\b|\bindex\b/i,
  /\bipo\b|\bbuyback\b|\bdividend\b|\bmerger\b|\bacquisition\b/i,
  /\bbitcoin\b|\bcrypto\b|\beth\b|\betf\b/i,
];

function isMarketRelevantText(title: string, summary?: string | null): boolean {
  const text = `${title} ${summary || ""}`;
  for (const p of MARKET_KEYWORDS) if (p.test(text)) return true;
  return false;
}

function selectFeedsForScan(feeds: typeof STOCK_NEWS_FEEDS): typeof STOCK_NEWS_FEEDS {
  const cap = getEnvInt("STOCK_NEWS_FEED_CAP", 6);
  if (feeds.length <= cap) return feeds;
  const now = new Date();
  const slot = now.getUTCHours() * 2 + (now.getUTCMinutes() >= 30 ? 1 : 0);
  const start = slot % feeds.length;
  const selected: typeof STOCK_NEWS_FEEDS = [];
  for (let i = 0; i < cap; i++) selected.push(feeds[(start + i) % feeds.length]);
  return selected;
}

/** Returns false for generic/low-value headlines (market wraps, roundups, etc.) */
export function isQualityHeadline(title: string): boolean {
  if (!title || title.length < 15) return false;
  for (const p of LOW_SIGNAL_PATTERNS) if (p.test(title)) return false;
  return true;
}

/**
 * Stricter quality gate: returns true only for headlines likely to
 * carry an actionable stock catalyst or watchlist-relevant signal.
 */
export function isHighSignalHeadline(title: string, summary?: string | null): boolean {
  if (!title || title.length < 15) return false;
  const text = `${title} ${summary || ""}`;
  // Hard drop low-signal
  for (const p of LOW_SIGNAL_PATTERNS) if (p.test(text)) return false;
  // Auto-keep if strong catalyst detected
  for (const p of STRONG_CATALYST_PATTERNS) if (p.test(text)) return true;
  // Auto-keep if contains $TICKER reference
  if (/\$[A-Z]{1,5}\b/.test(text)) return true;
  // Pass through — will be ranked by relevance scoring
  return true;
}

/* ================================================================
   Watchlist-first relevance scoring
   ================================================================ */

export interface NewsRelevanceResult {
  impactScore: number;
  reasonTags: string[];
  isWatchlistRelevant: boolean;
}

const PREMIUM_SOURCES = new Set(["Reuters Tech", "SEC Litigation", "WSJ Markets"]);

export function scoreNewsRelevance(
  title: string,
  summary: string | null | undefined,
  ticker: string | null | undefined,
  watchlistTickers: Set<string>,
  catalystType: string | null | undefined,
  source: string,
  publishedAt: string | null | undefined,
): NewsRelevanceResult {
  let score = 0;
  const reasons: string[] = [];

  // +4 watchlist ticker
  if (ticker && watchlistTickers.has(ticker.toUpperCase())) {
    score += 4; reasons.push("watchlist_ticker");
  }

  // +3 strong catalyst type
  const strongCatalysts = new Set(["earnings", "guidance", "m&a", "analyst_rating", "legal", "product"]);
  if (catalystType && strongCatalysts.has(catalystType)) {
    score += 3; reasons.push(catalystType);
  }

  // +2 premium source
  if (PREMIUM_SOURCES.has(source)) {
    score += 2; reasons.push(`${source.toLowerCase().replace(/\s+/g, "_")}_source`);
  }

  // -3 low signal
  const text = `${title} ${summary || ""}`;
  for (const p of LOW_SIGNAL_PATTERNS) {
    if (p.test(text)) { score -= 3; reasons.push("low_signal"); break; }
  }

  // -2 no ticker and no catalyst
  if (!ticker && !catalystType) {
    score -= 2; reasons.push("no_ticker_no_catalyst");
  }

  // -1 older than 24h
  if (publishedAt) {
    const age = Date.now() - new Date(publishedAt).getTime();
    if (age > 24 * 60 * 60 * 1000) { score -= 1; reasons.push("stale_24h"); }
  }

  return {
    impactScore: score,
    reasonTags: reasons,
    isWatchlistRelevant: ticker != null && watchlistTickers.has(ticker.toUpperCase()),
  };
}

/* ================================================================
   Ticker extraction — improved with stop-word filter
   ================================================================ */

const TICKER_STOP_WORDS = new Set([
  "A", "I", "AM", "AN", "AS", "AT", "BE", "BY", "DO", "GO",
  "IF", "IN", "IS", "IT", "MY", "NO", "OF", "ON", "OR", "SO",
  "TO", "UP", "US", "WE", "AI", "CEO", "CFO", "CTO", "COO",
  "FOR", "THE", "AND", "BUT", "NOT", "HAS", "HAD", "ARE", "WAS",
  "ALL", "CAN", "HER", "HIM", "HIS", "HOW", "ITS", "LET", "MAY",
  "NEW", "NOW", "OLD", "OUR", "OUT", "OWN", "SAY", "SHE", "TOO",
  "TWO", "WAY", "WHO", "BOY", "DID", "GET", "HIT", "HOT", "LOW",
  "MAN", "OIL", "PUT", "RAN", "RED", "RUN", "TOP", "WIN", "YES",
  "SEC", "FDA", "IPO", "ETF", "GDP", "IMF", "USA", "NYSE", "CEO",
]);

/**
 * Extract $TICKER mentions from text (high confidence),
 * plus ALL-CAPS tokens that are in the watchlist (medium confidence).
 */
export function extractTickersFromText(text: string, watchlistTickers?: Set<string>): string[] {
  if (!text) return [];
  const found = new Set<string>();

  // High confidence: $TICKER pattern
  const dollarMatches = text.match(/\$([A-Za-z]{1,5})\b/g);
  if (dollarMatches) {
    for (const m of dollarMatches) {
      const t = m.slice(1).toUpperCase();
      if (t.length >= 1 && t.length <= 5 && !TICKER_STOP_WORDS.has(t)) found.add(t);
    }
  }

  // Medium confidence: ALL-CAPS tokens that are in watchlist
  if (watchlistTickers && watchlistTickers.size > 0) {
    const capMatches = text.match(/\b([A-Z]{1,5})\b/g);
    if (capMatches) {
      for (const m of capMatches) {
        if (watchlistTickers.has(m) && !TICKER_STOP_WORDS.has(m)) found.add(m);
      }
    }
  }

  return [...found];
}

export interface NewsScanResult {
  newItems: number;
  sources: SourceHealth[];
  staleFallbackUsed: boolean;
}

function getEnvInt(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

async function pruneOldStockNews(db: D1Database, userId: string): Promise<void> {
  const keepRows = getEnvInt("STOCK_NEWS_MAX_ROWS_PER_USER", 1200);
  try {
    await db.prepare(
      `DELETE FROM stock_news_items
       WHERE user_id = ?
         AND id NOT IN (
           SELECT id FROM stock_news_items
           WHERE user_id = ?
           ORDER BY fetched_at DESC
           LIMIT ?
         )`,
    ).bind(userId, userId, keepRows).run();
  } catch {
    // non-fatal cleanup
  }
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

  // Build watchlist set for relevance scoring
  let watchlistSet = new Set<string>();
  try {
    const wl = await db.prepare(`SELECT ticker FROM stock_watchlist WHERE user_id = ?`).bind(userId).all<{ ticker: string }>();
    watchlistSet = new Set((wl.results || []).map((r) => r.ticker.toUpperCase()));
  } catch { /* non-fatal */ }

  // 1) Stock Intel per-ticker news
  if (intelProvider?.available) {
    const start = Date.now();
    try {
      const tickerCap = getEnvInt("STOCK_NEWS_TICKER_CAP", 8);
      for (const ticker of [...watchlistSet].slice(0, tickerCap)) {
        try {
          const { items, health } = await intelProvider.getTickerNews(ticker);
          if (health.status !== "ok") continue;
          for (const item of items) {
            const rawTitle = String(item.title || item.headline || "");
            const rawSummary = String(item.summary || item.description || "");
            const title = sanitizeText(rawTitle).slice(0, 300);
            const summary = sanitizeText(rawSummary).slice(0, 400) || null;
            const url = String(item.url || item.link || "");
            if (!title || !url) continue;
            if (!isHighSignalHeadline(title, summary)) continue;
            const dedupeKey = url.replace(/[?#].*$/, "").toLowerCase();
            const catalyst = classifyCatalyst(title, summary);
            const sentiment = item.sentiment_score != null ? Number(item.sentiment_score) : scoreSentiment(title, summary);
            const pubAt = String(item.published_at || item.date || "");
            const rel = scoreNewsRelevance(title, summary, ticker, watchlistSet, catalyst, "stock-intel", pubAt);
            try {
              const insertResult = await db.prepare(
                `INSERT OR IGNORE INTO stock_news_items
                 (id, user_id, ticker, title, source, url, published_at, fetched_at, summary, impact_score, dedupe_key, sentiment_score, catalyst_type)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              ).bind(
                crypto.randomUUID(), userId, ticker, title, "stock-intel", url,
                pubAt, now, summary, rel.impactScore, dedupeKey, sentiment, catalyst,
              ).run();
              const changes = Number((insertResult.meta as { changes?: unknown } | undefined)?.changes ?? 0);
              if (changes > 0) newItems++;
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
  const perFeedCap = getEnvInt("STOCK_NEWS_FEED_ITEM_CAP", 25);
  for (const feed of selectFeedsForScan(STOCK_NEWS_FEEDS)) {
    const start = Date.now();
    try {
      const res = await fetchWithRetry(feed.url);
      const xml = await res.text();
      let processed = 0;
      for (const item of parseFeed(xml)) {
        if (processed >= perFeedCap) break;
        if (!item.url || !item.title) continue;
        const title = sanitizeText(item.title).slice(0, 300);
        const summary = item.summary ? sanitizeText(item.summary).slice(0, 400) : null;
        if (!isHighSignalHeadline(title, summary)) continue;
        const dedupeKey = item.url.replace(/[?#].*$/, "").toLowerCase();
        const catalyst = classifyCatalyst(title, summary);
        const sentiment = scoreSentiment(title, summary);
        // Try to extract a ticker from the headline
        const extracted = extractTickersFromText(`${title} ${summary || ""}`, watchlistSet);
        const ticker = extracted.length > 0 ? extracted[0] : null;
        if (!ticker && !isMarketRelevantText(title, summary)) continue;
        const rel = scoreNewsRelevance(title, summary, ticker, watchlistSet, catalyst, feed.name, item.publishedAt);
        if (rel.impactScore < 1) continue;
        try {
          const insertResult = await db.prepare(
            `INSERT OR IGNORE INTO stock_news_items
             (id, user_id, ticker, title, source, url, published_at, fetched_at, summary, impact_score, dedupe_key, sentiment_score, catalyst_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            crypto.randomUUID(), userId, ticker, title, feed.name, item.url,
            item.publishedAt, now, summary, rel.impactScore, dedupeKey, sentiment, catalyst,
          ).run();
          const changes = Number((insertResult.meta as { changes?: unknown } | undefined)?.changes ?? 0);
          if (changes > 0) {
            newItems++;
            processed++;
          }
        } catch { /* dedupe */ }
      }
      sources.push({ name: feed.name, status: "ok", latencyMs: Date.now() - start });
    } catch (err) {
      sources.push(failHealth(feed.name, start, err));
    }
  }

  await pruneOldStockNews(db, userId);
  return { newItems, sources, staleFallbackUsed: sources.every((s) => s.status !== "ok") };
}

/* ================================================================
   Singleton accessor
   ================================================================ */

export function getStockIntelProvider(): StockIntelProvider {
  if (!(globalThis as { __mccStockProvider?: StockIntelProvider }).__mccStockProvider) {
    (globalThis as { __mccStockProvider?: StockIntelProvider }).__mccStockProvider = new StockIntelProvider();
  }
  return (globalThis as { __mccStockProvider?: StockIntelProvider }).__mccStockProvider as StockIntelProvider;
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

function lastNumber(v: unknown): number | null {
  if (!Array.isArray(v)) return null;
  for (let i = v.length - 1; i >= 0; i--) {
    const n = Number(v[i]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

async function fetchFinnhubQuote(
  symbol: string,
  token: string,
): Promise<{ price: number; changePct: number } | null> {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`;
  const res = await fetchWithRetry(url);
  const json = await res.json() as Record<string, unknown>;
  const price = Number(json.c ?? 0);
  const changePct = Number(json.dp ?? 0);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    price,
    changePct: Number.isFinite(changePct) ? changePct : 0,
  };
}

async function fetchPolygonPrev(
  symbol: string,
  apiKey: string,
): Promise<{ price: number; changePct: number; volume: number | null } | null> {
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev?adjusted=true&apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetchWithRetry(url);
  const json = await res.json() as {
    results?: Array<{ c?: number; o?: number; v?: number }>;
  };
  const row = json.results?.[0];
  const close = Number(row?.c ?? 0);
  const open = Number(row?.o ?? 0);
  if (!Number.isFinite(close) || close <= 0) return null;
  const changePct = Number.isFinite(open) && open > 0 ? ((close - open) / open) * 100 : 0;
  return {
    price: close,
    changePct,
    volume: Number.isFinite(Number(row?.v)) ? Number(row?.v) : null,
  };
}

async function fetchTwelveDataQuote(
  symbol: string,
  apiKey: string,
): Promise<{ price: number; changePct: number; volume: number | null } | null> {
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetchWithRetry(url);
  const json = await res.json() as Record<string, unknown>;
  if (json.code != null || json.status === "error") return null;

  const close = Number(json.close ?? 0);
  const changePctRaw = String(json.percent_change ?? "0").replace("%", "");
  const changePct = Number(changePctRaw);
  const volume = json.volume != null ? Number(json.volume) : null;

  if (!Number.isFinite(close) || close <= 0) return null;
  return {
    price: close,
    changePct: Number.isFinite(changePct) ? changePct : 0,
    volume: Number.isFinite(Number(volume)) ? Number(volume) : null,
  };
}

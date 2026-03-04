// web/lib/sports/news.ts — Sports news/rumor provider using RSS feeds
//
// Fetches league-specific RSS feeds, deduplicates, and normalizes.
// Includes rumor/trade/injury detection via keyword matching.

import { fetchWithRetry } from "./fetchWithRetry";
import { parseFeed } from "@/lib/rss";
import type { League, NormalizedNews, ProviderResult } from "./types";

/** RSS feeds by league — free/public sources */
const FEEDS: Record<League, { url: string; source: string }[]> = {
  nba: [
    { url: "https://www.espn.com/espn/rss/nba/news", source: "ESPN NBA" },
    { url: "https://hoopshype.com/feed/", source: "HoopsHype" },
  ],
  nfl: [
    { url: "https://www.espn.com/espn/rss/nfl/news", source: "ESPN NFL" },
  ],
  mlb: [
    { url: "https://www.espn.com/espn/rss/mlb/news", source: "ESPN MLB" },
  ],
  nhl: [
    { url: "https://www.espn.com/espn/rss/nhl/news", source: "ESPN NHL" },
  ],
};

const RUMOR_KEYWORDS = /trade|rumor|sign|waive|cut|injur|suspend|release|free.?agent|deal|acquir|swap|option|DFA|IR\b/i;
const INJURY_KEYWORDS = /injur|out\b|day-to-day|questionable|doubtful|concussion|ACL|MCL|hamstring|ankle|knee|shoulder/i;

function makeDedupeKey(url: string): string {
  // Use a simple hash of the canonical URL
  let hash = 0;
  const str = url.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "");
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return `news_${Math.abs(hash).toString(36)}`;
}

function detectRumor(title: string, summary: string | null): number {
  const text = `${title} ${summary || ""}`;
  return RUMOR_KEYWORDS.test(text) ? 1 : 0;
}

/**
 * Fetch sports news for a league from configured RSS feeds.
 */
export async function fetchSportsNews(league: League): Promise<ProviderResult<NormalizedNews>> {
  const feeds = FEEDS[league] || [];
  if (feeds.length === 0) {
    return { ok: true, data: [], source: "rss" };
  }

  const allItems: NormalizedNews[] = [];

  for (const feed of feeds) {
    try {
      const xml = await fetchWithRetry(feed.url, { timeoutMs: 6000 });
      if (!xml) continue;

      const items = parseFeed(xml);
      for (const item of items) {
        allItems.push({
          league,
          team_id: null,
          title: item.title,
          url: item.url,
          source: feed.source,
          published_at: item.publishedAt,
          summary: item.summary?.slice(0, 500) || null,
          rumor_flag: detectRumor(item.title, item.summary),
          dedupe_key: makeDedupeKey(item.url),
        });
      }
    } catch (err) {
      console.warn(`[sports-news] Failed to fetch ${feed.source}:`, err instanceof Error ? err.message : err);
    }
  }

  return { ok: true, data: allItems, source: "rss" };
}

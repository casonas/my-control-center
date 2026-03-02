// web/lib/rss.ts — Lightweight RSS/Atom parser for edge runtime
// No external dependencies. Parses XML with regex (sufficient for RSS feeds).

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: string | null;
  summary: string | null;
}

/** Decode common HTML entities. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

/** Extract text between XML tags. */
function tag(xml: string, tagName: string): string {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const m = xml.match(re);
  return m ? decodeEntities(m[1].trim()) : "";
}

/** Extract href from Atom <link> tags. */
function atomLink(xml: string): string {
  // <link rel="alternate" href="..." />
  const alt = xml.match(/<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["']/i);
  if (alt) return alt[1];
  // <link href="..." />
  const plain = xml.match(/<link[^>]+href=["']([^"']+)["']/i);
  if (plain) return plain[1];
  return tag(xml, "link");
}

/**
 * Parse an RSS or Atom feed into an array of FeedItems.
 * Handles RSS 2.0 (<item>) and Atom (<entry>) formats.
 */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];

  // Try RSS 2.0 <item> blocks
  const rssItems = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const block of rssItems) {
    const title = tag(block, "title");
    const url = tag(block, "link") || tag(block, "guid");
    const pubDate = tag(block, "pubDate") || tag(block, "dc:date");
    const desc = tag(block, "description") || tag(block, "content:encoded");

    if (title && url) {
      items.push({
        title: title.slice(0, 300),
        url: url.trim(),
        publishedAt: pubDate ? tryParseDate(pubDate) : null,
        summary: desc ? stripHtml(desc).slice(0, 400) : null,
      });
    }
  }

  // Try Atom <entry> blocks
  if (items.length === 0) {
    const atomEntries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    for (const block of atomEntries) {
      const title = tag(block, "title");
      const url = atomLink(block);
      const published = tag(block, "published") || tag(block, "updated");
      const summary = tag(block, "summary") || tag(block, "content");

      if (title && url) {
        items.push({
          title: title.slice(0, 300),
          url: url.trim(),
          publishedAt: published ? tryParseDate(published) : null,
          summary: summary ? stripHtml(summary).slice(0, 400) : null,
        });
      }
    }
  }

  return items;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function tryParseDate(s: string): string | null {
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

/** Infer basic tags from title keywords. */
export function inferTags(title: string): string[] {
  const lower = title.toLowerCase();
  const tags: string[] = [];
  if (/\bai\b|artificial intelligence|machine learning|llm|gpt/i.test(lower)) tags.push("AI");
  if (/security|cyber|hack|breach|malware|vulnerability|cve|ransomware/i.test(lower)) tags.push("Security");
  if (/cloud|aws|azure|gcp|serverless|kubernetes/i.test(lower)) tags.push("Cloud");
  if (/vulnerabilit|cve-|exploit|zero.?day|patch/i.test(lower)) tags.push("Vulnerability");
  if (/policy|regulation|compliance|gdpr|government|law/i.test(lower)) tags.push("Policy");
  if (/privacy|data.?protection|surveillance/i.test(lower)) tags.push("Privacy");
  return tags.length > 0 ? tags : ["Tech"];
}

/** Default RSS sources for a new user. */
export const DEFAULT_SOURCES: { name: string; url: string }[] = [
  { name: "Krebs on Security", url: "https://krebsonsecurity.com/feed/" },
  { name: "The Hacker News", url: "https://feeds.feedburner.com/TheHackersNews" },
  { name: "BleepingComputer", url: "https://www.bleepingcomputer.com/feed/" },
  { name: "Dark Reading", url: "https://www.darkreading.com/rss.xml" },
  { name: "Ars Technica - Security", url: "https://feeds.arstechnica.com/arstechnica/security" },
  { name: "CISA Alerts", url: "https://www.cisa.gov/news.xml" },
  { name: "Schneier on Security", url: "https://www.schneier.com/feed/atom/" },
  { name: "TechCrunch - Security", url: "https://techcrunch.com/category/security/feed/" },
];

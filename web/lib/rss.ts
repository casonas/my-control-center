// web/lib/rss.ts — Lightweight RSS/Atom parser for edge runtime
// No external dependencies. Parses XML with regex (sufficient for RSS feeds).

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: string | null;
  summary: string | null;
}

// ── Research Intelligence v2 types ──

export type Urgency = "low" | "medium" | "high" | "critical";
export type ItemType = "news" | "analysis" | "advisory" | "cve" | "policy" | "rumor";
export type EntityType = "company" | "threat_actor" | "cve" | "product" | "person";

export interface ScoredItem extends FeedItem {
  score: number;
  urgency: Urgency;
  itemType: ItemType;
  tags: string[];
  dedupeKey: string;
  entities: ExtractedEntity[];
}

export interface ExtractedEntity {
  type: EntityType;
  name: string;
  confidence: number;
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
export const DEFAULT_SOURCES: { name: string; url: string; category?: string }[] = [
  { name: "Krebs on Security", url: "https://krebsonsecurity.com/feed/", category: "cyber" },
  { name: "The Hacker News", url: "https://feeds.feedburner.com/TheHackersNews", category: "cyber" },
  { name: "BleepingComputer", url: "https://www.bleepingcomputer.com/feed/", category: "cyber" },
  { name: "Dark Reading", url: "https://www.darkreading.com/rss.xml", category: "cyber" },
  { name: "Ars Technica - Security", url: "https://feeds.arstechnica.com/arstechnica/security", category: "cyber" },
  { name: "CISA Alerts", url: "https://www.cisa.gov/news.xml", category: "advisory" },
  { name: "Schneier on Security", url: "https://www.schneier.com/feed/atom/", category: "analysis" },
  { name: "TechCrunch - Security", url: "https://techcrunch.com/category/security/feed/", category: "tech" },
];

// ── URL canonicalization / Deduplication ──

export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    // Strip tracking params
    for (const p of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref", "source"]) {
      u.searchParams.delete(p);
    }
    // Normalise trailing slash for path-only URLs
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString().toLowerCase();
  } catch {
    return raw.replace(/[?#].*$/, "").toLowerCase();
  }
}

export function makeDedupeKey(url: string): string {
  return canonicalizeUrl(url);
}

// ── Item Type Classification (rule-based) ──

export function classifyItemType(title: string, summary?: string | null): ItemType {
  const text = `${title} ${summary || ""}`.toLowerCase();
  if (/\bcve-\d{4}-\d{4,}\b/.test(text)) return "cve";
  if (/\badvisory\b|\balert\b|\bbulletin\b|\bkev\b|\bcisa\b/.test(text)) return "advisory";
  if (/\bpolicy\b|\bregulat\b|\bcompliance\b|\bexecutive order\b|\blegislat\b/.test(text)) return "policy";
  if (/\brumor\b|\bunconfirmed\b|\balleged\b|\breportedly\b/.test(text)) return "rumor";
  if (/\banalysis\b|\bdeep dive\b|\binvestigat\b|\bresearch\b|\breport\b/.test(text)) return "analysis";
  return "news";
}

// ── Scoring Engine (rule-based) ──

const SCORE_BOOSTS: { pattern: RegExp; boost: number; label: string }[] = [
  { pattern: /active.?exploit|exploit.?in.?the.?wild|under.?attack/i, boost: 30, label: "active exploitation" },
  { pattern: /zero.?day|0.?day/i, boost: 25, label: "zero-day" },
  { pattern: /\bkev\b|known.?exploited/i, boost: 20, label: "KEV" },
  { pattern: /critical.?patch|emergency.?patch|out.?of.?band/i, boost: 20, label: "critical patch" },
  { pattern: /ransomware|supply.?chain.?attack/i, boost: 18, label: "ransomware/supply-chain" },
  { pattern: /\bcve-\d{4}-\d{4,}\b/i, boost: 15, label: "CVE mention" },
  { pattern: /government|healthcare|infrastructure|energy|financial/i, boost: 12, label: "high-impact sector" },
  { pattern: /data.?breach|leak|exposed/i, boost: 10, label: "data breach" },
  { pattern: /microsoft|google|apple|cisco|fortinet|palo.?alto|crowdstrike/i, boost: 8, label: "major vendor" },
  { pattern: /\bai\b|artificial.?intelligence|llm|machine.?learning/i, boost: 5, label: "AI/ML" },
];

export interface ScoreResult {
  score: number;
  urgency: Urgency;
  reasons: string[];
}

export function scoreItem(title: string, summary?: string | null): ScoreResult {
  const text = `${title} ${summary || ""}`;
  let score = 10; // baseline
  const reasons: string[] = [];

  for (const { pattern, boost, label } of SCORE_BOOSTS) {
    if (pattern.test(text)) {
      score += boost;
      reasons.push(label);
    }
  }

  score = Math.min(score, 100);

  let urgency: Urgency = "low";
  if (score >= 70) urgency = "critical";
  else if (score >= 50) urgency = "high";
  else if (score >= 30) urgency = "medium";

  return { score, urgency, reasons };
}

// ── Entity Extraction (rule-based) ──

const CVE_PATTERN = /\bCVE-\d{4}-\d{4,}\b/gi;

const KNOWN_VENDORS = [
  "Microsoft", "Google", "Apple", "Amazon", "Meta", "Cisco", "Fortinet",
  "Palo Alto", "CrowdStrike", "SentinelOne", "Mandiant", "VMware",
  "Broadcom", "IBM", "Oracle", "SAP", "Salesforce", "Adobe", "Intel",
  "AMD", "NVIDIA", "Samsung", "Qualcomm", "Cloudflare", "Okta",
  "SolarWinds", "Ivanti", "Juniper", "F5", "Barracuda", "Sophos",
  "Check Point", "Trend Micro", "Symantec", "FireEye", "Zscaler",
];

const KNOWN_THREAT_ACTORS = [
  "APT28", "APT29", "APT41", "Lazarus", "Cozy Bear", "Fancy Bear",
  "Sandworm", "Turla", "Kimsuky", "Volt Typhoon", "Salt Typhoon",
  "BlackCat", "LockBit", "ALPHV", "Cl0p", "REvil", "Conti",
  "DarkSide", "BlackBasta", "Scattered Spider", "LAPSUS",
  "Charming Kitten", "MuddyWater", "Midnight Blizzard",
];

export function extractEntities(title: string, summary?: string | null): ExtractedEntity[] {
  const text = `${title} ${summary || ""}`;
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  // CVEs
  const cves = text.match(CVE_PATTERN) || [];
  for (const cve of cves) {
    const upper = cve.toUpperCase();
    if (!seen.has(upper)) {
      seen.add(upper);
      entities.push({ type: "cve", name: upper, confidence: 1.0 });
    }
  }

  // Vendors / companies
  for (const vendor of KNOWN_VENDORS) {
    if (new RegExp(`\\b${vendor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
      const key = `company:${vendor}`;
      if (!seen.has(key)) {
        seen.add(key);
        entities.push({ type: "company", name: vendor, confidence: 0.9 });
      }
    }
  }

  // Threat actors
  for (const actor of KNOWN_THREAT_ACTORS) {
    if (new RegExp(`\\b${actor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
      const key = `threat_actor:${actor}`;
      if (!seen.has(key)) {
        seen.add(key);
        entities.push({ type: "threat_actor", name: actor, confidence: 0.85 });
      }
    }
  }

  return entities;
}

// ── Full processing pipeline for a feed item ──

export function processFeedItem(item: FeedItem): ScoredItem {
  const tags = inferTags(item.title);
  const { score, urgency } = scoreItem(item.title, item.summary);
  const itemType = classifyItemType(item.title, item.summary);
  const dedupeKey = makeDedupeKey(item.url);
  const entities = extractEntities(item.title, item.summary);

  return {
    ...item,
    score,
    urgency,
    itemType,
    tags,
    dedupeKey,
    entities,
  };
}

// ── Briefing generation (rule-based fallback) ──

export function generateRuleBasedBriefing(
  items: Array<{ title: string; score: number; urgency: string; url: string; tags_json?: string }>
): string {
  const top = items
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (top.length === 0) return "No significant items to report today.";

  const lines = ["# Daily Intelligence Brief\n"];
  lines.push(`*Generated ${new Date().toISOString().slice(0, 10)} — Rule-based summary*\n`);
  lines.push("## Top Developments\n");

  for (let i = 0; i < top.length; i++) {
    const item = top[i];
    const urgencyBadge = item.urgency === "critical" ? "🔴" : item.urgency === "high" ? "🟠" : item.urgency === "medium" ? "🟡" : "🟢";
    lines.push(`${i + 1}. ${urgencyBadge} **${item.title}** (score: ${item.score})`);
    lines.push(`   - [Read more](${item.url})`);
  }

  const critical = items.filter(i => i.urgency === "critical").length;
  const high = items.filter(i => i.urgency === "high").length;

  lines.push("\n## Action Summary\n");
  if (critical > 0) lines.push(`- 🔴 **${critical} critical** items require immediate attention`);
  if (high > 0) lines.push(`- 🟠 **${high} high** priority items to review today`);
  lines.push(`- Total items scored: ${items.length}`);

  return lines.join("\n");
}

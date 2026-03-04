// web/lib/jobSources.ts — Free job source definitions (NO paid APIs)

export interface JobSourceDef {
  name: string;
  type: "rss";
  url: string;
  category: string;
}

/**
 * Default free RSS-based job sources for cybersecurity / data-to-cyber transition.
 * All sources are public RSS feeds — no API keys required.
 */
export const DEFAULT_JOB_SOURCES: JobSourceDef[] = [
  // Indeed RSS — cybersecurity role variants
  { name: "Indeed: Cybersecurity Analyst", type: "rss", url: "https://www.indeed.com/rss?q=cybersecurity+analyst&sort=date", category: "indeed" },
  { name: "Indeed: SOC Analyst", type: "rss", url: "https://www.indeed.com/rss?q=soc+analyst&sort=date", category: "indeed" },
  { name: "Indeed: Security Analyst", type: "rss", url: "https://www.indeed.com/rss?q=security+analyst&sort=date", category: "indeed" },
  { name: "Indeed: Threat Analyst", type: "rss", url: "https://www.indeed.com/rss?q=threat+analyst&sort=date", category: "indeed" },
  { name: "Indeed: Information Security", type: "rss", url: "https://www.indeed.com/rss?q=information+security+analyst&sort=date", category: "indeed" },
  { name: "Indeed: Junior Cyber", type: "rss", url: "https://www.indeed.com/rss?q=junior+cybersecurity&sort=date", category: "indeed" },
];

/**
 * Normalize a URL for deduplication: strip tracking params, keep essential params.
 */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const trackingParams = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref", "source", "from", "fbclid", "gclid"];
    for (const p of trackingParams) {
      u.searchParams.delete(p);
    }
    return u.origin + u.pathname + (u.searchParams.toString() ? "?" + u.searchParams.toString() : "");
  } catch {
    return rawUrl.replace(/[?#].*$/, "").toLowerCase();
  }
}

/**
 * Normalize text for dedupe: lowercase, collapse whitespace, strip non-alphanumeric.
 */
function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Build a deterministic dedupe key from canonical URL + normalized title + normalized company.
 * Uses a simple stable hash suitable for D1 TEXT column.
 */
export function buildDedupeKey(rawUrl: string, title: string, company: string): string {
  const canonical = canonicalizeUrl(rawUrl);
  const normTitle = normalizeText(title);
  const normCompany = normalizeText(company);
  // djb2-style hash produces a stable, compact key
  const input = `${canonical}|${normTitle}|${normCompany}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return `${hash.toString(36)}_${normTitle.slice(0, 40).replace(/\s+/g, "_")}`;
}

/**
 * Fetch a URL with per-source timeout and a single retry with random jitter.
 * Returns Response on success or null on failure.
 */
export async function fetchWithRetry(
  url: string,
  timeoutMs: number = 8000,
): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": "MCC-Jobs/1.0" },
      });
      if (res.ok) return res;
      // Non-ok status on first attempt → retry after jitter
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 1500));
        continue;
      }
      return null;
    } catch {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 1500));
        continue;
      }
      return null;
    }
  }
  return null;
}

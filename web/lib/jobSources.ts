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
 * Normalize a URL for deduplication: strip query params and fragments, lowercase.
 */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    // Strip common tracking params
    const trackingParams = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref", "source", "from", "fbclid", "gclid"];
    for (const p of trackingParams) {
      u.searchParams.delete(p);
    }
    // Keep essential params (e.g., Indeed job key "jk")
    return u.origin + u.pathname + (u.searchParams.toString() ? "?" + u.searchParams.toString() : "");
  } catch {
    // Fallback: strip everything after ? or #
    return rawUrl.replace(/[?#].*$/, "").toLowerCase();
  }
}

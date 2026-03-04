// web/lib/jobScoring.ts — Rule-based match scoring engine (no LLM, no paid APIs)

export interface ScoredJob {
  match_score: number;
  why_match: string;
  tags_json: string;
}

// ─── Keyword sets ────────────────────────────────────

const ROLE_KEYWORDS: { pattern: RegExp; weight: number; label: string }[] = [
  { pattern: /\bsecurity analyst\b/i, weight: 20, label: "security analyst" },
  { pattern: /\bsoc analyst\b/i, weight: 20, label: "SOC analyst" },
  { pattern: /\bthreat hunt/i, weight: 18, label: "threat hunting" },
  { pattern: /\bincident response\b/i, weight: 16, label: "incident response" },
  { pattern: /\binformation security\b/i, weight: 15, label: "infosec" },
  { pattern: /\bcompliance analyst\b/i, weight: 12, label: "compliance" },
  { pattern: /\bcyber/i, weight: 14, label: "cybersecurity" },
  { pattern: /\bdata scientist?\b/i, weight: 10, label: "data science" },
  { pattern: /\bdata analyst\b/i, weight: 10, label: "data analyst" },
  { pattern: /\banalyst\b/i, weight: 8, label: "analyst" },
  { pattern: /\bdetection engineer/i, weight: 15, label: "detection engineering" },
  { pattern: /\bvulnerability/i, weight: 12, label: "vulnerability mgmt" },
  { pattern: /\bpenetration test/i, weight: 14, label: "pen testing" },
  { pattern: /\bgrc\b/i, weight: 10, label: "GRC" },
];

const SKILL_KEYWORDS: { pattern: RegExp; weight: number; label: string }[] = [
  { pattern: /\bpython\b/i, weight: 8, label: "Python" },
  { pattern: /\bsplunk\b/i, weight: 8, label: "Splunk" },
  { pattern: /\bsiem\b/i, weight: 8, label: "SIEM" },
  { pattern: /\blog analysis\b/i, weight: 6, label: "log analysis" },
  { pattern: /\bdetection\b/i, weight: 5, label: "detection" },
  { pattern: /\bincident triage\b/i, weight: 6, label: "incident triage" },
  { pattern: /\bdata\b/i, weight: 3, label: "data" },
  { pattern: /\bsentinel\b/i, weight: 7, label: "Sentinel" },
  { pattern: /\bqradar\b/i, weight: 7, label: "QRadar" },
  { pattern: /\belastic/i, weight: 6, label: "Elastic" },
  { pattern: /\bwireshark\b/i, weight: 5, label: "Wireshark" },
  { pattern: /\bscripting\b/i, weight: 4, label: "scripting" },
  { pattern: /\bautomation\b/i, weight: 4, label: "automation" },
  { pattern: /\bmachine learning\b/i, weight: 5, label: "ML" },
];

const EXPERIENCE_BOOST: { pattern: RegExp; delta: number }[] = [
  { pattern: /\bjunior\b/i, delta: 8 },
  { pattern: /\bassociate\b/i, delta: 6 },
  { pattern: /\bentry[- ]level\b/i, delta: 10 },
  { pattern: /\bintern\b/i, delta: 4 },
  { pattern: /\b[0-2]\+?\s*years?\b/i, delta: 6 },
];

const EXPERIENCE_PENALTY: { pattern: RegExp; delta: number }[] = [
  { pattern: /\bsenior\b/i, delta: -10 },
  { pattern: /\bprincipal\b/i, delta: -15 },
  { pattern: /\bstaff\b/i, delta: -8 },
  { pattern: /\bdirector\b/i, delta: -15 },
  { pattern: /\bvp\b/i, delta: -15 },
  { pattern: /\b(?:7|8|9|10)\+?\s*years?\b/i, delta: -10 },
];

const IRRELEVANT_PATTERNS: RegExp[] = [
  /\bsales\s+(?:rep|representative|manager|executive)\b/i,
  /\baccount\s+executive\b/i,
  /\bmarketing\s+manager\b/i,
  /\brecruiter\b/i,
  /\bhvac\b/i,
  /\bnursing\b/i,
  /\bphysical\s+security\b/i,
];

/**
 * Score a job based on rule-based matching against user profile.
 * Returns a score 0-100, a why_match sentence, and matched tags.
 */
export function scoreJob(title: string, company: string, location?: string | null, remoteFlag?: string | null): ScoredJob {
  const text = `${title} ${company} ${location || ""}`.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  const tags: string[] = [];

  // Check irrelevant roles first
  for (const pat of IRRELEVANT_PATTERNS) {
    if (pat.test(text)) {
      return { match_score: 5, why_match: "Low relevance — unrelated role domain", tags_json: "[]" };
    }
  }

  // Role match
  for (const kw of ROLE_KEYWORDS) {
    if (kw.pattern.test(text)) {
      score += kw.weight;
      reasons.push(kw.label);
      tags.push(kw.label);
    }
  }

  // Skill match
  for (const kw of SKILL_KEYWORDS) {
    if (kw.pattern.test(text)) {
      score += kw.weight;
      if (reasons.length < 4) reasons.push(kw.label);
      tags.push(kw.label);
    }
  }

  // Experience fit
  for (const exp of EXPERIENCE_BOOST) {
    if (exp.pattern.test(text)) {
      score += exp.delta;
      if (reasons.length < 4) reasons.push("entry-level fit");
      break;
    }
  }
  for (const exp of EXPERIENCE_PENALTY) {
    if (exp.pattern.test(text)) {
      score += exp.delta;
      break;
    }
  }

  // Remote/hybrid preference boost
  if (remoteFlag === "1" || /\bremote\b/i.test(text) || /\bhybrid\b/i.test(text)) {
    score += 5;
    tags.push("remote-friendly");
  }

  // Clamp to 0-100
  const finalScore = Math.max(0, Math.min(100, score));

  const whyMatch = reasons.length > 0
    ? `Matches: ${reasons.slice(0, 4).join(", ")}`
    : "No strong keyword matches found";

  return {
    match_score: finalScore,
    why_match: whyMatch,
    tags_json: JSON.stringify([...new Set(tags)]),
  };
}

/**
 * Detect remote flag from title/location text.
 */
export function detectRemoteFlag(title: string, location?: string | null): string {
  const text = `${title} ${location || ""}`.toLowerCase();
  if (/\bremote\b/.test(text)) return "1";
  if (/\bon[- ]?site\b/.test(text) || /\bin[- ]?office\b/.test(text)) return "0";
  return "unknown";
}

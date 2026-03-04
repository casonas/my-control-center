// web/lib/companiesSeed.ts — Seed data for companies-to-watch

export interface CompanySeed {
  company_name: string;
  tier: "big" | "emerging";
  source: string;
  notes: string;
}

export const SEED_COMPANIES: CompanySeed[] = [
  // Big targets — major cyber / cloud / security companies
  { company_name: "CrowdStrike", tier: "big", source: "seed", notes: "Leading endpoint security & threat intelligence" },
  { company_name: "Palo Alto Networks", tier: "big", source: "seed", notes: "Network security, cloud security, SOC platforms" },
  { company_name: "Microsoft Security", tier: "big", source: "seed", notes: "Sentinel, Defender, massive security org" },
  { company_name: "Google Cloud Security", tier: "big", source: "seed", notes: "Chronicle, Mandiant, VirusTotal" },
  { company_name: "Cisco", tier: "big", source: "seed", notes: "Talos threat intelligence, SecureX" },
  { company_name: "Fortinet", tier: "big", source: "seed", notes: "FortiGate, FortiSIEM, broad security portfolio" },
  { company_name: "Splunk", tier: "big", source: "seed", notes: "SIEM market leader, now part of Cisco" },
  { company_name: "IBM Security", tier: "big", source: "seed", notes: "QRadar SIEM, X-Force threat intel" },
  { company_name: "Amazon Web Services", tier: "big", source: "seed", notes: "GuardDuty, Security Hub, massive cloud security" },
  { company_name: "Mandiant", tier: "big", source: "seed", notes: "Incident response, threat intelligence (Google)" },

  // Emerging targets — high-growth security startups / cloud security
  { company_name: "Wiz", tier: "emerging", source: "seed", notes: "Cloud security posture management, fast-growing" },
  { company_name: "SentinelOne", tier: "emerging", source: "seed", notes: "AI-powered endpoint protection" },
  { company_name: "Snyk", tier: "emerging", source: "seed", notes: "Developer security, open source vulnerability scanning" },
  { company_name: "Lacework", tier: "emerging", source: "seed", notes: "Cloud security data-driven platform" },
  { company_name: "Arctic Wolf", tier: "emerging", source: "seed", notes: "Managed detection and response (MDR)" },
  { company_name: "Abnormal Security", tier: "emerging", source: "seed", notes: "AI-based email security" },
  { company_name: "Orca Security", tier: "emerging", source: "seed", notes: "Agentless cloud security" },
  { company_name: "Recorded Future", tier: "emerging", source: "seed", notes: "Threat intelligence platform" },
  { company_name: "Huntress", tier: "emerging", source: "seed", notes: "SMB-focused managed security" },
  { company_name: "Elastic Security", tier: "emerging", source: "seed", notes: "Open SIEM/XDR built on Elasticsearch" },
];

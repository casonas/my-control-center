// ─────────────────────────────────────────────────────
// Vector-Ready localStorage Store
// ─────────────────────────────────────────────────────
//
// Architecture:  Every item stored is a "Document" with a unified shape:
//   { id, collection, content, tags[], meta{}, searchText, updatedAt }
//
// searchText is auto-computed from title+content+tags so it can be:
//   • matched with TF-IDF / keyword search NOW (no server needed)
//   • replaced with cosine-similarity on embeddings LATER when the
//     OpenClaw agent pushes vectors via the API
//
// Batch helpers (putMany / queryMany) keep round-trips minimal and
// mirror the API a vector DB like Pinecone / Qdrant / Chroma exposes,
// so migrating is a one-liner swap of the adapter.
// ─────────────────────────────────────────────────────

import type {
  Note,
  Assignment,
  Skill,
  JobPosting,
  WatchItem,
  ResearchArticle,
  TabKey,
} from "./types";

// ─── Helpers ──────────────────────────────────────

function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function get<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function set(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

// ─── Unified Document type (vector-ready) ─────────
export interface Doc<T = Record<string, unknown>> {
  id: string;
  collection: string;       // "notes" | "assignments" | "skills" | …
  searchText: string;        // concatenated text for keyword / vector search
  tags: string[];
  meta: T;                   // the actual domain data
  createdAt: string;
  updatedAt: string;
}

function buildSearchText(parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

// ─── Cross-collection keyword search ──────────────
// Simple TF-IDF-style: split query into tokens, score each doc
// by how many tokens appear in its searchText. Swap this function
// for a vector cosine-similarity call when embeddings are available.

export function searchAll(query: string, limit = 20): Doc[] {
  if (!query.trim()) return [];
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const collections = ["mcc_notes", "mcc_assignments", "mcc_skills", "mcc_jobs", "mcc_watchlist", "mcc_research"];

  const scored: { doc: Doc; score: number }[] = [];
  for (const key of collections) {
    const items = get<Doc[]>(key + "_docs", []);
    for (const doc of items) {
      let score = 0;
      for (const t of tokens) {
        if (doc.searchText.includes(t)) score++;
      }
      if (score > 0) scored.push({ doc, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.doc);
}

// ─── Generic batch put (mirrors vector DB upsert) ──
function putDoc<T>(collectionKey: string, collection: string, id: string, meta: T, searchParts: string[], tags: string[]): Doc<T> {
  const docs = get<Doc<T>[]>(collectionKey, []);
  const now = new Date().toISOString();
  const searchText = buildSearchText(searchParts);
  const idx = docs.findIndex((d) => d.id === id);

  const doc: Doc<T> = {
    id,
    collection,
    searchText,
    tags,
    meta,
    createdAt: idx >= 0 ? docs[idx].createdAt : now,
    updatedAt: now,
  };

  if (idx >= 0) docs[idx] = doc;
  else docs.unshift(doc);

  set(collectionKey, docs);
  return doc;
}

// ─── Notes ────────────────────────────────────────
const NOTES_KEY = "mcc_notes";
const NOTES_DOCS = "mcc_notes_docs";

export function getNotes(tab?: TabKey): Note[] {
  const all = get<Note[]>(NOTES_KEY, []);
  return tab ? all.filter((n) => n.tab === tab) : all;
}

export function saveNote(note: Partial<Note> & { tab: TabKey; title: string }): Note {
  const all = get<Note[]>(NOTES_KEY, []);
  const now = new Date().toISOString();

  if (note.id) {
    const idx = all.findIndex((n) => n.id === note.id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...note, updatedAt: now };
      set(NOTES_KEY, all);
      // sync to doc index
      putDoc(NOTES_DOCS, "notes", all[idx].id, all[idx], [all[idx].title, all[idx].content, all[idx].tab], [all[idx].tab]);
      return all[idx];
    }
  }

  const created: Note = {
    id: uid(),
    tab: note.tab,
    title: note.title,
    content: note.content || "",
    createdAt: now,
    updatedAt: now,
  };
  all.unshift(created);
  set(NOTES_KEY, all);
  putDoc(NOTES_DOCS, "notes", created.id, created, [created.title, created.content, created.tab], [created.tab]);
  return created;
}

export function deleteNote(id: string) {
  set(NOTES_KEY, get<Note[]>(NOTES_KEY, []).filter((n) => n.id !== id));
  set(NOTES_DOCS, get<Doc[]>(NOTES_DOCS, []).filter((d) => d.id !== id));
}

// ─── Assignments ──────────────────────────────────
const ASSIGN_KEY = "mcc_assignments";
const ASSIGN_DOCS = "mcc_assignments_docs";

export function getAssignments(): Assignment[] {
  return get<Assignment[]>(ASSIGN_KEY, []);
}

export function saveAssignment(a: Partial<Assignment> & { title: string }): Assignment {
  const all = get<Assignment[]>(ASSIGN_KEY, []);

  if (a.id) {
    const idx = all.findIndex((x) => x.id === a.id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...a };
      set(ASSIGN_KEY, all);
      putDoc(ASSIGN_DOCS, "assignments", all[idx].id, all[idx], [all[idx].title, all[idx].course, all[idx].priority], [all[idx].course, all[idx].priority]);
      return all[idx];
    }
  }

  const created: Assignment = {
    id: uid(),
    title: a.title,
    course: a.course || "",
    dueDate: a.dueDate || "",
    completed: a.completed || false,
    priority: a.priority || "medium",
  };
  all.unshift(created);
  set(ASSIGN_KEY, all);
  putDoc(ASSIGN_DOCS, "assignments", created.id, created, [created.title, created.course, created.priority], [created.course, created.priority]);
  return created;
}

export function deleteAssignment(id: string) {
  set(ASSIGN_KEY, get<Assignment[]>(ASSIGN_KEY, []).filter((x) => x.id !== id));
  set(ASSIGN_DOCS, get<Doc[]>(ASSIGN_DOCS, []).filter((d) => d.id !== id));
}

export function toggleAssignment(id: string) {
  const all = get<Assignment[]>(ASSIGN_KEY, []);
  const idx = all.findIndex((x) => x.id === id);
  if (idx >= 0) all[idx].completed = !all[idx].completed;
  set(ASSIGN_KEY, all);
}

// ─── Skills ───────────────────────────────────────
const SKILLS_KEY = "mcc_skills";
const SKILLS_DOCS = "mcc_skills_docs";

const DEFAULT_SKILLS: Skill[] = [
  {
    id: "s1",
    name: "CompTIA Security+",
    category: "Certification",
    progress: 0,
    lessons: [
      { id: "l1", title: "Threats & Vulnerabilities", completed: false, description: "Identify types of malware, social engineering, and application attacks" },
      { id: "l2", title: "Identity & Access Management", completed: false, description: "Authentication, authorization, and access control models" },
      { id: "l3", title: "Network Security", completed: false, description: "Firewalls, VPNs, intrusion detection, and network protocols" },
      { id: "l4", title: "Cryptography & PKI", completed: false, description: "Encryption algorithms, hashing, digital signatures, and certificates" },
      { id: "l5", title: "Risk Management", completed: false, description: "Risk assessment, disaster recovery, and incident response" },
    ],
  },
  {
    id: "s2",
    name: "Splunk SIEM",
    category: "Tool",
    progress: 0,
    lessons: [
      { id: "l6", title: "Splunk Basics & SPL", completed: false, description: "Search Processing Language fundamentals and data ingestion" },
      { id: "l7", title: "Dashboards & Alerts", completed: false, description: "Build monitoring dashboards and configure alert triggers" },
      { id: "l8", title: "Threat Hunting with Splunk", completed: false, description: "Use Splunk for proactive threat detection and investigation" },
    ],
  },
  {
    id: "s3",
    name: "Network Penetration Testing",
    category: "Skill",
    progress: 0,
    lessons: [
      { id: "l9", title: "Reconnaissance & Scanning", completed: false, description: "Nmap, Netcat, and information gathering techniques" },
      { id: "l10", title: "Exploitation Fundamentals", completed: false, description: "Metasploit, buffer overflows, and common exploit techniques" },
      { id: "l11", title: "Post-Exploitation", completed: false, description: "Privilege escalation, lateral movement, and persistence" },
      { id: "l12", title: "Reporting & Remediation", completed: false, description: "Professional pentest reporting and remediation recommendations" },
    ],
  },
  {
    id: "s4",
    name: "Python for Security",
    category: "Programming",
    progress: 0,
    lessons: [
      { id: "l13", title: "Python Scripting Basics", completed: false, description: "Variables, functions, file I/O, and automation scripts" },
      { id: "l14", title: "Network Scripting", completed: false, description: "Socket programming, packet crafting with Scapy" },
      { id: "l15", title: "Web App Security Scripts", completed: false, description: "Build scanners, fuzzers, and automated testing tools" },
    ],
  },
  {
    id: "s5",
    name: "Cloud Security (AWS)",
    category: "Cloud",
    progress: 0,
    lessons: [
      { id: "l16", title: "AWS Security Fundamentals", completed: false, description: "IAM, VPC security groups, and shared responsibility model" },
      { id: "l17", title: "Cloud Monitoring & Logging", completed: false, description: "CloudTrail, CloudWatch, and GuardDuty for security monitoring" },
      { id: "l18", title: "Serverless Security", completed: false, description: "Lambda security, API Gateway, and container security" },
    ],
  },
];

export function getSkills(): Skill[] {
  const stored = get<Skill[]>(SKILLS_KEY, []);
  if (stored.length === 0) {
    set(SKILLS_KEY, DEFAULT_SKILLS);
    // seed doc index
    for (const s of DEFAULT_SKILLS) {
      const lessonText = s.lessons.map((l) => l.title + " " + l.description).join(" ");
      putDoc(SKILLS_DOCS, "skills", s.id, s, [s.name, s.category, lessonText], [s.category]);
    }
    return DEFAULT_SKILLS;
  }
  return stored;
}

export function toggleLesson(skillId: string, lessonId: string) {
  const all = getSkills();
  const skill = all.find((s) => s.id === skillId);
  if (!skill) return;
  const lesson = skill.lessons.find((l) => l.id === lessonId);
  if (!lesson) return;
  lesson.completed = !lesson.completed;
  skill.progress = Math.round(
    (skill.lessons.filter((l) => l.completed).length / skill.lessons.length) * 100
  );
  set(SKILLS_KEY, all);
  const lessonText = skill.lessons.map((l) => l.title + " " + l.description).join(" ");
  putDoc(SKILLS_DOCS, "skills", skill.id, skill, [skill.name, skill.category, lessonText], [skill.category]);
}

export function addSkill(name: string, category: string): Skill {
  const all = getSkills();
  const skill: Skill = { id: uid(), name, category, progress: 0, lessons: [] };
  all.push(skill);
  set(SKILLS_KEY, all);
  putDoc(SKILLS_DOCS, "skills", skill.id, skill, [name, category], [category]);
  return skill;
}

// ─── Job Postings ─────────────────────────────────
const JOBS_KEY = "mcc_jobs";
const JOBS_DOCS = "mcc_jobs_docs";

const DEFAULT_JOBS: JobPosting[] = [
  { id: "j1", title: "SOC Analyst I", company: "CrowdStrike", location: "Remote", url: "#", savedAt: new Date().toISOString(), applied: false, tags: ["Entry Level", "SIEM", "Incident Response"] },
  { id: "j2", title: "Junior Penetration Tester", company: "Rapid7", location: "Boston, MA", url: "#", savedAt: new Date().toISOString(), applied: false, tags: ["Pentest", "Security+", "Python"] },
  { id: "j3", title: "Cybersecurity Intern", company: "Palo Alto Networks", location: "Santa Clara, CA", url: "#", savedAt: new Date().toISOString(), applied: false, tags: ["Internship", "Networking", "Cloud"] },
  { id: "j4", title: "Security Engineer", company: "Cloudflare", location: "Remote", url: "#", savedAt: new Date().toISOString(), applied: false, tags: ["Cloud", "DDoS", "Go/Python"] },
  { id: "j5", title: "Threat Intelligence Analyst", company: "Mandiant", location: "Reston, VA", url: "#", savedAt: new Date().toISOString(), applied: false, tags: ["Threat Intel", "OSINT", "Reporting"] },
];

export function getJobs(): JobPosting[] {
  const stored = get<JobPosting[]>(JOBS_KEY, []);
  if (stored.length === 0) {
    set(JOBS_KEY, DEFAULT_JOBS);
    for (const j of DEFAULT_JOBS) {
      putDoc(JOBS_DOCS, "jobs", j.id, j, [j.title, j.company, j.location, ...j.tags], j.tags);
    }
    return DEFAULT_JOBS;
  }
  return stored;
}

export function saveJob(job: Partial<JobPosting> & { title: string }): JobPosting {
  const all = getJobs();

  if (job.id) {
    const idx = all.findIndex((j) => j.id === job.id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...job };
      set(JOBS_KEY, all);
      putDoc(JOBS_DOCS, "jobs", all[idx].id, all[idx], [all[idx].title, all[idx].company, all[idx].location, ...all[idx].tags], all[idx].tags);
      return all[idx];
    }
  }

  const created: JobPosting = {
    id: uid(),
    title: job.title,
    company: job.company || "",
    location: job.location || "",
    url: job.url || "#",
    savedAt: new Date().toISOString(),
    applied: job.applied || false,
    tags: job.tags || [],
  };
  all.unshift(created);
  set(JOBS_KEY, all);
  putDoc(JOBS_DOCS, "jobs", created.id, created, [created.title, created.company, created.location, ...created.tags], created.tags);
  return created;
}

export function toggleJobApplied(id: string) {
  const all = getJobs();
  const idx = all.findIndex((j) => j.id === id);
  if (idx >= 0) all[idx].applied = !all[idx].applied;
  set(JOBS_KEY, all);
}

export function deleteJob(id: string) {
  set(JOBS_KEY, get<JobPosting[]>(JOBS_KEY, []).filter((j) => j.id !== id));
  set(JOBS_DOCS, get<Doc[]>(JOBS_DOCS, []).filter((d) => d.id !== id));
}

// ─── Watchlist ────────────────────────────────────
const WATCH_KEY = "mcc_watchlist";

const DEFAULT_WATCH: WatchItem[] = [
  { id: "w1", symbol: "AAPL", name: "Apple Inc.", type: "stock" },
  { id: "w2", symbol: "MSFT", name: "Microsoft Corp.", type: "stock" },
  { id: "w3", symbol: "CRWD", name: "CrowdStrike Holdings", type: "stock" },
  { id: "w4", symbol: "PANW", name: "Palo Alto Networks", type: "stock" },
  { id: "w5", symbol: "NET", name: "Cloudflare Inc.", type: "stock" },
];

export function getWatchlist(type?: "stock" | "team"): WatchItem[] {
  const stored = get<WatchItem[]>(WATCH_KEY, []);
  if (stored.length === 0) {
    set(WATCH_KEY, DEFAULT_WATCH);
    return type ? DEFAULT_WATCH.filter((w) => w.type === type) : DEFAULT_WATCH;
  }
  return type ? stored.filter((w) => w.type === type) : stored;
}

export function addWatchItem(item: Omit<WatchItem, "id">): WatchItem {
  const all = getWatchlist();
  const created: WatchItem = { id: uid(), ...item };
  all.push(created);
  set(WATCH_KEY, all);
  return created;
}

export function removeWatchItem(id: string) {
  const all = getWatchlist();
  set(WATCH_KEY, all.filter((w) => w.id !== id));
}

// ─── Research Articles ────────────────────────────
const RESEARCH_KEY = "mcc_research";
const RESEARCH_DOCS = "mcc_research_docs";

const DEFAULT_RESEARCH: ResearchArticle[] = [
  { id: "r1", title: "Zero-Day Exploits: The Silent Threat Landscape of 2026", source: "Krebs on Security", url: "#", category: "cyber", savedAt: new Date().toISOString(), read: false, notes: "" },
  { id: "r2", title: "AI-Powered SOC: How Machine Learning is Changing Threat Detection", source: "Dark Reading", url: "#", category: "tech", savedAt: new Date().toISOString(), read: false, notes: "" },
  { id: "r3", title: "Global Cybersecurity Workforce Gap Reaches 4 Million", source: "Reuters", url: "#", category: "world", savedAt: new Date().toISOString(), read: false, notes: "" },
  { id: "r4", title: "Deep Dive: Building a Home Lab for Penetration Testing", source: "HackTheBox Blog", url: "#", category: "deep", savedAt: new Date().toISOString(), read: false, notes: "" },
  { id: "r5", title: "Quantum Computing and the Future of Encryption", source: "MIT Technology Review", url: "#", category: "tech", savedAt: new Date().toISOString(), read: false, notes: "" },
  { id: "r6", title: "CISA Releases New Cloud Security Guidelines", source: "The Hacker News", url: "#", category: "cyber", savedAt: new Date().toISOString(), read: false, notes: "" },
];

export function getResearch(category?: ResearchArticle["category"]): ResearchArticle[] {
  const stored = get<ResearchArticle[]>(RESEARCH_KEY, []);
  if (stored.length === 0) {
    set(RESEARCH_KEY, DEFAULT_RESEARCH);
    for (const r of DEFAULT_RESEARCH) {
      putDoc(RESEARCH_DOCS, "research", r.id, r, [r.title, r.source, r.category, r.notes], [r.category, r.source]);
    }
    return category ? DEFAULT_RESEARCH.filter((r) => r.category === category) : DEFAULT_RESEARCH;
  }
  return category ? stored.filter((r) => r.category === category) : stored;
}

export function toggleArticleRead(id: string) {
  const all = getResearch();
  const idx = all.findIndex((r) => r.id === id);
  if (idx >= 0) all[idx].read = !all[idx].read;
  set(RESEARCH_KEY, all);
}

export function saveArticleNotes(id: string, notes: string) {
  const all = getResearch();
  const idx = all.findIndex((r) => r.id === id);
  if (idx >= 0) {
    all[idx].notes = notes;
    set(RESEARCH_KEY, all);
    putDoc(RESEARCH_DOCS, "research", all[idx].id, all[idx], [all[idx].title, all[idx].source, all[idx].category, notes], [all[idx].category, all[idx].source]);
  }
}

# My Control Center — BLUEPRINT

> **Product + Systems Architecture + Applied AI** specification for a personal life dashboard.

---

## 1) NORTH STAR

**The Magic Experience:** You wake up, glance at your phone, and MCC greets you with exactly three things: the assignment due today, the skill lesson you should continue (spaced-repetition timed), and one job posting that matches your profile. No noise. By noon the school tab has auto-surfaced Blackboard deadlines parsed from your calendar export. After class you open Skills and pick up where you left off — the agent already queued the next Security+ topic. Evening: Research tab shows 4 unread cyber articles ranked by relevance to your coursework. Sports scores stream in the sidebar. Before bed, you mark two next-actions as done; the engine learns your pattern and tomorrow's suggestions are sharper. You never opened a second app.

### 5 Principles

1. **Attention is scarce** — surface only what matters *right now*; hide the rest behind one tap.
2. **Proactive but not annoying** — suggest, don't nag. Confidence scores gate every notification.
3. **Zero extra cost** — every feature must run on Cloudflare free tier + open-source.
4. **Security by default** — httpOnly cookies, CSRF tokens, no secrets in the client, encrypted at rest.
5. **Offline-first, sync-later** — localStorage works immediately; D1 syncs when online.

---

## 2) WHAT'S MISSING / WHERE THE PLAN FALLS SHORT

| Area | Weak Point | Impact |
|------|-----------|--------|
| **Auth** | Original routes were stubs (`{ ok: true }`). Fixed in this PR with real sessions + CSRF. | Critical — anyone could access the dashboard. |
| **Data persistence** | All data lives in localStorage only. D1 schema exists but isn't wired. | Phone ≠ laptop data; one `localStorage.clear()` = total loss. |
| **Agent connection** | Chat stream returns hardcoded demo text. No tunnel to OpenClaw VPS yet. | The "AI" in the dashboard is non-functional. |
| **No offline manifest** | PWA manifest added but no service worker for offline caching. | App won't work without network. |
| **No rate limiting** | API routes have no throttle. A bot could hammer `/api/chat/stream`. | DoS risk on free-tier Workers quota. |
| **No input sanitization** | Chat input and note content are rendered as-is. | XSS risk if agent returns HTML. |
| **No error boundaries** | A single component crash takes down the whole page. | Bad UX on mobile especially. |
| **No tests** | Zero test files. No CI validation beyond lint+build. | Regressions ship silently. |
| **Monolith component** | `WidgetPanel.tsx` is 1000+ lines; `page.tsx` is 500+. | Hard to maintain and review. |
| **No type-safe API layer** | `apiPost`/`apiGet` rely on generic type params that callers can forget. | Runtime errors from shape mismatches. |

---

## 3) 20 INNOVATIVE CAPABILITIES

### 1. Attention Router ⚡
- **Why novel:** Most dashboards show everything; this *hides* what's irrelevant based on time-of-day and context. Uncommon because it requires a behavioral model.
- **Mechanism:** `next_actions` API scores items by deadline proximity × time-of-day × past engagement. Only top-5 surface on Home.
- **Data:** `user_events` table (clicks, completes, dismisses).
- **Stack:** Rule engine in `/api/next-actions/route.ts` (already built). Add user_events writes from client.
- **Effort:** S | **Risk:** Low | **Wow:** 8

### 2. Knowledge Graph from Notes + Tasks
- **Why novel:** Notion links pages manually. MCC auto-extracts entities (courses, companies, skills) and links them. Uncommon because it needs NLP.
- **Mechanism:** On note save, Workers AI extracts named entities → store as edges in a `graph_edges` table.
- **Data:** Notes, assignments, research articles — all already in D1.
- **Stack:** Cloudflare Workers AI (`@cf/meta/llama-3-8b-instruct`) for entity extraction. Free tier.
- **Effort:** M | **Risk:** Med | **Wow:** 9

### 3. Spaced Repetition Skill Engine
- **Why novel:** Most skill trackers are checklists. This uses SM-2 algorithm to schedule lesson reviews. Uncommon outside Anki.
- **Mechanism:** Each `lesson` row gets `next_review_at` and `ease_factor` columns. Engine promotes lessons due today.
- **Data:** `lessons` table + new columns.
- **Stack:** SM-2 algorithm in a utility function. ~50 lines of code.
- **Effort:** S | **Risk:** Low | **Wow:** 7

### 4. Agent Workstation Handoff
- **Why novel:** Each tab has its own agent, but they can *hand off* context. "Job Scout" can say "Skill Coach should prep you for this role's requirements." Uncommon because multi-agent routing is hard.
- **Mechanism:** Agent response includes `handoff: { targetAgent, context }` JSON. UI shows a "Continue with Skill Coach →" button.
- **Data:** `agent_runs.artifacts` stores the handoff payload.
- **Stack:** Prompt engineering on OpenClaw side + UI component.
- **Effort:** M | **Risk:** Med | **Wow:** 9

### 5. Email Digest Parser
- **Why novel:** Dashboards don't read your email. MCC parses forwarded digests (Blackboard notifications, job alerts) into structured data.
- **Mechanism:** User forwards emails to a Cloudflare Email Worker → regex + LLM extraction → inserts into assignments/jobs tables.
- **Data:** Forwarded emails (user-initiated, no scraping).
- **Stack:** Cloudflare Email Routing (free) + Workers AI.
- **Effort:** M | **Risk:** Low | **Wow:** 8

### 6. Calendar ICS Auto-Import
- **Why novel:** Export `.ics` from Blackboard/Google → MCC cron worker parses it into assignments with real due dates.
- **Mechanism:** User pastes ICS URL into Settings → cron fetches every 4h → upserts assignments.
- **Data:** Public ICS feed URL.
- **Stack:** `ical.js` npm package for parsing.
- **Effort:** S | **Risk:** Low | **Wow:** 6

### 7. Decision Journal
- **Why novel:** When you make a choice (apply to job, skip an article), MCC logs it with your reasoning. Later you can review decisions and outcomes. Uncommon — no dashboard tracks *why* you did something.
- **Mechanism:** Optional "Why?" prompt on key actions → stored in `feedback.metadata`.
- **Data:** `feedback` table.
- **Stack:** Modal component + DB write.
- **Effort:** S | **Risk:** Low | **Wow:** 7

### 8. Momentum Score
- **Why novel:** A single number (0-100) representing your productivity trend across all tabs. Uncommon because it requires cross-domain aggregation.
- **Mechanism:** `momentum = 0.4 * tasks_completed_ratio + 0.3 * skill_progress_delta + 0.2 * articles_read + 0.1 * job_apps`.
- **Data:** All existing tables.
- **Stack:** Computed in `/api/next-actions` response.
- **Effort:** S | **Risk:** Low | **Wow:** 7

### 9. RSS Intelligence Feed
- **Why novel:** Instead of showing raw RSS, MCC deduplicates, scores relevance to your interests, and groups by topic.
- **Mechanism:** Cron worker fetches RSS → Workers AI generates embeddings → cosine similarity with user's notes/skills → ranked feed.
- **Data:** RSS feeds (Krebs, HackerNews, Dark Reading).
- **Stack:** Cloudflare Workers + Workers AI `bge-small-en-v1.5`.
- **Effort:** M | **Risk:** Low | **Wow:** 7

### 10. Focus Mode with Context Switching Cost
- **Why novel:** Pomodoro timers exist everywhere. This one *blocks tab switching* during focus and tracks how often you context-switch. Uncommon because dashboards don't measure attention debt.
- **Mechanism:** When Pomodoro is running, other tabs show a "Focus in progress" overlay. Switches are logged as events.
- **Data:** `user_events` with `event_type = 'context_switch'`.
- **Stack:** State flag in page.tsx + overlay component.
- **Effort:** S | **Risk:** Low | **Wow:** 6

### 11. Weekly Retro Generator
- **Why novel:** Every Sunday, the engine auto-generates a "week in review" from your events: tasks done, skills advanced, articles read, jobs applied. Uncommon — requires aggregation + narrative generation.
- **Mechanism:** Cron trigger → aggregate `user_events` for past 7 days → LLM summarizes → stores as a note.
- **Data:** `user_events`, `next_actions` (accepted/completed).
- **Stack:** Scheduled Worker + Workers AI.
- **Effort:** M | **Risk:** Low | **Wow:** 8

### 12. Skill-to-Job Matcher
- **Why novel:** Cross-references your skill progress against job posting requirements. Shows "You're 72% qualified for this role." Uncommon because it requires structured skill mapping.
- **Mechanism:** Job tags ∩ completed lesson topics → qualification percentage.
- **Data:** `jobs.tags`, `skills`, `lessons`.
- **Stack:** Set intersection logic. ~30 lines.
- **Effort:** S | **Risk:** Low | **Wow:** 8

### 13. Notification Priority Queue
- **Why novel:** Instead of showing all notifications equally, MCC uses urgency × relevance scoring. Urgent deadline > new article.
- **Mechanism:** `notifications.priority` field + sort by composite score.
- **Data:** `notifications` table (already in schema).
- **Stack:** Sorting logic in API route.
- **Effort:** S | **Risk:** Low | **Wow:** 5

### 14. Voice-to-Note (Browser API)
- **Why novel:** Tap mic → browser SpeechRecognition API → saved as note. No external service needed.
- **Mechanism:** `webkitSpeechRecognition` / `SpeechRecognition` API.
- **Data:** Browser-only, no data leaves device.
- **Stack:** ~40 lines of JS. Free.
- **Effort:** S | **Risk:** Low | **Wow:** 6

### 15. Threat Intelligence Dashboard
- **Why novel:** A cybersecurity student's dashboard that surfaces CVEs and threat intel relevant to their coursework. Uncommon in personal dashboards.
- **Mechanism:** Fetch from NVD API (free, no key) + CISA KEV feed → filter by keywords matching skills.
- **Data:** NVD API, CISA Known Exploited Vulnerabilities catalog.
- **Stack:** Cron worker + D1 cache.
- **Effort:** M | **Risk:** Low | **Wow:** 7

### 16. Study Session Replays
- **Why novel:** After a skill lesson, MCC shows your chat history + notes from that session as a "replay." Uncommon because it requires session-level grouping.
- **Mechanism:** `agent_runs` linked to `lessons` via `source_id`. UI shows timeline view.
- **Data:** `agent_runs`, `lessons`.
- **Stack:** Query + timeline component.
- **Effort:** M | **Risk:** Low | **Wow:** 6

### 17. Adaptive Home Screen
- **Why novel:** Home widgets reorder themselves based on what you interact with most. Monday morning = school-heavy. Weekend evening = sports-heavy. Uncommon — requires tracking + dynamic layout.
- **Mechanism:** Count events per tab for current time window → sort widgets by engagement.
- **Data:** `user_events`.
- **Stack:** Sorting logic in HomeWidgets component.
- **Effort:** S | **Risk:** Low | **Wow:** 7

### 18. Cross-Tab Search with Semantic Ranking
- **Why novel:** Search "network security" returns matching notes, lessons, jobs, AND articles — ranked by semantic similarity, not just keyword match.
- **Mechanism:** FTS5 for keyword match NOW. Workers AI embeddings for semantic search LATER.
- **Data:** `documents_fts` virtual table (already in schema).
- **Stack:** Already built in `lib/store.ts` (TF-IDF). Upgrade path to vector search via Workers AI.
- **Effort:** S (keyword) / M (semantic) | **Risk:** Low | **Wow:** 7

### 19. Goal Decomposition Agent
- **Why novel:** Tell the agent "I want to pass Security+" and it creates a full learning plan with milestones, deadlines, and lesson sequence. Uncommon because it requires domain-aware planning.
- **Mechanism:** Prompt template + skill/lesson schema → agent generates structured JSON → auto-inserts skills + lessons.
- **Data:** User prompt + existing skill templates.
- **Stack:** OpenClaw agent + structured output parsing.
- **Effort:** M | **Risk:** Med | **Wow:** 9

### 20. Privacy-First Analytics
- **Why novel:** All analytics stay on YOUR infrastructure. No third-party trackers. You own your behavioral data and can export/delete it anytime. Uncommon because most dashboards rely on external analytics.
- **Mechanism:** `user_events` table IS the analytics store. A Settings page shows your own engagement metrics.
- **Data:** Self-hosted in D1.
- **Stack:** Query aggregation + chart component.
- **Effort:** S | **Risk:** Low | **Wow:** 6

---

## 4) ARCHITECTURE THAT SCALES WITHOUT COST EXPLOSION

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Browser    │────▶│ Cloudflare Pages │────▶│  D1 / KV    │
│  (Next.js)   │     │  (SSR + API)     │     │  (Storage)  │
└─────────────┘     └──────────────────┘     └─────────────┘
                           │                        │
                    ┌──────┴──────┐          ┌──────┴──────┐
                    │   Workers   │          │  Workers AI │
                    │  (Cron Jobs)│          │ (Embeddings)│
                    └──────┬──────┘          └─────────────┘
                           │
                    ┌──────┴──────┐
                    │  CF Tunnel  │──▶ OpenClaw VPS (FastAPI + Agents)
                    └─────────────┘
```

### Core Modules

| Module | Responsibility | Runtime |
|--------|---------------|---------|
| **Web App** | UI, client-side store, SSE chat | Cloudflare Pages |
| **API Routes** | Auth, CRUD, next-actions engine | Next.js API routes (Edge) |
| **Cron Workers** | RSS fetch, job scraping, score updates | Cloudflare Workers (scheduled) |
| **Ingestion** | Email parsing, ICS import, webhook receiver | Cloudflare Email Workers |
| **Agent Proxy** | Tunnel requests to OpenClaw VPS | Cloudflare Tunnel |

### Storage

- **D1** (SQLite): Primary data store. 5M reads/day, 100k writes/day, 5GB. Plenty for single user.
- **KV**: API response cache. TTL-based expiry. 100k reads/day.
- **R2**: File storage (note exports, uploaded attachments). 10GB free.
- **localStorage**: Offline-first client cache. Syncs to D1 when online.

### Event Model

Everything is an event via the `user_events` table:
```
event_type: click | complete | dismiss | search | view | chat | context_switch
target_type: assignment | note | job | skill | research | notification
```
This powers the Think Like Me engine, momentum score, adaptive home, and weekly retros.

### Auth

- Cookie-based sessions via `lib/auth.ts`
- `mcc_session` cookie: httpOnly, secure, sameSite=lax, 180-day maxAge
- `mcc_csrf` cookie: JS-readable for header inclusion on mutations
- Password from `MCC_PASSWORD` env var (never in client code)
- Constant-time comparison via SHA-256 + `timingSafeEqual`

### Rate Limiting

- Cloudflare's built-in DDoS protection (free)
- Add `X-RateLimit` headers in API routes (in-memory counter, 100 req/min)
- Workers cron jobs stay well within 100k requests/day

### Observability

- `console.log` in Workers (viewable in Cloudflare dashboard)
- `agent_runs.duration_ms` and `tokens_used` for cost tracking
- D1 query count visible in Cloudflare analytics (free)

---

## 5) DATA MODEL

Full schema: [`web/cloudflare/d1-schema.sql`](web/cloudflare/d1-schema.sql)

### Tables Summary

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | Auth (single user for now) | `id, username, pw_hash` |
| `sessions` | Cookie sessions | `id, user_id, csrf_token, expires_at` |
| `documents` | Unified vector-ready store | `id, collection, search_text, tags, meta` |
| `documents_fts` | FTS5 full-text search | Virtual table over `documents` |
| `notes` | Notes per tab | `id, tab, title, content` |
| `assignments` | School tasks | `id, title, course, due_date, priority, completed` |
| `skills` | Skill categories | `id, name, category, progress` |
| `lessons` | Lessons per skill | `id, skill_id, title, completed` |
| `jobs` | Job postings | `id, title, company, location, applied` |
| `watchlist` | Stocks + teams | `id, symbol, name, type` |
| `research` | Saved articles | `id, title, source, category, read` |
| `api_cache` | Cron worker cache | `key, value, expires_at` |
| `user_events` | Behavioral tracking | `id, event_type, target_id, target_type` |
| `next_actions` | AI suggestions | `id, title, reasoning, confidence, priority, status` |
| `agent_runs` | Agent invocations | `id, agent_id, prompt, response, tokens_used` |
| `notifications` | Notification queue | `id, title, channel, priority, read` |
| `connectors` | External data sources | `id, type, name, config, enabled` |
| `feedback` | User feedback loop | `id, target_type, target_id, action` |

### Example Records

**assignments:**
```json
{ "id": "a1", "title": "Network Security Lab 3", "course": "CIS 340", "due_date": "2026-03-05", "priority": "high", "completed": 0 }
```

**next_actions:**
```json
{ "id": "na-1", "title": "Review upcoming assignments", "reasoning": "Weekday morning — prime time for academic work.", "source_type": "pattern", "confidence": 0.85, "priority": 1, "status": "pending" }
```

**user_events:**
```json
{ "id": "ev-1", "event_type": "complete", "target_id": "a1", "target_type": "assignment", "metadata": "{\"duration_sec\": 1800}" }
```

**agent_runs:**
```json
{ "id": "run-1", "agent_id": "school-agent", "prompt": "Help me study for Security+", "response": "Here's a study plan...", "tokens_used": 450, "duration_ms": 2100, "status": "completed" }
```

---

## 6) "THINK LIKE ME" ENGINE

### Overview

The engine lives in `/api/next-actions/route.ts` and produces daily **Top 5 Next Actions** with reasoning and confidence scores.

### Algorithm (Pseudo-code)

```
function computeNextActions(userId):
  candidates = []

  # Rule 1: Deadline urgency
  for assignment in getUpcomingAssignments(userId, days=7):
    score = 1.0 - (daysUntilDue / 7)  # closer = higher
    candidates.push({
      title: "Complete: " + assignment.title,
      sourceType: "deadline",
      confidence: score,
      priority: 1 if daysUntilDue <= 1 else 2
    })

  # Rule 2: Spaced repetition (skill lessons due for review)
  for lesson in getLessonsDueForReview(userId):
    candidates.push({
      title: "Review: " + lesson.title,
      sourceType: "skill_gap",
      confidence: 0.75,
      priority: 2
    })

  # Rule 3: Unread high-relevance articles
  for article in getUnreadArticles(userId, limit=3):
    candidates.push({
      title: "Read: " + article.title,
      sourceType: "unread",
      confidence: 0.6,
      priority: 3
    })

  # Rule 4: Job application momentum
  recentApps = countRecentApplications(userId, days=7)
  if recentApps < 3:
    candidates.push({
      title: "Apply to saved job postings",
      sourceType: "job_apply",
      confidence: 0.65,
      priority: 4
    })

  # Rule 5: Time-of-day patterns
  hour = currentHour()
  patterns = getUserTimePatterns(userId)  # from user_events
  if hour in patterns.peakSchoolHours:
    boost candidates where sourceType == "deadline" by +0.1

  # Feedback adjustment
  for candidate in candidates:
    dismissRate = getDismissRate(userId, candidate.sourceType)
    candidate.confidence *= (1 - dismissRate * 0.5)

  # Sort and return top 5
  candidates.sort(by: confidence * (6 - priority), descending)
  return candidates[:5]
```

### Inputs
- `assignments` (due dates, completion status)
- `lessons` (completion, last review date)
- `research` (read status)
- `jobs` (applied status)
- `user_events` (behavioral signals)
- `feedback` (accept/dismiss history)

### Outputs
```json
{
  "actions": [
    {
      "id": "na-1",
      "title": "Complete: Network Security Lab 3",
      "reasoning": "Due in 2 days. High priority assignment.",
      "sourceType": "deadline",
      "confidence": 0.92,
      "priority": 1,
      "tab": "school"
    }
  ],
  "generatedAt": "2026-03-01T08:00:00Z",
  "engine": "rules-v1"
}
```

### Feedback Loop

1. User sees suggestion → clicks "Do it" → `feedback.action = 'complete'`
2. User dismisses → `feedback.action = 'dismiss'`
3. Engine reads feedback table → adjusts confidence multipliers per sourceType
4. After 30+ feedback events, patterns emerge (e.g., user always dismisses job suggestions in the morning)

### Trust UI

Each suggestion card shows:
- **Title** (what to do)
- **Reasoning** (why the engine suggested it)
- **Confidence badge** (85% confident)
- **Source** (deadline / pattern / skill gap)
- **Accept / Dismiss / Snooze** buttons

---

## 7) UX / UI LAYOUT (MOBILE-FIRST)

### Tab Structure

`Home | School | Jobs | Skills | Sports | Stocks | Research | Notes | Settings`

Mobile: horizontal scroll tabs. Desktop: fixed nav bar.

### Home Page Widget Priority

1. **Next Actions** (from Think Like Me engine) — always first
2. **Stats Row** (assignments due, skill %, jobs saved, unread articles)
3. **Focus Timer** (Pomodoro)
4. **Quick Task Add**
5. **Quick Actions Grid**

### Agent Workstation Pattern

Each tab follows the same layout:

```
┌─────────────────────────────────────────────────┐
│  HEADER: Logo | Tabs | Search | Notes | Logout  │
├──────────┬──────────────────────┬───────────────┤
│          │                      │               │
│ SIDEBAR  │   AGENT WORKSTATION  │  WIDGET PANEL │
│          │                      │               │
│ • Agents │   Chat interface     │  Tab-specific │
│ • Quick  │   with SSE streaming │  cards and    │
│   links  │   + suggestions      │  data views   │
│          │                      │               │
├──────────┴──────────────────────┴───────────────┤
│  MOBILE: Stacked — Widgets → Chat → Sidebar     │
└─────────────────────────────────────────────────┘
```

### Design System

- **Typography:** System font stack (`-apple-system, BlinkMacSystemFont, Segoe UI, Roboto`)
- **Spacing:** 4px base grid. `p-3` (12px) for cards, `gap-2` (8px) between items.
- **Cards:** `glass-light` class (backdrop-blur + white/5 bg). Rounded-2xl corners.
- **Empty States:** Centered emoji + descriptive text. Always provide a CTA.
- **Colors:** Dark theme. Each tab has a signature gradient (cyan, violet, emerald, etc.).

### ASCII Wireframe (Mobile)

```
┌────────────────────────┐
│ ☰  MCC     🔍 📝 [Out]│
├────────────────────────┤
│ [Home][School][Jobs]►  │
├────────────────────────┤
│ ┌────────────────────┐ │
│ │ 🎯 Next Actions    │ │
│ │ 1. Lab 3 due tmrw  │ │
│ │ 2. Security+ Ch.5  │ │
│ │ 3. Read: Zero-Day  │ │
│ └────────────────────┘ │
│ ┌──┐┌──┐┌──┐┌──┐      │
│ │📝││🧠││💼││📰│      │
│ │ 3││42││ 5││ 4│      │
│ └──┘└──┘└──┘└──┘      │
│ ┌────────────────────┐ │
│ │ ⏱️ Focus: 25:00    │ │
│ │    [Start] [Reset] │ │
│ └────────────────────┘ │
│ ┌────────────────────┐ │
│ │ 💬 Chat with Agent │ │
│ │ [Ask anything...]  │ │
│ └────────────────────┘ │
└────────────────────────┘
```

---

## 8) MVP IN 14 DAYS + ROADMAP IN 90 DAYS

### MVP Scope (14 Days)

**Week 1: Foundation**
- Day 1-2: Wire D1 schema to replace localStorage. Implement `lib/d1.ts` adapter.
- Day 3-4: Connect Cloudflare Tunnel to OpenClaw VPS. Real agent responses in chat.
- Day 5: Wire auth to D1 sessions table. Add login rate limiting.
- Day 6-7: Add user_events tracking (click, complete, dismiss). Wire to next-actions engine.

**Week 2: Intelligence**
- Day 8-9: Implement deadline-based next-actions from real assignment data.
- Day 10: Add RSS cron worker (HackerNews, Krebs). Store in research table.
- Day 11: Add ICS calendar import for school deadlines.
- Day 12: Add service worker for PWA offline support.
- Day 13-14: Polish, bug fixes, mobile testing, deploy to Cloudflare Pages.

### 90-Day Roadmap

| Week | Milestone |
|------|-----------|
| 1-2 | MVP: D1, real agents, auth, events |
| 3-4 | RSS intelligence feed, ICS import, momentum score |
| 5-6 | Spaced repetition engine, skill-to-job matcher |
| 7-8 | Email digest parser, notification priority queue |
| 9-10 | Knowledge graph (entity extraction), semantic search |
| 11-12 | Weekly retro generator, decision journal |
| 13 | Agent workstation handoff, multi-agent collaboration |

### Cut List (Defer)

- ❌ Multi-user support (not needed for personal dashboard)
- ❌ Mobile native app (PWA is sufficient)
- ❌ Real-time collaborative editing (single user)
- ❌ Payment/subscription features (free-tier only)
- ❌ Custom themes (one dark theme is fine for now)

### Integration Order

1. **Cloudflare Tunnel → OpenClaw** (unlocks real AI agents)
2. **D1 storage** (unlocks cross-device sync)
3. **RSS feeds** (free, no auth, immediate value)
4. **ICS calendar** (school deadlines are highest priority data)
5. **Email parsing** (requires Cloudflare Email Routing setup)

---

## 9) SECURITY & PRIVACY CHECKLIST

### Top 10 Threats

| # | Threat | Mitigation |
|---|--------|-----------|
| 1 | **Session hijacking** | httpOnly + secure + sameSite cookies. No session ID in URL. |
| 2 | **CSRF** | Per-session CSRF token in JS-readable cookie. Validate on mutations. |
| 3 | **XSS** | React auto-escapes. Sanitize agent responses. No `dangerouslySetInnerHTML`. |
| 4 | **Brute force login** | Rate limit login endpoint (5 attempts/min). Use constant-time comparison. |
| 5 | **Secret exposure** | `MCC_PASSWORD` in env var only. Never in client bundle. `.env.local` in `.gitignore`. |
| 6 | **D1 injection** | Use parameterized queries. Never string-interpolate SQL. |
| 7 | **DoS on free tier** | Cloudflare DDoS protection. Rate limit API routes. |
| 8 | **Data loss** | D1 has automatic backups. Add manual export button in Settings. |
| 9 | **Tunnel compromise** | Cloudflare Access (Zero Trust) adds extra auth layer on tunnel. |
| 10 | **Stale sessions** | 180-day max. Explicit logout clears session. Cron purges expired sessions. |

### Data Retention

- `user_events`: Auto-purge after 90 days (cron job)
- `agent_runs`: Keep last 1000 per user, purge older
- `api_cache`: TTL-based expiry (already in schema)
- `sessions`: Purge expired sessions daily

### Encryption

- D1 data is encrypted at rest by Cloudflare
- HTTPS enforced by Cloudflare (free SSL)
- Connector configs (`connectors.config`) should be encrypted with a user-derived key before storage

### Email/Calendar Handling

- Email content is parsed server-side, never stored raw
- Only extracted fields (title, due date, course) are persisted
- ICS files are fetched server-side via cron, not exposed to client
- No email credentials stored in D1 — use Cloudflare Email Routing (no IMAP needed)

---

## 10) THE 10 BIGGEST "DO THIS NEXT" ACTIONS

### 1. Wire D1 to Replace localStorage
- **Why:** Cross-device sync is the #1 gap. Without it, phone ≠ laptop.
- **What:** Create `lib/d1.ts` adapter that mirrors `lib/store.ts` API but queries D1.
- **Validate:** Create a note on laptop, see it on phone.

### 2. Connect Cloudflare Tunnel to OpenClaw VPS
- **Why:** The chat is currently demo text. Real agents are the core value.
- **What:** Follow `cloudflare/DEPLOY.md` Step 4. Set `NEXT_PUBLIC_API_BASE`.
- **Validate:** Send a message in chat, get a real agent response.

### 3. Add user_events Tracking
- **Why:** Powers the Think Like Me engine, momentum score, adaptive home, weekly retros.
- **What:** Add `trackEvent()` calls on click, complete, dismiss actions in UI components.
- **Validate:** Check `user_events` table has rows after interacting with dashboard.

### 4. Upgrade Next-Actions to Read Real Data
- **Why:** Current engine uses time-of-day rules only. Needs real deadline/skill data.
- **What:** Query `assignments` and `lessons` tables in `/api/next-actions/route.ts`.
- **Validate:** Create an assignment due tomorrow → see it in next actions.

### 5. Add RSS Cron Worker
- **Why:** Research tab has demo articles. Real articles provide immediate value.
- **What:** Cloudflare Worker with cron trigger. Fetch HackerNews, Krebs, Dark Reading RSS.
- **Validate:** Research tab shows real articles after cron runs.

### 6. Add ICS Calendar Import
- **Why:** School deadlines are the highest-priority data source.
- **What:** Settings page field for ICS URL. Cron worker parses and upserts assignments.
- **Validate:** Paste Blackboard ICS URL → assignments appear.

### 7. Add Error Boundaries
- **Why:** One component crash shouldn't take down the whole app.
- **What:** Wrap each tab's WidgetPanel in React error boundary.
- **Validate:** Force an error in one tab → other tabs still work.

### 8. Split Monolith Components
- **Why:** `WidgetPanel.tsx` (1000+ lines) and `page.tsx` (500+ lines) are hard to maintain.
- **What:** Extract each tab's widgets into separate files: `widgets/HomeWidgets.tsx`, etc.
- **Validate:** Build + lint pass. Same visual output.

### 9. Add Service Worker for Offline
- **Why:** PWA manifest exists but no offline support. Dashboard should work without network.
- **What:** `next-pwa` package or manual service worker in `public/sw.js`.
- **Validate:** Turn off network → app still loads with cached data.

### 10. Add Basic Tests
- **Why:** Zero tests means regressions ship silently.
- **What:** Add Vitest. Write tests for `lib/store.ts` (pure functions), `lib/auth.ts` (session logic), and `/api/next-actions`.
- **Validate:** `npm test` passes. CI runs tests on every PR.

---

## CODEBASE REVIEW

### What's Good ✅

- **Architecture choice:** Cloudflare free tier is smart. D1 + KV + Workers AI + Pages = $0/month.
- **Vector-ready design:** The `documents` table + FTS5 + `searchAll()` is a clean upgrade path to semantic search.
- **UI quality:** Glassmorphism design, gradient tabs, responsive layout — looks production-ready.
- **Type safety:** TypeScript throughout with proper interfaces for all domain types.
- **Agent workstation pattern:** Chat + context panels per tab is a strong UX pattern.

### What Needs Improvement ⚠️

| Issue | File | Recommendation |
|-------|------|---------------|
| Monolith components | `WidgetPanel.tsx` (1000+ lines) | Split into per-tab files in `components/widgets/` |
| No error boundaries | `page.tsx` | Add React error boundaries around each section |
| Demo data hardcoded | `store.ts` DEFAULT_* arrays | Move to D1 seed script |
| No input sanitization | Chat + notes | Sanitize before render (DOMPurify or React's built-in) |
| No loading states | API calls in `page.tsx` | Add skeleton loaders for each widget |
| Console-only errors | `page.tsx` error state | Add toast notification component |
| No env validation | `auth.ts` | Validate `MCC_PASSWORD` is set on startup, warn if default |

### File Structure Recommendation

```
web/
├── app/
│   ├── api/
│   │   ├── auth/          ✅ Good separation
│   │   ├── agents/        ✅
│   │   ├── chat/stream/   ✅
│   │   ├── next-actions/  ✅ New
│   │   └── conversations/ ✅
│   ├── layout.tsx         ✅
│   └── page.tsx           ⚠️ Split: extract Header, Sidebar, ChatPanel
├── components/
│   ├── Login.tsx          ✅
│   ├── WidgetPanel.tsx    ⚠️ Split into widgets/ directory
│   └── widgets/           🆕 Recommended
│       ├── HomeWidgets.tsx
│       ├── SchoolWidgets.tsx
│       ├── JobsWidgets.tsx
│       ├── SkillsWidgets.tsx
│       ├── SportsWidgets.tsx
│       ├── StocksWidgets.tsx
│       ├── ResearchWidgets.tsx
│       ├── NotesWidgets.tsx
│       └── SettingsWidgets.tsx
├── lib/
│   ├── api.ts             ✅ Fixed: no more `any` types
│   ├── auth.ts            ✅ New: real session management
│   ├── store.ts           ✅ Good vector-ready design
│   └── types.ts           ✅ Updated with new types
└── cloudflare/
    ├── d1-schema.sql      ✅ Expanded with 8 new tables
    └── DEPLOY.md          ✅ Excellent guide
```

# 🚀 Get Your OpenClaw Agents Running — Step by Step

This is an **in-depth, copy-paste-ready** guide to get your 6 OpenClaw agents
live on your My Control Center website.  Every step includes the exact commands.

---

## Architecture (How It Works)

```
┌─────────────────────────────────────────────────────────────┐
│  YOUR BROWSER                                                │
│  ┌──────────────┐   ┌──────────────────────────────────┐    │
│  │  Dashboard    │──▶│  Cloudflare Pages (Edge)         │    │
│  │  (React UI)  │◀──│  /api/chat/stream (SSE proxy)    │    │
│  │              │   │  /api/agents/connect (warm up)    │    │
│  │  Agents are  │   │  /api/agents/heartbeat (keepalive)│    │
│  │  ALWAYS ON   │   │  /api/agents/scan (web search)   │    │
│  └──────────────┘   └───────────────┬──────────────────┘    │
│                                     │                        │
│                          Cloudflare Tunnel (encrypted)       │
│                                     │                        │
│                     ┌───────────────▼──────────────────┐    │
│                     │  YOUR VPS (OpenClaw)              │    │
│                     │                                   │    │
│                     │  🤷 Meh (main)        — kimi-k2.5│    │
│                     │  🏀 Sports Analyst    — gpt-5.3  │    │
│                     │  🎓 Academic Researcher— gpt-5.3 │    │
│                     │  🛡️ Cyber Career Coach — gpt-5.3 │    │
│                     │  💼 Job Hunter        — gpt-5.3  │    │
│                     │  📈 Stock Analyst     — gpt-5.3  │    │
│                     │                                   │    │
│                     │  Sessions stay warm (no cold start)│    │
│                     │  Heartbeat every 30s              │    │
│                     │  Web search built-in              │    │
│                     └───────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**Key design:** When you open the dashboard, it immediately connects to
every agent.  A heartbeat keeps them warm.  When you type a message, the
agent is *already running* — zero cold start, Telegram-speed responses.

---

## Step 1: Local Setup (3 minutes)

```bash
# 1. Clone (skip if you already have it)
git clone https://github.com/casonas/my-control-center.git
cd my-control-center/web

# 2. Install dependencies
npm install

# 3. Create your local env file
cp .env.example .env.local

# 4. Edit .env.local — set your password
#    Open .env.local in any editor and change:
#    MCC_PASSWORD=your-actual-strong-password
nano .env.local   # or: code .env.local

# 5. Verify the build works
npm run build

# 6. Start local dev server
npm run dev
# → Open http://localhost:3000
# → Login with your password
# → You'll see the 6 agents in the sidebar!
```

**What you'll see:** All 6 agents appear in the sidebar with green status
dots.  Chat won't work yet (no VPS connected) but the entire UI is live.

---

## Step 2: Set Up Your VPS Endpoints (10 minutes)

Your OpenClaw VPS needs to expose 4 HTTP endpoints that the dashboard
calls.  Create a file on your VPS (e.g. `~/mcc-bridge/server.py` or
`~/mcc-bridge/server.js`) that handles these:

### Endpoint 1: `/agents/connect` (POST)

Called when dashboard loads.  Warms up an agent process.

```
Request:  { "agentId": "sports", "sessionId": "ses_abc123", "model": "openai-codex/gpt-5.3-codex" }
Response: { "sessionId": "ses_abc123", "status": "connected" }
```

**What to do:** Start (or verify running) the OpenClaw agent process for
the given `agentId`.  Store the `sessionId` → agent mapping in memory.

### Endpoint 2: `/agents/heartbeat` (POST)

Called every 30 seconds.  Keeps agent processes alive.

```
Request:  { "sessions": [{ "agentId": "sports", "sessionId": "ses_abc123" }, ...] }
Response: { "sessions": [{ "agentId": "sports", "sessionId": "ses_abc123", "status": "connected" }, ...] }
```

**What to do:** Check each agent is still running.  Return their status.

### Endpoint 3: `/chat/stream` (POST → SSE)

The main chat endpoint.  Returns Server-Sent Events (streaming).

```
Request Headers:
  X-Agent-Id: sports
  X-Agent-Session: ses_abc123
  X-Collab-Agents: sports,stocks   (optional, for multi-agent)

Request Body:
  { "conversationId": "mock-conv-abc", "message": "What are today's NBA scores?", "agentId": "sports", "sessionId": "ses_abc123" }

Response (SSE stream):
  event: delta
  data: {"text": "Here are "}

  event: delta
  data: {"text": "today's scores..."}

  event: done
  data: {}
```

**What to do:** Route to the correct OpenClaw agent using `X-Agent-Id`
header (or body `agentId`).  Use the warm session from Step 1.
Stream the response as SSE `delta` events.

### Endpoint 4: `/agents/scan` (POST)

Triggers a web search + knowledge update.

```
Request:  { "agentId": "stocks", "query": "", "scope": "all" }
Response: { "runId": "scan_123", "status": "scanning" }
```

**What to do:** Have the agent search the web for its domain
(stocks → market news, sports → scores, etc.) and push results
back via `POST /api/agents/ingest` with the runner token.

---

### Example: Minimal Python Bridge (runs on your VPS)

Save this as `~/mcc-bridge/bridge.py` on your VPS:

```python
#!/usr/bin/env python3
"""Minimal bridge between MCC dashboard and OpenClaw agents."""

import json, subprocess, time, threading
from http.server import HTTPServer, BaseHTTPRequestHandler

# Map agentId → OpenClaw agent directory
AGENTS = {
    "main":        {"dir": "~/.openclaw/agents/main/agent",        "model": "moonshot/kimi-k2.5"},
    "sports":      {"dir": "~/.openclaw/agents/sports/agent",      "model": "openai-codex/gpt-5.3-codex"},
    "school-work": {"dir": "~/.openclaw/agents/school-work/agent", "model": "openai-codex/gpt-5.3-codex"},
    "career":      {"dir": "~/.openclaw/agents/career/agent",      "model": "openai-codex/gpt-5.3-codex"},
    "job-search":  {"dir": "~/.openclaw/agents/job-search/agent",  "model": "openai-codex/gpt-5.3-codex"},
    "stocks":      {"dir": "~/.openclaw/agents/stocks/agent",      "model": "openai-codex/gpt-5.3-codex"},
}

# Active sessions (agentId → process/session info)
sessions = {}

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        if self.path == "/agents/connect":
            agent_id = body.get("agentId", "main")
            session_id = body.get("sessionId", f"ses_{int(time.time())}")
            # Start/warm the agent (your OpenClaw startup command here)
            sessions[agent_id] = {"sessionId": session_id, "status": "connected"}
            self._json({"sessionId": session_id, "status": "connected"})

        elif self.path == "/agents/heartbeat":
            result = []
            for s in body.get("sessions", []):
                aid = s.get("agentId")
                status = "connected" if aid in sessions else "disconnected"
                result.append({"agentId": aid, "sessionId": s.get("sessionId"), "status": status})
            self._json({"sessions": result})

        elif self.path == "/chat/stream":
            agent_id = self.headers.get("X-Agent-Id") or body.get("agentId", "main")
            message = body.get("message", "")

            # TODO: Replace this with your actual OpenClaw agent call
            # For now, echo back to prove the pipeline works
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()

            # Stream response word by word
            response = f"[{agent_id}] I received your message: {message}"
            for word in response.split():
                self.wfile.write(f"event: delta\\ndata: {json.dumps({'text': word + ' '})}\\n\\n".encode())
                self.wfile.flush()
            self.wfile.write(b"event: done\\ndata: {}\\n\\n")
            self.wfile.flush()
            return

        elif self.path == "/agents/scan":
            agent_id = body.get("agentId", "main")
            # TODO: Trigger OpenClaw web search here
            self._json({"runId": f"scan_{int(time.time())}", "status": "scanning"})

        else:
            self._json({"error": "Not found"}, 404)

    def _json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

if __name__ == "__main__":
    print("MCC Bridge running on :8080")
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
```

Run it:
```bash
python3 ~/mcc-bridge/bridge.py
```

Test it locally on your VPS:
```bash
curl -X POST http://localhost:8080/agents/connect \
  -H "Content-Type: application/json" \
  -d '{"agentId":"sports","sessionId":"test123"}'
# → {"sessionId": "test123", "status": "connected"}

curl -X POST http://localhost:8080/chat/stream \
  -H "Content-Type: application/json" \
  -H "X-Agent-Id: sports" \
  -d '{"message":"Who won the NBA game last night?"}'
# → SSE stream with response
```

---

## Step 3: Cloudflare Tunnel (5 minutes)

This connects your VPS to Cloudflare so the dashboard can reach it
without opening firewall ports.

```bash
# On your VPS:

# 1. Install cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# 2. Login to Cloudflare (opens a URL — paste in browser)
cloudflared tunnel login

# 3. Create tunnel
cloudflared tunnel create mcc-agents
# Note the tunnel ID printed (e.g. 12345678-abcd-...)

# 4. Route your subdomain
cloudflared tunnel route dns mcc-agents api.yourdomain.com

# 5. Create config
cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: YOUR_TUNNEL_ID_HERE
credentials-file: /home/YOUR_USER/.cloudflared/YOUR_TUNNEL_ID_HERE.json
ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:8080
    originRequest:
      connectTimeout: 60s
      noTLSVerify: true
  - service: http_status:404
EOF

# 6. Test it
cloudflared tunnel run mcc-agents
# In another terminal:
curl https://api.yourdomain.com/agents/connect \
  -X POST -H "Content-Type: application/json" \
  -d '{"agentId":"main"}'

# 7. Make it permanent
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

---

## Step 4: Connect Dashboard to VPS (2 minutes)

Now wire the dashboard to your VPS endpoints.

### Option A: Cloudflare Dashboard (Production)

1. Go to **Cloudflare Dashboard → Pages → my-control-center → Settings → Environment Variables**
2. Add these variables:

| Variable | Value |
|---|---|
| `MCC_PASSWORD` | `your-strong-password` |
| `MCC_VPS_SSE_URL` | `https://api.yourdomain.com/chat/stream` |
| `MCC_VPS_CONNECT_URL` | `https://api.yourdomain.com/agents/connect` |
| `MCC_VPS_HEARTBEAT_URL` | `https://api.yourdomain.com/agents/heartbeat` |
| `MCC_VPS_SCAN_URL` | `https://api.yourdomain.com/agents/scan` |
| `MCC_RUNNER_TOKEN` | `generate-a-random-secret-here` |

3. Save and **trigger a redeploy**

### Option B: Local Development

Edit `web/.env.local`:

```bash
MCC_PASSWORD=your-password
MCC_VPS_SSE_URL=https://api.yourdomain.com/chat/stream
MCC_VPS_CONNECT_URL=https://api.yourdomain.com/agents/connect
MCC_VPS_HEARTBEAT_URL=https://api.yourdomain.com/agents/heartbeat
MCC_VPS_SCAN_URL=https://api.yourdomain.com/agents/scan
MCC_RUNNER_TOKEN=your-runner-token
```

Then `npm run dev` and open http://localhost:3000.

---

## Step 5: Deploy to Cloudflare Pages (3 minutes)

```bash
cd my-control-center/web

# Build for Cloudflare
npm run build

# Deploy
npx wrangler pages deploy .next --project-name=my-control-center

# Or set up GitHub auto-deploy:
# 1. Push to GitHub
# 2. In Cloudflare Dashboard → Pages → Create Project → Connect to GitHub
# 3. Set build command: cd web && npm install && npm run build
# 4. Set build output: web/.next
# 5. Add environment variables from Step 4
# 6. Every push auto-deploys
```

---

## Step 6: Verify Everything Works

1. **Open your dashboard** (https://your-site.pages.dev or localhost:3000)
2. **Login** with your password
3. **Check the sidebar** — all 6 agents should show green dots (connected)
4. **Click an agent** (e.g. 🏀 Sports Analyst)
5. **Type a message** → you should get a streaming response with no delay
6. **Click "🌐 Scan Web"** in Quick Actions → triggers a web search
7. **Toggle "👥 Collab"** → select multiple agents → send a message

---

## Adding Sub-Agents

Your agents can spawn sub-agents.  Two ways:

### From the UI:
1. Click **＋** next to "Agents" in the sidebar
2. Fill in: name, ID, model, and **select a parent agent**
3. Click "Add Agent" → it appears nested under the parent

### From the VPS (programmatic):
```bash
# POST to the ingest endpoint with a special "agent" type
curl -X POST https://your-site.pages.dev/api/agents/ingest \
  -H "Authorization: Bearer YOUR_RUNNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "sports",
    "items": [{
      "type": "note",
      "title": "New sub-agent spawned: NBA Specialist",
      "content": "Created NBA-specific sub-agent for detailed game analysis",
      "tags": ["sub-agent", "nba"]
    }]
  }'
```

---

## Web Scanning — How Agents Update Knowledge

Agents scan the web in two ways:

### 1. On-demand (you click "🌐 Scan Web")
- Dashboard sends `POST /api/agents/scan` → VPS
- Agent searches the web for its domain
- Results pushed back via `POST /api/agents/ingest`

### 2. Scheduled (cron triggers in wrangler.toml)
The cron triggers already defined run automatically:
- Every 4 hours → fetch job postings
- Every 2 hours → fetch news & research
- Every 30 min → fetch sports scores
- Every 15 min → fetch stock data

### 3. During chat (agent decides to search)
When you ask something requiring fresh data, the agent can search
the web as part of its response (this is handled by OpenClaw's
built-in tool system — no extra setup needed).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Agents show gray dots (disconnected) | Check VPS is running: `curl http://localhost:8080/agents/connect -X POST -d '{"agentId":"main"}'` |
| Chat says "MCC_VPS_SSE_URL missing" | Set the env variable in Cloudflare Pages or .env.local |
| Slow responses (not Telegram speed) | Check tunnel: `sudo systemctl status cloudflared`. Make sure bridge is running. |
| "Upstream error 502" | VPS bridge crashed. Restart: `python3 ~/mcc-bridge/bridge.py` |
| Can't add sub-agents | Click ＋ in sidebar. Custom agents are stored in localStorage. |

---

## Quick Reference

```bash
# Local dev
cd web && npm run dev

# Build
npm run build

# Deploy
npx wrangler pages deploy .next --project-name=my-control-center

# VPS bridge
python3 ~/mcc-bridge/bridge.py

# Tunnel
sudo systemctl status cloudflared
sudo systemctl restart cloudflared
sudo journalctl -u cloudflared -f

# Test agent connection
curl -X POST https://api.yourdomain.com/agents/connect \
  -H "Content-Type: application/json" \
  -d '{"agentId":"main","sessionId":"test"}'
```

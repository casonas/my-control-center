# 🚀 Running the Dashboard Directly on Your OpenClaw VPS

Everything runs on your VPS — dashboard, bridge, and OpenClaw agents.
Your computer can be completely off. No Cloudflare Tunnel needed.

```
Browser → Caddy (HTTPS) → Next.js dashboard (port 3000)
                                   ↓ localhost
                          MCC Bridge (port 8081)
                                   ↓ localhost
                          OpenClaw Gateway (port 18789)
```

**Or** host the dashboard on Cloudflare Pages and proxy only the API/bridge
traffic through Caddy on the VPS:

```
Cloudflare Pages                     VPS (Caddy :443)
┌──────────────┐     HTTPS     ┌──────────────────────────────┐
│  Dashboard   │──────────────→│ api.my-control-center.com    │
│  (static)    │               │   → OpenClaw Gateway :18789  │
│              │──────────────→│ bridge.my-control-center.com │
│              │               │   → MCC Bridge :8081         │
└──────────────┘               └──────────────────────────────┘
```

---

## Prerequisites

| # | What | How to verify |
|---|------|---------------|
| 1 | VPS with SSH access | `ssh openclaw@your-vps-ip` |
| 2 | OpenClaw installed | `ls ~/.openclaw/agents/` |
| 3 | Node.js 18+ on VPS | `node --version` |
| 4 | Python 3 on VPS | `python3 --version` |

---

## Step 1 — Fix `gateway.bind` (if you got "Invalid input")

The error `Invalid config: gateway.bind: Invalid input` happens when
the value includes a port number. The field only accepts a hostname or
IP address — no port.

```bash
nano ~/.openclaw/openclaw.json
```

Paste exactly this (keep OpenClaw's gateway on localhost — it's internal):

```json
{
  "gateway": {
    "bind": "127.0.0.1"
  }
}
```

Then restart:

```bash
openclaw gateway restart
```

✅ **Verify:** No "Invalid config" error.

---

## Step 2 — Clone the dashboard onto your VPS

```bash
cd ~
git clone https://github.com/casonas/my-control-center.git
cd my-control-center/web
npm install
```

---

## Step 3 — Configure environment variables

```bash
cp .env.example .env.local
nano .env.local
```

Set at minimum:

```bash
MCC_PASSWORD=your-strong-password-here
MCC_COOKIE_SIGNING_SECRET=paste-a-long-random-string-here
NEXT_PUBLIC_API_BASE=/api
MCC_VPS_SSE_URL=http://localhost:8081/chat/stream
MCC_VPS_CONNECT_URL=http://localhost:8081/agents/connect
MCC_VPS_HEARTBEAT_URL=http://localhost:8081/agents/heartbeat
MCC_VPS_SCAN_URL=http://localhost:8081/agents/scan
```

Generate a random secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Step 4 — Build the dashboard

```bash
cd ~/my-control-center/web
npm run build
```

✅ **Verify:** Ends with `○ (Static)` and `ƒ (Dynamic)` lines, no errors.

---

## Step 5 — Install PM2 and start everything

PM2 keeps both the dashboard and bridge running 24/7 and restarts
them automatically if they crash or the VPS reboots.

```bash
# Install PM2 globally
npm install -g pm2

# Create the log directory
mkdir -p ~/logs

# Create a secrets file — stays only on the VPS, never committed to git
cat > ~/.env.secrets << 'EOF'
export MCC_PASSWORD="your-strong-password-here"
export MCC_COOKIE_SIGNING_SECRET="paste-a-long-random-string-here"
EOF
chmod 600 ~/.env.secrets

# Generate a signing secret (copy the output into .env.secrets above)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# Source secrets then start both processes
source ~/.env.secrets
cd ~/my-control-center
pm2 start vps/pm2.config.js

# Check they're running
pm2 status
```

✅ **Verify:** Both `mcc-dashboard` and `mcc-bridge` show `online`.

```bash
# Save process list so it survives a reboot
pm2 save

# Enable PM2 to start on boot (follow the command it prints)
pm2 startup
```

> **Reboot tip:** Add `source ~/.env.secrets` to `~/.profile` so secrets are
> available when PM2 auto-starts after a reboot.

---

## Step 6 — Open the firewall

```bash
# Allow the dashboard port (only needed if you're not using Caddy yet)
sudo ufw allow 3000/tcp
sudo ufw reload
```

---

## Step 7 — Test it

```bash
# From the VPS itself
curl http://localhost:3000/api/ping
# Expected: {"ok":true,"ping":true,"ts":...}

curl http://localhost:3000/api/auth/me
# Expected: {"ok":true,"authenticated":false,"authed":false}
```

Then from your computer's browser:

```
http://YOUR_VPS_IP:3000
```

You should see the login screen. Log in with your `MCC_PASSWORD`.

---

## Step 8 (Optional) — Add a domain + free HTTPS with Caddy

If you have a domain, Caddy gives you automatic HTTPS with zero config.

```bash
# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudflare.com/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudflare.com/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# Deploy the Caddyfile — serves api + bridge subdomains with CORS & SSE support
sudo cp ~/my-control-center/vps/Caddyfile /etc/caddy/Caddyfile

# Open HTTPS port and start
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

In Cloudflare DNS, add **A records** pointing to your VPS IP:

| Type | Name     | Content           | Proxy |
|------|----------|-------------------|-------|
| A    | api      | YOUR_VPS_IP       | ⬜ DNS only |
| A    | bridge   | YOUR_VPS_IP       | ⬜ DNS only |

> **Start with DNS-only (gray cloud)** so Caddy can provision Let's Encrypt
> certificates directly. Once HTTPS is confirmed working, you can switch to
> proxied (orange cloud) for DDoS protection.
>
> **If you enable orange cloud:** Cloudflare terminates idle connections
> after **100 seconds**. The MCC bridge already sends a heartbeat every 30 s,
> but if you add new SSE endpoints make sure they send a ping/comment line
> (`: keepalive`) at least every 30 s to prevent Cloudflare from closing
> the connection.

Set the following environment variables in Cloudflare Pages:

```
MCC_VPS_SSE_URL=https://bridge.my-control-center.com/chat/stream
MCC_VPS_CONNECT_URL=https://bridge.my-control-center.com/agents/connect
MCC_VPS_HEARTBEAT_URL=https://bridge.my-control-center.com/agents/heartbeat
MCC_VPS_SCAN_URL=https://bridge.my-control-center.com/agents/scan
```

### Verify the deployment

Run these from any machine:

```bash
# 1. HTTPS works
curl -I https://api.my-control-center.com/
curl -I https://bridge.my-control-center.com/status

# 2. CORS allows pages.dev origin
curl -I -H "Origin: https://my-control-center.pages.dev" \
     https://api.my-control-center.com/
# → Access-Control-Allow-Origin: https://my-control-center.pages.dev
# → Access-Control-Allow-Credentials: true

# 3. SSE streaming doesn't hang (chunks appear one by one, not all at once)
curl -N -H "Content-Type: application/json" \
     -d '{"agentId":"main","message":"ping"}' \
     https://bridge.my-control-center.com/chat/stream
```

✅ **Verify:** `https://api.my-control-center.com` and
`https://bridge.my-control-center.com` both respond with a green padlock.

### Fallback: If Let's Encrypt fails (rate limits)

Let's Encrypt allows **5 duplicate certificates per week** per domain.
If you hit the rate limit during testing, use one of these alternatives:

**Option A — Use `acme.sh` to provision certificates manually:**

```bash
# Install acme.sh
curl https://get.acme.sh | sh -s email=you@example.com

# Issue certs (uses HTTP-01 challenge — ports 80/443 must be open)
~/.acme.sh/acme.sh --issue -d api.my-control-center.com \
                            -d bridge.my-control-center.com \
                            --standalone

# Install certs where Caddy can read them
~/.acme.sh/acme.sh --install-cert -d api.my-control-center.com \
  --key-file  /etc/caddy/certs/key.pem \
  --fullchain-file /etc/caddy/certs/cert.pem \
  --reloadcmd "sudo systemctl reload caddy"
```

Then update the Caddyfile to use the manual certs:

```
api.my-control-center.com {
    tls /etc/caddy/certs/cert.pem /etc/caddy/certs/key.pem
    reverse_proxy localhost:18789
    # ... rest of config unchanged
}
```

**Option B — Switch to nginx temporarily:**

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo certbot --nginx -d api.my-control-center.com -d bridge.my-control-center.com
```

Minimal nginx config (`/etc/nginx/sites-available/mcc`):

```nginx
server {
    listen 443 ssl;
    server_name api.my-control-center.com;
    ssl_certificate     /etc/letsencrypt/live/api.my-control-center.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.my-control-center.com/privkey.pem;

    location / {
        proxy_pass http://localhost:18789;
        # CORS
        add_header Access-Control-Allow-Origin "https://my-control-center.pages.dev" always;
        add_header Access-Control-Allow-Credentials "true" always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-CSRF-Token" always;
        if ($request_method = OPTIONS) { return 204; }
    }
}

server {
    listen 443 ssl;
    server_name bridge.my-control-center.com;
    ssl_certificate     /etc/letsencrypt/live/bridge.my-control-center.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bridge.my-control-center.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8081;
        # SSE: disable buffering
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header X-Accel-Buffering no;
        # CORS
        add_header Access-Control-Allow-Origin "https://my-control-center.pages.dev" always;
        add_header Access-Control-Allow-Credentials "true" always;
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Agent-Id, X-Agent-Session" always;
        if ($request_method = OPTIONS) { return 204; }
    }
}
```

Switch back to Caddy once the rate limit resets (7 days).

---

## Day-to-day commands

```bash
# Check everything is running
pm2 status

# View live logs
pm2 logs

# Restart after a code update
cd ~/my-control-center/web
git pull
npm install
npm run build
pm2 restart mcc-dashboard

# Stop everything
pm2 stop all

# Check bridge logs specifically
pm2 logs mcc-bridge --lines 50
```

---

## Architecture summary

| Component | Port | Managed by | Talks to |
|-----------|------|-----------|----------|
| Caddy (HTTPS) | 443 | systemd | api → :18789, bridge → :8081 |
| OpenClaw Gateway | 18789 | openclaw / systemd | — |
| MCC bridge | 8081 | PM2 | OpenClaw on :18789 |
| Next.js dashboard | 3000 | PM2 (VPS) or Cloudflare Pages | bridge on :8081 |

Everything communicates over `localhost` — no tunnel, no extra hops,
maximum speed.

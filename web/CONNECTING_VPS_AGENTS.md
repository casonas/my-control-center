# 🚀 Running the Dashboard Directly on Your OpenClaw VPS

Everything runs on your VPS — dashboard, bridge, and OpenClaw agents.
Your computer can be completely off. No Cloudflare Tunnel needed.

```
Browser → Caddy (HTTPS) → Next.js dashboard (port 3000)
                                   ↓ localhost
                          MCC Bridge (port 8081)
                                   ↓ localhost
                          OpenClaw agents (port 8080)
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

# Configure — replace the domain with yours
sudo cp ~/my-control-center/vps/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile   # replace dashboard.yourdomain.com

# Open HTTPS port and start
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

In your DNS (Cloudflare or any registrar): add an **A record** pointing
`dashboard.yourdomain.com` → your VPS IP.

> **Cloudflare DNS tip:** Use **DNS-only** (grey cloud), not proxied
> (orange cloud), for the A record. Caddy handles SSL directly — Cloudflare
> proxy would interfere with the certificate request.

✅ **Verify:** `https://dashboard.yourdomain.com` loads with a green padlock.

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
| Next.js dashboard | 3000 | PM2 | bridge on :8081 |
| MCC bridge | 8081 | PM2 | OpenClaw on :8080 |
| OpenClaw agents | 8080 | openclaw / systemd | — |
| Caddy (optional) | 443 | systemd | dashboard on :3000 |

Everything communicates over `localhost` — no tunnel, no extra hops,
maximum speed.

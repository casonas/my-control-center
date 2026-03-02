# MCC Complete Setup Guide — VPS + Cloudflare

Everything you need to go from zero to a live dashboard that chats
with your OpenClaw agents 24/7, even when your computer is off.

---

## Overview

```
Your Phone / Browser
        ↓  HTTPS
  [Optional: Cloudflare DNS → free SSL]
        ↓
   Your VPS (runs 24/7 in a data center)
   ├── Next.js dashboard  :3000  ← the website
   ├── MCC Bridge         :8081  ← translates API calls for OpenClaw
   └── OpenClaw agents    :8080  ← your AI agents
```

No Cloudflare Tunnel. No extra hops. Everything talks over `localhost`.

---

## Part 1 — VPS Setup

### 1.1 SSH into your VPS

```bash
ssh openclaw@YOUR_VPS_IP
```

---

### 1.2 Install Node.js 18+ (if not already installed)

```bash
# Check current version first
node --version   # needs to say v18.x or higher

# If missing or too old, install via NodeSource:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version
npm --version
```

---

### 1.3 Fix the `gateway.bind` error in OpenClaw

If you saw `Invalid config: gateway.bind: Invalid input`, the fix is
removing any port number from the bind address — it only accepts a
hostname or IP:

```bash
nano ~/.openclaw/openclaw.json
```

The file should look exactly like this:

```json
{
  "gateway": {
    "bind": "127.0.0.1"
  }
}
```

Save (`Ctrl+X` → `Y` → `Enter`), then restart:

```bash
openclaw gateway restart
```

✅ Verify: no "Invalid config" error appears.

---

### 1.4 Clone the dashboard

```bash
cd ~
git clone https://github.com/casonas/my-control-center.git
cd my-control-center/web
npm install
```

---

### 1.5 Create your secrets file

**Never put passwords in a file that gets committed to git.**
Create a separate secrets file that lives only on the VPS:

```bash
nano ~/.env.secrets
```

Paste this — replace the placeholder values:

```bash
export MCC_PASSWORD="pick-a-strong-password-nobody-can-guess"
export MCC_COOKIE_SIGNING_SECRET="PASTE_RANDOM_STRING_HERE"
```

To generate the signing secret, run:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copy the output and paste it as `MCC_COOKIE_SIGNING_SECRET`.

Lock down the file so only you can read it:

```bash
chmod 600 ~/.env.secrets
```

Add it to your shell startup so it's always loaded (including after reboots):

```bash
echo 'source ~/.env.secrets' >> ~/.profile
source ~/.profile
```

✅ Verify: `echo $MCC_PASSWORD` prints your password.

---

### 1.6 Build the dashboard

```bash
cd ~/my-control-center/web
npm run build
```

This takes 1–3 minutes. You should see:

```
✓ Compiled successfully
✓ Generating static pages (5/5)
```

If you see errors, make sure Node.js is 18+ (`node --version`).

---

### 1.7 Install PM2 and start everything

PM2 is a process manager that keeps the dashboard and bridge running
forever — it restarts them if they crash and brings them back after
a reboot.

```bash
# Install PM2
npm install -g pm2

# Create the log directory
mkdir -p ~/logs

# Start both the dashboard and the bridge
cd ~/my-control-center
pm2 start vps/pm2.config.js

# Check status
pm2 status
```

You should see two rows both showing **online**:

```
┌─────────────────┬────┬───────┬──────┐
│ name            │ id │ mode  │ status│
├─────────────────┼────┼───────┼──────┤
│ mcc-dashboard   │ 0  │ fork  │ online│
│ mcc-bridge      │ 1  │ fork  │ online│
└─────────────────┴────┴───────┴──────┘
```

---

### 1.8 Make PM2 survive reboots

```bash
# Save the current process list
pm2 save

# Generate and run the startup command (copy and run what it prints)
pm2 startup
```

PM2 will print a command like:
```
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u openclaw --hp /home/openclaw
```

Copy that exact command and run it. After this, your dashboard
restarts automatically every time the VPS reboots.

✅ Verify: `pm2 status` shows both processes online.

---

### 1.9 Open the firewall

```bash
# Allow the dashboard port
sudo ufw allow 3000/tcp

# If you'll use Caddy for HTTPS later, open these too
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

sudo ufw reload
sudo ufw status
```

---

### 1.10 Test from the VPS itself

```bash
# Should return {"ok":true,"ping":true,...}
curl http://localhost:3000/api/ping

# Should return {"ok":true,"authenticated":false,...}
curl http://localhost:3000/api/auth/me
```

Now test from your browser:

```
http://YOUR_VPS_IP:3000
```

You should see the login page. Log in with the password you set in
`MCC_PASSWORD`.

---

## Part 2 — Connect OpenClaw Agents to the Bridge

The bridge (`bridge.py`) translates the dashboard's API calls into
OpenClaw CLI commands. It should already be running from Step 1.7.

Test the bridge directly:

```bash
curl -X POST http://localhost:8081/agents/connect \
  -H "Content-Type: application/json" \
  -d '{"agentId":"main"}'
```

Expected: `{"sessionId":"...","status":"connected"}`

If this fails, check bridge logs:

```bash
pm2 logs mcc-bridge --lines 30
```

---

## Part 3 — Cloudflare Setup (optional, for a custom domain + HTTPS)

You don't *need* Cloudflare to run the dashboard. But if you want
`https://dashboard.yourdomain.com` instead of `http://IP:3000`,
here's how.

### 3.1 Add your domain to Cloudflare

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Click **Add a Site** → enter your domain → select the **Free** plan
3. Cloudflare will show you two nameservers (e.g., `ns1.cloudflare.com`)
4. Log into your domain registrar and replace the nameservers with
   Cloudflare's two. This usually takes 5–30 minutes to propagate.

✅ Verify: Domain shows **Active** in your Cloudflare dashboard.

---

### 3.2 Create a DNS A record pointing to your VPS

1. In Cloudflare: go to your domain → **DNS** → **Add record**
2. Fill in:

   | Field | Value |
   |-------|-------|
   | Type | A |
   | Name | `dashboard` (becomes `dashboard.yourdomain.com`) |
   | IPv4 address | `YOUR_VPS_IP` |
   | Proxy status | **DNS only** (grey cloud) ← important! |

3. Click **Save**

> **Why DNS only (grey cloud)?**
> Caddy (Step 3.3) handles SSL certificates directly from Let's Encrypt.
> If you turn on the Cloudflare proxy (orange cloud), it intercepts the
> certificate request and breaks Caddy. Keep it grey cloud.
>
> If you *want* the orange cloud (Cloudflare proxy), you'd need to skip
> Caddy and let Cloudflare handle SSL — but then your VPS must serve
> on port 80 unencrypted, which Cloudflare then proxies to HTTPS.
> For simplicity, use grey cloud + Caddy.

✅ Verify (from your computer): `ping dashboard.yourdomain.com` resolves to your VPS IP.

---

### 3.3 Install Caddy for automatic HTTPS

Caddy automatically gets and renews SSL certificates from Let's Encrypt
with zero configuration.

**On your VPS:**

```bash
# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudflare.com/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudflare.com/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

---

### 3.4 Configure Caddy

```bash
sudo nano /etc/caddy/Caddyfile
```

Delete everything in the file and paste this (replace the domain):

```
dashboard.yourdomain.com {
    reverse_proxy localhost:3000
}
```

Save and reload:

```bash
sudo systemctl reload caddy
```

✅ Verify:

```bash
sudo systemctl status caddy   # should show "active (running)"
```

Then from your browser: `https://dashboard.yourdomain.com`

You should see your login page with a **green padlock** in the address bar.

---

## Part 4 — Day-to-Day Commands

### Check that everything is running

```bash
pm2 status                   # dashboard + bridge status
sudo systemctl status caddy  # HTTPS proxy status (if installed)
```

### View live logs

```bash
pm2 logs                     # all processes
pm2 logs mcc-dashboard       # dashboard only
pm2 logs mcc-bridge          # bridge / OpenClaw calls only
```

### Update the dashboard after a code change

```bash
cd ~/my-control-center
git pull
cd web
npm install
npm run build
pm2 restart mcc-dashboard
```

### Restart everything

```bash
pm2 restart all
```

### Stop everything

```bash
pm2 stop all
```

---

## Part 5 — Troubleshooting

### "Login fails / says Invalid credentials"

- Check `MCC_PASSWORD` is loaded: `echo $MCC_PASSWORD`
- If empty: `source ~/.env.secrets` then `pm2 restart mcc-dashboard`

### "Chat sends but no response / stream hangs"

```bash
# Is the bridge running?
pm2 status

# Test the bridge directly
curl -X POST http://localhost:8081/agents/connect \
  -H "Content-Type: application/json" \
  -d '{"agentId":"main"}'

# Check bridge logs
pm2 logs mcc-bridge --lines 50
```

### "openclaw gateway restart says Invalid config"

See Step 1.3. The `gateway.bind` field must be just an IP address
(`"127.0.0.1"`) — no port number, no `http://` prefix.

### "Cannot reach the dashboard from my browser"

```bash
# Is the dashboard running?
pm2 status

# Is the port open?
sudo ufw status | grep 3000

# Test locally on the VPS
curl http://localhost:3000/api/ping
```

### "HTTPS certificate error in browser"

```bash
# Check Caddy logs
sudo journalctl -u caddy -n 50

# Make sure port 80 and 443 are open
sudo ufw status | grep -E "80|443"

# Make sure DNS A record points to this VPS IP
dig dashboard.yourdomain.com
```

---

## Quick Reference Card

| What | Command |
|------|---------|
| Check status | `pm2 status` |
| View logs | `pm2 logs` |
| Restart dashboard | `pm2 restart mcc-dashboard` |
| Restart bridge | `pm2 restart mcc-bridge` |
| Restart everything | `pm2 restart all` |
| Update code | `git pull && npm run build && pm2 restart mcc-dashboard` |
| Reload Caddy | `sudo systemctl reload caddy` |
| Edit secrets | `nano ~/.env.secrets` then `source ~/.env.secrets && pm2 restart all` |

---

## What each piece does

| Component | Port | What it does |
|-----------|------|-------------|
| Next.js dashboard | 3000 | The website — login, widgets, chat UI |
| MCC Bridge | 8081 | Translates API requests into OpenClaw CLI calls |
| OpenClaw | 8080 | Your AI agents |
| Caddy | 443 | HTTPS termination + free SSL cert renewal |

# 🔧 OpenClaw Setup — Micro-Step Guide & Tunnel Troubleshooting

This guide breaks every step into the **smallest possible pieces** so you can
follow along without getting stuck. If something goes wrong, each step has a
✅ **verify** checkpoint and a 🔥 **if it fails** section.

---

## Before You Start — What You Need

| # | Item | How to check |
|---|------|-------------|
| 1 | A VPS you can SSH into | `ssh your-user@your-vps-ip` — you get a shell prompt |
| 2 | OpenClaw installed on the VPS | `which openclaw` or `ls ~/.openclaw/` shows files |
| 3 | A Cloudflare account (free) | You can log in at [dash.cloudflare.com](https://dash.cloudflare.com) |
| 4 | A domain added to Cloudflare | The domain shows "Active" in your Cloudflare dashboard |
| 5 | Node.js 18+ on your computer | `node --version` prints `v18.x` or higher |

> **Don't have all of these yet?** Stop here and set them up first.
> The rest of the guide assumes all five are ready.

---

## Part A — Verify OpenClaw Is Running on Your VPS

### A1. SSH into your VPS

```bash
ssh your-user@your-vps-ip
```

✅ **Verify:** You see a shell prompt like `user@vps:~$`

🔥 **If it fails:**
- "Connection refused" → Your VPS might be off. Check your hosting provider dashboard.
- "Permission denied" → Wrong username or missing SSH key. Try `ssh -i /path/to/key user@ip`.
- "Connection timed out" → Wrong IP address, or your VPS firewall blocks port 22.

### A2. Check if OpenClaw is installed

```bash
ls ~/.openclaw/
```

✅ **Verify:** You see directories like `agents/`, `workspace/`, etc.

🔥 **If it fails:**
- "No such file or directory" → OpenClaw is not installed. Install it first following [OpenClaw docs](https://github.com/openclaw).

### A3. Check if OpenClaw is running

```bash
ps aux | grep openclaw
```

✅ **Verify:** You see a process line with `openclaw` in it (not just the `grep` line).

🔥 **If it fails (no process):**
- OpenClaw is not running. Start it with your usual start command.
- If you don't know the start command, try: `openclaw start` or check OpenClaw docs.

### A4. Find what port OpenClaw uses

```bash
netstat -tulpn 2>/dev/null | grep -E '8080|8000|3000|openclaw'
```

Or if `netstat` is not available:

```bash
ss -tulpn | grep -E '8080|8000|3000|openclaw'
```

✅ **Verify:** You see a line showing `LISTEN` on a port (commonly 8080).

📝 **Write down your port:** `________` (e.g., 8080)

🔥 **If you see nothing:**
- OpenClaw might use a different port. Check OpenClaw config files:
  ```bash
  cat ~/.openclaw/config.yml 2>/dev/null || cat ~/.openclaw/config.json 2>/dev/null
  ```
- Look for a `port` setting in the output.

### A5. Test OpenClaw locally on the VPS

```bash
curl http://localhost:8080/
```

Replace `8080` with whatever port you found in A4.

✅ **Verify:** You get ANY response (JSON, HTML, even an error page from OpenClaw). This means OpenClaw is listening.

🔥 **If it fails:**
- "Connection refused" → OpenClaw is not running, or it's on a different port. Go back to A3 and A4.
- "curl: command not found" → Install curl: `sudo apt install curl`

### A6. Test a chat endpoint (if available)

```bash
curl -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'
```

✅ **Verify:** You get a JSON response or a streaming response.

🔥 **If it fails:**
- "404 Not Found" → The endpoint path might be different. Try:
  ```bash
  curl http://localhost:8080/health
  curl http://localhost:8080/v1/chat/completions
  curl http://localhost:8080/chat/stream
  ```
- Note which endpoint works — you'll need this later.

📝 **Write down your working endpoint path:** `________`

---

## Part B — Install Cloudflare Tunnel on Your VPS

### B1. Download `cloudflared`

**Still on your VPS (via SSH):**

For Debian/Ubuntu:
```bash
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
```

✅ **Verify:** The file downloads. You see `cloudflared-linux-amd64.deb` when you run `ls`.

🔥 **If it fails:**
- "wget: command not found" → Use curl instead:
  ```bash
  curl -LO https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  ```
- "Could not resolve host" → Your VPS has no internet. Check DNS: `ping 8.8.8.8`

### B2. Install `cloudflared`

```bash
sudo dpkg -i cloudflared-linux-amd64.deb
```

For RedHat/CentOS, download and install the RPM instead:
```bash
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm
sudo rpm -i cloudflared-linux-x86_64.rpm
```

✅ **Verify:**
```bash
cloudflared --version
```
You see something like `cloudflared version 2024.x.x`

🔥 **If it fails:**
- "dpkg: error" → You might be on CentOS/RedHat. Use the RPM method above.
- "Permission denied" → You need `sudo`. Make sure you're using `sudo dpkg ...`.

### B3. Log in to Cloudflare

```bash
cloudflared tunnel login
```

This prints a URL. **Copy that URL and paste it into your browser** (on your computer, not the VPS).

✅ **Verify:** After clicking "Authorize" in the browser, your VPS terminal says `You have successfully logged in.`

🔥 **If it fails:**
- "Could not open browser" → **This is normal on a VPS.** Copy the URL manually and paste it in your browser.
- The URL expired → Run `cloudflared tunnel login` again. You have a few minutes to authorize.
- Browser says "Something went wrong" → Make sure you select the correct domain when authorizing.

### B4. Verify the login created a certificate

```bash
ls ~/.cloudflared/cert.pem
```

✅ **Verify:** The file exists. No error.

🔥 **If it fails:**
- "No such file" → The login didn't complete. Run `cloudflared tunnel login` again.
- Check if the file is somewhere else: `find / -name cert.pem 2>/dev/null`

---

## Part C — Create the Tunnel

### C1. Create a named tunnel

```bash
cloudflared tunnel create mcc-agents
```

✅ **Verify:** You see output like:
```
Created tunnel mcc-agents with id 12345678-1234-1234-1234-123456789abc
```

📝 **Write down your Tunnel ID:** `________________________________________`

🔥 **If it fails:**
- "tunnel with name mcc-agents already exists" → You already created it before. Find the ID:
  ```bash
  cloudflared tunnel list
  ```
  Use the ID shown for `mcc-agents`. If you want to start fresh:
  ```bash
  cloudflared tunnel delete mcc-agents
  cloudflared tunnel create mcc-agents
  ```
- "failed to authenticate" → Run `cloudflared tunnel login` again (Part B3).

### C2. Verify the tunnel credentials file was created

```bash
ls ~/.cloudflared/*.json
```

✅ **Verify:** You see a file like `~/.cloudflared/12345678-1234-1234-1234-123456789abc.json`

🔥 **If it fails:**
- "No such file" → The tunnel creation failed silently. Run `cloudflared tunnel create mcc-agents` again.

### C3. Choose your API subdomain

Pick one of these (replace `yourdomain.com` with your actual domain):
- `api.yourdomain.com` ← recommended
- `agents.yourdomain.com`
- `openclaw.yourdomain.com`

📝 **Write down your chosen subdomain:** `________________________________________`

### C4. Route your subdomain to the tunnel

```bash
cloudflared tunnel route dns mcc-agents api.yourdomain.com
```

Replace `api.yourdomain.com` with your chosen subdomain from C3.

✅ **Verify:** You see:
```
Successfully created route for api.yourdomain.com
```

🔥 **If it fails:**
- "DNS record already exists" → The route was created before. This is fine, continue to C5.
- "zone not found" → Your domain is not in Cloudflare. Go to Cloudflare dashboard → "Add a site" → add your domain → update nameservers at your registrar.

### C5. Verify the DNS record was created

Go to your **Cloudflare dashboard** → select your domain → **DNS** tab.

✅ **Verify:** You see a CNAME record for `api` (or your chosen subdomain) pointing to a `.cfargotunnel.com` address.

---

## Part D — Configure the Tunnel

### D1. Find your username on the VPS

```bash
whoami
```

📝 **Write down your username:** `________` (e.g., `ubuntu`, `root`, `deploy`)

### D2. Create the tunnel config file

```bash
nano ~/.cloudflared/config.yml
```

### D3. Paste this configuration

Replace **three things** in the template below:
1. `YOUR_TUNNEL_ID` → the ID from step C1
2. `YOUR_USERNAME` → the username from step D1
3. `api.yourdomain.com` → the subdomain from step C3
4. `8080` → the port from step A4

```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /home/YOUR_USERNAME/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:8080
    originRequest:
      noTLSVerify: true
      connectTimeout: 60s
  - service: http_status:404
```

**Example** (with real-looking values):
```yaml
tunnel: a1b2c3d4-e5f6-7890-abcd-ef1234567890
credentials-file: /home/ubuntu/.cloudflared/a1b2c3d4-e5f6-7890-abcd-ef1234567890.json

ingress:
  - hostname: api.mysite.com
    service: http://localhost:8080
    originRequest:
      noTLSVerify: true
      connectTimeout: 60s
  - service: http_status:404
```

### D4. Save the file

- Press `Ctrl+X`
- Press `Y` (to confirm save)
- Press `Enter` (to keep the filename)

### D5. Verify the config file looks right

```bash
cat ~/.cloudflared/config.yml
```

✅ **Verify:** You see your tunnel ID, your username, your subdomain, and your port. No placeholder text remains.

🔥 **Common mistakes:**
- Wrong tunnel ID → Compare with `cloudflared tunnel list` output
- Wrong username → Compare with `whoami` output
- Wrong path to credentials file → Run `ls ~/.cloudflared/*.json` and make sure the filename matches
- Extra spaces or wrong YAML indentation → Every line under `originRequest:` must be indented with spaces (not tabs)

### D6. Validate the config

```bash
cloudflared tunnel ingress validate
```

✅ **Verify:** You see `OK` and no errors.

🔥 **If it fails:**
- "no ingress rules" → Your config file has a YAML formatting issue. Check indentation (use spaces, not tabs).
- "credentials file does not exist" → The path in `credentials-file` is wrong. Check it with `ls -la ~/.cloudflared/*.json`.

---

## Part E — Test the Tunnel

### E1. Make sure OpenClaw is still running

```bash
curl http://localhost:8080/
```

✅ **Verify:** You get a response (any response).

🔥 **If it fails:** Go back to Part A and start OpenClaw again.

### E2. Start the tunnel in test mode

```bash
cloudflared tunnel run mcc-agents
```

**Leave this running.** Don't press Ctrl+C yet.

✅ **Verify:** You see lines like:
```
INF Starting tunnel tunnelID=...
INF Connection registered connIndex=0
INF Connection registered connIndex=1
INF Connection registered connIndex=2
INF Connection registered connIndex=3
```

🔥 **If it fails:**
- "tunnel credentials file not found" → Check `credentials-file` path in config. See D5.
- "failed to connect" → Check your internet: `ping 1.1.1.1`
- "context deadline exceeded" → Your VPS can't reach Cloudflare. Check firewall rules — cloudflared needs outbound HTTPS (port 443). Run:
  ```bash
  sudo iptables -L -n | grep 443
  ```
  If blocked, allow it:
  ```bash
  sudo iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT
  ```
- Only 1 or 2 connections registered (not 4) → This is usually fine. It will work with even 1 connection.

### E3. Test from your computer (not the VPS)

Open a **new terminal on your computer** (not the VPS) and run:

```bash
curl https://api.yourdomain.com/
```

Replace `api.yourdomain.com` with your actual subdomain.

✅ **Verify:** You get a response from OpenClaw (same as when you tested locally in step A5).

🔥 **If it fails — TUNNEL TROUBLESHOOTING:**

#### Error: "Could not resolve host"
**Meaning:** DNS is not set up.
**Fix:**
1. Check DNS in Cloudflare dashboard (should have a CNAME for your subdomain)
2. Wait 5 minutes for DNS propagation
3. Try again: `nslookup api.yourdomain.com`
4. If `nslookup` returns nothing, the DNS record is missing → go back to step C4

#### Error: "Connection refused" or "Connection reset"
**Meaning:** The tunnel is not running, or DNS points to the wrong place.
**Fix:**
1. Make sure `cloudflared tunnel run mcc-agents` is still running on the VPS
2. Check for errors in the tunnel terminal output
3. Verify DNS: `nslookup api.yourdomain.com` should show a Cloudflare IP

#### Error: "502 Bad Gateway"
**Meaning:** The tunnel is working, but it can't reach OpenClaw on the VPS.
**Fix:**
1. Check OpenClaw is running: `curl http://localhost:8080/` (on VPS)
2. Check the port in your config matches OpenClaw's port:
   ```bash
   grep 'service:' ~/.cloudflared/config.yml
   ```
3. If OpenClaw is on port 3000 but config says 8080, fix the config and restart the tunnel

#### Error: "403 Forbidden"
**Meaning:** Cloudflare is blocking the request.
**Fix:**
1. Check Cloudflare dashboard → Security → WAF rules — disable any that block your subdomain
2. Make sure your domain's SSL/TLS mode is set to "Full" (not "Flexible")

#### Error: "504 Gateway Timeout"
**Meaning:** The tunnel reaches OpenClaw but OpenClaw takes too long to respond.
**Fix:**
1. Increase `connectTimeout` in your config to `120s`
2. Check if OpenClaw is overloaded: `top` or `htop` on the VPS
3. Restart OpenClaw

#### Error: Empty response or HTML error page from Cloudflare
**Meaning:** Various — need more diagnostics.
**Fix:**
1. Check tunnel logs for errors:
   ```bash
   # In the terminal running the tunnel, look for ERR or error lines
   ```
2. Test locally first: `curl http://localhost:8080/` on the VPS
3. If local works but tunnel doesn't, check config hostname matches your actual subdomain

### E4. Stop the test tunnel

Once the test in E3 works, go back to the VPS terminal running the tunnel and press **Ctrl+C**.

---

## Part F — Make the Tunnel Permanent

### F1. Install tunnel as a system service

```bash
sudo cloudflared service install
```

✅ **Verify:** You see `Service installed successfully` or similar.

🔥 **If it fails:**
- "service already exists" → It was installed before. Skip to F2.
- "config.yml not found" → cloudflared expects the config at `/etc/cloudflared/config.yml` for root or `~/.cloudflared/config.yml` for your user. Copy it:
  ```bash
  sudo mkdir -p /etc/cloudflared
  sudo cp ~/.cloudflared/config.yml /etc/cloudflared/config.yml
  sudo cp ~/.cloudflared/*.json /etc/cloudflared/
  ```
  Then update the `credentials-file` path in `/etc/cloudflared/config.yml` to point to `/etc/cloudflared/YOUR_TUNNEL_ID.json`.

### F2. Start the service

```bash
sudo systemctl start cloudflared
```

### F3. Enable auto-start on boot

```bash
sudo systemctl enable cloudflared
```

### F4. Verify the service is running

```bash
sudo systemctl status cloudflared
```

✅ **Verify:** You see `Active: active (running)`

🔥 **If it fails:**
- "Active: failed" → Check logs:
  ```bash
  sudo journalctl -u cloudflared -n 50 --no-pager
  ```
  Look for error messages. Common fixes:
  - Wrong credentials path → Update `/etc/cloudflared/config.yml`
  - Permission denied on credentials file → `sudo chmod 644 /etc/cloudflared/*.json`

### F5. Final test from your computer

```bash
curl https://api.yourdomain.com/
```

✅ **Verify:** Same response as step E3. The tunnel works as a background service.

---

## Part G — Connect the Dashboard

### G1. Set environment variables in Cloudflare Pages

Go to **Cloudflare Dashboard → Pages → your project → Settings → Environment Variables**.

Add these variables (replace `api.yourdomain.com` with your actual subdomain):

| Variable | Value |
|---|---|
| `MCC_PASSWORD` | Your dashboard login password |
| `MCC_VPS_SSE_URL` | `https://api.yourdomain.com/chat/stream` |
| `MCC_VPS_CONNECT_URL` | `https://api.yourdomain.com/agents/connect` |
| `MCC_VPS_HEARTBEAT_URL` | `https://api.yourdomain.com/agents/heartbeat` |
| `MCC_VPS_SCAN_URL` | `https://api.yourdomain.com/agents/scan` |
| `MCC_RUNNER_TOKEN` | A random secret string (e.g., run `openssl rand -hex 32` to generate one) |

### G2. Trigger a redeploy

In Cloudflare Pages → your project → **Deployments** → click **"Retry deployment"** on the latest deployment.

Or if you set up GitHub auto-deploy, push any change:
```bash
git commit --allow-empty -m "trigger redeploy"
git push
```

### G3. Test the dashboard

1. Open your dashboard URL in your browser
2. Log in with your password
3. Click any agent (e.g., 🏀 Sports Analyst)
4. Type a message and send it

✅ **Verify:** You get a real response from OpenClaw (not demo text).

🔥 **If agents show "MCC_VPS_SSE_URL missing":**
- The environment variables weren't saved. Go back to G1 and double-check.
- Make sure you redeployed after adding the variables.

🔥 **If you get "Failed to connect to AI agents":**
- Test the tunnel from your computer: `curl https://api.yourdomain.com/`
- If the tunnel test works but the dashboard doesn't, check that the env variable URLs are correct (no trailing slash, correct subdomain).

🔥 **If agents show as disconnected (gray dots):**
- The VPS bridge or OpenClaw might not implement the `/agents/connect` endpoint.
- See the [AGENTS_QUICKSTART.md](web/AGENTS_QUICKSTART.md) for the bridge server that implements all required endpoints.

---

## Part H — For Local Development

If you want to test locally before deploying:

### H1. Edit your `.env.local` file

```bash
cd my-control-center/web
nano .env.local
```

Add:
```bash
MCC_PASSWORD=your-password
MCC_VPS_SSE_URL=https://api.yourdomain.com/chat/stream
MCC_VPS_CONNECT_URL=https://api.yourdomain.com/agents/connect
MCC_VPS_HEARTBEAT_URL=https://api.yourdomain.com/agents/heartbeat
MCC_VPS_SCAN_URL=https://api.yourdomain.com/agents/scan
MCC_RUNNER_TOKEN=your-runner-token
```

### H2. Run the dev server

```bash
npm run dev
```

### H3. Open http://localhost:3000

✅ **Verify:** Agents show green dots and chat works.

---

## Quick Diagnostic Cheat Sheet

Run these commands **on your VPS** whenever something breaks:

```bash
# 1. Is OpenClaw running?
ps aux | grep openclaw

# 2. Can I reach OpenClaw locally?
curl http://localhost:8080/

# 3. Is the tunnel service running?
sudo systemctl status cloudflared

# 4. What do the tunnel logs say?
sudo journalctl -u cloudflared -n 30 --no-pager

# 5. Is the tunnel config valid?
cloudflared tunnel ingress validate

# 6. What tunnels exist?
cloudflared tunnel list

# 7. Can the VPS reach the internet?
ping -c 3 1.1.1.1

# 8. Is port 443 open outbound (needed for tunnel)?
curl -s https://cloudflare.com > /dev/null && echo "OK" || echo "BLOCKED"
```

Run this **from your computer** (not the VPS):

```bash
# 9. Does DNS resolve?
nslookup api.yourdomain.com

# 10. Does the tunnel respond?
curl -v https://api.yourdomain.com/ 2>&1 | head -30
```

---

## Common Scenarios & Fixes

### "It was working yesterday but stopped"

1. Check if the VPS rebooted: `uptime`
2. Check if cloudflared service is running: `sudo systemctl status cloudflared`
3. Check if OpenClaw is running: `ps aux | grep openclaw`
4. Restart both:
   ```bash
   # Restart OpenClaw (use your usual start command)
   # Then restart the tunnel:
   sudo systemctl restart cloudflared
   ```

### "I get responses locally but not through the tunnel"

1. The tunnel config port might be wrong:
   ```bash
   grep 'localhost' ~/.cloudflared/config.yml
   ```
   Compare with the port OpenClaw actually uses (from step A4).

2. If the ports don't match, fix the config and restart:
   ```bash
   nano ~/.cloudflared/config.yml
   # Fix the port number
   sudo systemctl restart cloudflared
   ```

### "The tunnel connects but I get 502 errors"

This means the tunnel works but can't reach your local service.

1. Verify OpenClaw is listening:
   ```bash
   ss -tlnp | grep 8080
   ```
2. If OpenClaw binds to `127.0.0.1:8080` — this is correct, the tunnel connects locally.
3. If OpenClaw is not listed, start it.
4. If OpenClaw is on a different port, update the tunnel config.

### "I changed my VPS or reinstalled"

Start over from Part B. You'll need to:
1. Reinstall cloudflared (B1-B2)
2. Log in again (B3)
3. The old tunnel still exists — either reuse it or delete and recreate (C1)
4. Copy your old config or create a new one (D2-D6)

### "I want to use a different domain"

1. Create a new DNS route:
   ```bash
   cloudflared tunnel route dns mcc-agents newsubdomain.newdomain.com
   ```
2. Update the hostname in `~/.cloudflared/config.yml`
3. Restart the tunnel: `sudo systemctl restart cloudflared`
4. Update environment variables in Cloudflare Pages (Part G1)

---

## Related Guides

- **[DEPLOY_TO_DOMAIN.md](DEPLOY_TO_DOMAIN.md)** — Full deployment guide
- **[web/CONNECTING_VPS_AGENTS.md](web/CONNECTING_VPS_AGENTS.md)** — VPS agent connection details
- **[web/AGENTS_QUICKSTART.md](web/AGENTS_QUICKSTART.md)** — Agent quickstart with bridge server code
- **[web/GETTING_STARTED.md](web/GETTING_STARTED.md)** — Getting started checklist

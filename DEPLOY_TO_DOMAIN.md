# 🚀 Deploy to Your Domain - Quick Guide

**You have a domain and want your dashboard live with working AI agents. This is the guide for you.**

Skip the local development - let's get you deployed in **30-45 minutes**.

## What You Need

- ✅ Your domain (you already have this!)
- ✅ SSH access to your VPS with OpenClaw agents
- ✅ Node.js 18+ on your computer (just for building)
- ✅ Git installed

## The Plan

1. Build the app on your computer (5 min)
2. Set up Cloudflare services (10 min)
3. Deploy to your domain (10 min)
4. Connect your VPS agents (15-20 min)
5. **Done!** Dashboard live with working AI

---

## Step 1: Build the App (5 minutes)

On your computer:

```bash
# Clone the repo
git clone https://github.com/casonas/my-control-center.git
cd my-control-center/web

# Install dependencies
npm install

# Build for production
npm run build
```

✅ You should see: `✓ Compiled successfully`

---

## Step 2: Set Up Cloudflare (10 minutes)

### A. Create Cloudflare Account & Add Domain

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign up (free)
2. Click "Add a site" and enter your domain: `yourdomain.com`
3. Choose the **Free** plan
4. Update your domain's nameservers (at your domain registrar):
   - Cloudflare will show you 2 nameservers like:
     - `bob.ns.cloudflare.com`
     - `jane.ns.cloudflare.com`
   - Copy these to your domain registrar's settings
   - Wait 5-10 minutes for DNS to update

### B. Install Wrangler CLI

```bash
npm install -g wrangler
wrangler login
```

This opens a browser - click "Allow" to authenticate.

### C. Create Cloudflare Services

Still in the `my-control-center/web` directory:

```bash
# Create database
wrangler d1 create mcc-store

# IMPORTANT: Copy the database_id from output
# Paste it into web/wrangler.toml under [[d1_databases]]

# Create cache storage
wrangler kv namespace create CACHE

# IMPORTANT: Copy the id from output
# Paste it into web/wrangler.toml under [[kv_namespaces]]

# Create file storage
wrangler r2 bucket create mcc-files
```

### D. Update wrangler.toml

Edit `web/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "mcc-store"
database_id = "paste-your-database-id-here"  # ← Paste from above

[[kv_namespaces]]
binding = "CACHE"
id = "paste-your-kv-id-here"  # ← Paste from above
```

### E. Initialize Database

```bash
wrangler d1 execute mcc-store --file=./cloudflare/d1-schema.sql
```

✅ You should see: `🌀 Executed X commands in Y.Zs`

---

## Step 3: Deploy to Your Domain (10 minutes)

### Option A: Deploy via GitHub (Recommended)

1. **Push to GitHub** (if not already):
   ```bash
   git add .
   git commit -m "Ready for deployment"
   git push origin main
   ```

2. **Connect to Cloudflare Pages**:
   - Go to [dash.cloudflare.com](https://dash.cloudflare.com)
   - Click "Workers & Pages" → "Create application"
   - Click "Pages" → "Connect to Git"
   - Select your GitHub repo
   - Click "Begin setup"

3. **Configure build**:
   ```
   Framework preset: Next.js
   Build command: npm run build
   Build output directory: .next
   Root directory: web
   ```

4. **Set environment variables** (click "Add variable"):
   ```
   MCC_PASSWORD = your-secure-password-here
   NEXT_PUBLIC_API_BASE = /api
   ```
   (We'll update this to your VPS URL in Step 4)

5. **Click "Save and Deploy"**

Wait 2-3 minutes for the build to complete.

### Option B: Deploy via CLI

```bash
# From web directory
npx wrangler pages deploy .next --project-name=my-control-center
```

Then go to Cloudflare Dashboard → Pages → your project → Settings → Environment Variables and add:
- `MCC_PASSWORD`
- `NEXT_PUBLIC_API_BASE`

### Add Your Custom Domain

1. In Cloudflare Pages → Your Project → Custom domains
2. Click "Set up a custom domain"
3. Enter `yourdomain.com` or `app.yourdomain.com`
4. Click "Activate domain"

✅ Your dashboard is now live at `https://yourdomain.com`!

**Test it:** Visit your domain and login with your password. Agents will show demo responses for now.

---

## Step 4: Connect Your VPS Agents (15-20 minutes)

Now let's connect your OpenClaw agents running on your VPS.

**📖 Full detailed guide:** [CONNECTING_VPS_AGENTS.md](CONNECTING_VPS_AGENTS.md)

**Quick version:**

### A. Check OpenClaw on VPS

SSH into your VPS:

```bash
ssh your-username@your-vps-ip

# Check OpenClaw is running
ps aux | grep openclaw

# Check what port it's on
netstat -tulpn | grep openclaw
# Or: netstat -tulpn | grep 8080

# Test it locally
curl http://localhost:8080/health
# (Use whatever port/endpoint OpenClaw has)
```

✏️ **Note your OpenClaw port:** `_________` (e.g., 8080)

### B. Install Cloudflare Tunnel on VPS

On your VPS:

```bash
# Download cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb

# Install
sudo dpkg -i cloudflared-linux-amd64.deb

# Verify
cloudflared --version
```

### C. Set Up Tunnel

```bash
# Login to Cloudflare (opens browser)
cloudflared tunnel login
# Copy the URL, paste in browser, authorize

# Create tunnel
cloudflared tunnel create mcc-agents
# ✏️ SAVE THE TUNNEL ID shown in output

# Route subdomain (choose one):
# Option 1: api.yourdomain.com
cloudflared tunnel route dns mcc-agents api.yourdomain.com

# Option 2: agents.yourdomain.com
cloudflared tunnel route dns mcc-agents agents.yourdomain.com
```

✏️ **Your API subdomain:** `_________________________`

### D. Configure Tunnel

Create config file:

```bash
nano ~/.cloudflared/config.yml
```

Paste (replace with your values):

```yaml
tunnel: YOUR_TUNNEL_ID_HERE
credentials-file: /home/YOUR_USERNAME/.cloudflared/YOUR_TUNNEL_ID_HERE.json

ingress:
  - hostname: api.yourdomain.com  # Your API subdomain
    service: http://localhost:8080  # Your OpenClaw port
    originRequest:
      noTLSVerify: true
      connectTimeout: 30s
  - service: http_status:404
```

Save: `Ctrl+X`, `Y`, `Enter`

### E. Test Tunnel

```bash
# Run in foreground to test
cloudflared tunnel run mcc-agents
```

Should see: `INF Connection registered`

**In another terminal** (from your computer):

```bash
curl https://api.yourdomain.com/
# Should get response from OpenClaw
```

If it works, **Ctrl+C** to stop the test tunnel.

### F. Run as Service

```bash
# Install as system service
sudo cloudflared service install

# Start service
sudo systemctl start cloudflared
sudo systemctl enable cloudflared

# Verify
sudo systemctl status cloudflared
# Should show: Active: active (running)
```

### G. Update Dashboard

Go to Cloudflare Dashboard → Pages → Your Project → Settings → Environment Variables:

**Edit** `NEXT_PUBLIC_API_BASE`:
```
https://api.yourdomain.com
```
(Use your actual API subdomain, NO trailing slash)

Click "Save" → "Redeploy site"

### H. Update Chat API Code

The dashboard needs to proxy requests to your VPS. 

**Edit `web/app/api/chat/stream/route.ts`:**

Replace the entire contents with:

```typescript
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { message, agentId, conversationId } = body;

    // Get API base from environment
    const apiBase = process.env.NEXT_PUBLIC_API_BASE || 'https://api.yourdomain.com';

    // Proxy to OpenClaw on your VPS
    const response = await fetch(`${apiBase}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Add auth if OpenClaw needs it:
        // 'Authorization': `Bearer ${process.env.OPENCLAW_API_KEY}`,
      },
      body: JSON.stringify({
        message,
        agent: agentId,
        conversation_id: conversationId,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenClaw API error: ${response.status}`);
    }

    // Stream response back to dashboard
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat stream error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to connect to AI agents' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
```

**Commit and push:**

```bash
git add .
git commit -m "Connect to VPS agents"
git push
```

Cloudflare will automatically redeploy (if you used GitHub method).

---

## Step 5: Test Everything! 🎉

1. **Open your dashboard** at `https://yourdomain.com`
2. **Login** with your password
3. **Click any agent tab** (School, Jobs, Skills, etc.)
4. **Send a message** to the agent
5. **You should get a REAL response** from your OpenClaw VPS!

✅ **Success!** Your dashboard is live on your domain with working AI agents.

---

## Troubleshooting

### Can't login
- Check `MCC_PASSWORD` is set in Cloudflare Pages environment variables
- Clear browser cookies and try again

### Agents still show demo text
- Check `NEXT_PUBLIC_API_BASE` is set to `https://api.yourdomain.com`
- Check tunnel is running: `sudo systemctl status cloudflared` (on VPS)
- Check you committed and pushed the chat route code changes

### "Failed to connect to AI agents"
- Check tunnel logs: `sudo journalctl -u cloudflared -f` (on VPS)
- Test tunnel: `curl https://api.yourdomain.com/` (should get OpenClaw response)
- Check OpenClaw is running: `ps aux | grep openclaw` (on VPS)

### 502 Bad Gateway
- Check port in tunnel config matches OpenClaw port
- Restart tunnel: `sudo systemctl restart cloudflared`

### Need more help?
- See [CONNECTING_VPS_AGENTS.md](CONNECTING_VPS_AGENTS.md) for detailed troubleshooting
- Check Cloudflare Pages logs in dashboard
- Check tunnel logs: `sudo journalctl -u cloudflared -f`

---

## What's Next?

Your dashboard is live! Now you can:

- **Customize agents** - Edit `web/app/api/agents/route.ts`
- **Add more features** - See [BLUEPRINT.md](../BLUEPRINT.md) for ideas
- **Set up cron jobs** - Fetch job postings, news, sports scores automatically
- **Add custom styling** - Edit `web/app/globals.css`
- **Backup your data** - `wrangler d1 export mcc-store`

Enjoy your personal AI-powered control center! 🚀

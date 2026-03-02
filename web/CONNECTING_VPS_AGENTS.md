# 🔌 Connecting Your OpenClaw VPS Agents

This guide provides **very specific** step-by-step instructions for connecting your OpenClaw agents running on a VPS to your My Control Center dashboard.

## Prerequisites

- ✅ You have SSH access to your VPS (e.g., `ssh user@your-vps-ip`)
- ✅ OpenClaw agents are running on your VPS (on a specific port, e.g., 8080)
- ✅ You have deployed or can deploy your dashboard to Cloudflare Pages
- ✅ You have a Cloudflare account

## Overview

```
Your Browser → Cloudflare Pages (Dashboard) → Cloudflare Tunnel → Your VPS (OpenClaw)
```

The Cloudflare Tunnel creates a secure connection from Cloudflare to your VPS without opening any firewall ports.

---

## Step 1: Check Your OpenClaw Setup on VPS

First, SSH into your VPS and verify OpenClaw is running:

```bash
# SSH into your VPS
ssh your-username@your-vps-ip

# Check if OpenClaw is running (adjust the command based on how you run OpenClaw)
ps aux | grep openclaw

# Or check if the port is open (replace 8080 with your actual port)
netstat -tulpn | grep 8080

# Test locally on the VPS
curl http://localhost:8080/health
# Or whatever endpoint OpenClaw uses
```

**Note down:**
- ✏️ The port OpenClaw is running on: `_____________` (e.g., 8080)
- ✏️ The API endpoint path: `_____________` (e.g., `/api/chat` or `/v1/chat/completions`)
- ✏️ Any authentication required: `_____________` (e.g., API key header)

---

## Step 2: Install Cloudflare Tunnel on Your VPS

**On your VPS** (via SSH), install `cloudflared`:

### For Debian/Ubuntu:
```bash
# Download the latest cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb

# Install it
sudo dpkg -i cloudflared-linux-amd64.deb

# Verify installation
cloudflared --version
```

### For RedHat/CentOS:
```bash
# Download the latest cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm

# Install it
sudo rpm -i cloudflared-linux-x86_64.rpm

# Verify installation
cloudflared --version
```

### For other systems:
See: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/

---

## Step 3: Authenticate Cloudflare Tunnel

**On your VPS**, authenticate with Cloudflare:

```bash
cloudflared tunnel login
```

This will:
1. Print a URL in your terminal
2. Copy that URL and paste it in your browser
3. Login to Cloudflare
4. Select the domain you want to use
5. Authorize the tunnel

You should see: `You have successfully logged in.`

**Verify authentication:**
```bash
ls ~/.cloudflared/
# Should show: cert.pem
```

---

## Step 4: Create the Tunnel

**On your VPS**, create a named tunnel:

```bash
cloudflared tunnel create mcc-agents
```

**Important:** Note down the Tunnel ID from the output. It looks like:
```
Created tunnel mcc-agents with id 12345678-1234-1234-1234-123456789abc
```

✏️ **Write down your Tunnel ID:** `_________________________________`

**Verify the tunnel was created:**
```bash
cloudflared tunnel list
# Should show your tunnel: mcc-agents

ls ~/.cloudflared/
# Should now show: cert.pem  12345678-1234-1234-1234-123456789abc.json
```

---

## Step 5: Route a Subdomain to the Tunnel

Decide on a subdomain for your API. Examples:
- `api.yourdomain.com`
- `agents.yourdomain.com`
- `openclaw.yourdomain.com`

✏️ **Your chosen subdomain:** `_________________________________`

**On your VPS**, route the subdomain to your tunnel:

```bash
# Replace with your actual subdomain and tunnel name
cloudflared tunnel route dns mcc-agents api.yourdomain.com
```

You should see:
```
Successfully created route for api.yourdomain.com
```

**Verify the route:**
```bash
cloudflared tunnel route dns list
```

---

## Step 6: Create Tunnel Configuration File

**On your VPS**, create the tunnel config file:

```bash
nano ~/.cloudflared/config.yml
```

**Paste this configuration** (replace the values with your actual values):

```yaml
# Replace TUNNEL_ID with the ID from Step 4
tunnel: TUNNEL_ID_HERE

# This should match the .json file in ~/.cloudflared/
credentials-file: /home/YOUR_USERNAME/.cloudflared/TUNNEL_ID_HERE.json

# Configure what the tunnel connects to
ingress:
  # Replace with your actual subdomain and OpenClaw port
  - hostname: api.yourdomain.com
    service: http://localhost:8080
    # Add these if OpenClaw is slow to respond:
    originRequest:
      noTLSVerify: true
      connectTimeout: 30s
      
  # Catch-all rule (required)
  - service: http_status:404
```

**Specific example** (adjust for your setup):
```yaml
tunnel: 12345678-1234-1234-1234-123456789abc
credentials-file: /home/ubuntu/.cloudflared/12345678-1234-1234-1234-123456789abc.json

ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:8080
    originRequest:
      noTLSVerify: true
      connectTimeout: 30s
  - service: http_status:404
```

**Save the file:**
- Press `Ctrl+X`
- Press `Y` to confirm
- Press `Enter` to save

**Verify your config:**
```bash
cat ~/.cloudflared/config.yml
```

---

## Step 7: Test the Tunnel

**On your VPS**, run the tunnel in the foreground first to test:

```bash
cloudflared tunnel run mcc-agents
```

You should see:
```
INF Starting tunnel tunnelID=...
INF Connection registered connIndex=0
INF Connection registered connIndex=1
INF Connection registered connIndex=2
INF Connection registered connIndex=3
```

**Leave this running** and open a new terminal/SSH session.

---

## Step 8: Test the Connection

**From your local computer** (not the VPS), test the tunnel:

```bash
# Replace with your actual subdomain
curl https://api.yourdomain.com/

# Or if OpenClaw has a health endpoint:
curl https://api.yourdomain.com/health

# Or test the chat endpoint:
curl -X POST https://api.yourdomain.com/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'
```

**Expected result:**
- ✅ You get a response from OpenClaw (not a 404 or connection error)
- ✅ The tunnel terminal shows the request being processed

**If you get errors:**
- 🔍 Check that OpenClaw is actually running on port 8080
- 🔍 Check the tunnel config has the correct port
- 🔍 Check the tunnel logs for error messages
- 🔍 Try `curl http://localhost:8080` on the VPS to verify OpenClaw works locally

---

## Step 9: Make the Tunnel Run Automatically

Once the tunnel works, make it run as a service so it survives reboots.

**On your VPS**, stop the test tunnel (Ctrl+C), then install it as a service:

```bash
sudo cloudflared service install
```

**Start the service:**
```bash
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

**Verify it's running:**
```bash
sudo systemctl status cloudflared
```

You should see: `Active: active (running)`

**Check logs if needed:**
```bash
sudo journalctl -u cloudflared -f
```

---

## Step 10: Update Dashboard to Use Your VPS Agents

Now update your My Control Center dashboard to use your VPS agents.

### Option A: Environment Variable (Recommended)

**In your Cloudflare Pages dashboard:**

1. Go to Cloudflare Dashboard → Pages → your-project → Settings → Environment variables
2. Add/edit:
   ```
   NEXT_PUBLIC_API_BASE=https://api.yourdomain.com
   ```
3. Save and redeploy

### Option B: Update Code Directly

**Edit `web/app/api/chat/stream/route.ts`:**

Replace the demo stream code with a proxy to your VPS:

```typescript
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { message, agentId, conversationId } = body;

    // Proxy to your OpenClaw VPS
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE || 'https://api.yourdomain.com'}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Add any auth headers OpenClaw needs
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

    // Stream the response from OpenClaw
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

**Save and deploy:**
```bash
git add .
git commit -m "Connect to OpenClaw VPS agents"
git push
```

---

## Step 11: Test the Full Integration

1. **Open your dashboard** at `https://your-site.pages.dev`
2. **Login** with your password
3. **Open any agent tab** (e.g., School, Jobs, Skills)
4. **Type a message** to the agent
5. **You should see** a real response from OpenClaw (not the demo text)

**Check logs if it doesn't work:**

On your VPS:
```bash
# Check tunnel logs
sudo journalctl -u cloudflared -f

# Check OpenClaw logs (adjust command based on your setup)
tail -f /path/to/openclaw/logs/openclaw.log
```

In Cloudflare Pages:
- Dashboard → Pages → your-project → Deployments → View logs

---

## Troubleshooting

### Tunnel shows "connection registered" but requests fail

**Check OpenClaw is actually listening:**
```bash
# On VPS
curl http://localhost:8080/
```

If this fails, OpenClaw isn't running correctly. Check OpenClaw logs.

### "Bad Gateway" or 502 errors

**Check the port in your tunnel config:**
```bash
cat ~/.cloudflared/config.yml
```

Make sure the port matches where OpenClaw is running.

### Requests timeout

**Increase timeout in tunnel config:**
```yaml
ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:8080
    originRequest:
      connectTimeout: 60s
      noTLSVerify: true
```

Then restart the tunnel:
```bash
sudo systemctl restart cloudflared
```

### Dashboard shows "Failed to connect to AI agents"

**Check NEXT_PUBLIC_API_BASE is set correctly:**
- In Cloudflare Pages → Settings → Environment Variables
- Should be: `https://api.yourdomain.com` (no trailing slash)
- Redeploy after changing

**Check CORS headers** on OpenClaw:
OpenClaw might need to allow requests from your dashboard domain.

### Can't SSH into VPS

That's outside the scope of this guide, but basics:
```bash
ssh -i /path/to/private-key user@vps-ip
```

---

## Quick Reference

**Start tunnel manually:**
```bash
cloudflared tunnel run mcc-agents
```

**Stop tunnel service:**
```bash
sudo systemctl stop cloudflared
```

**Restart tunnel service:**
```bash
sudo systemctl restart cloudflared
```

**Check tunnel status:**
```bash
sudo systemctl status cloudflared
```

**View tunnel logs:**
```bash
sudo journalctl -u cloudflared -f
```

**List all tunnels:**
```bash
cloudflared tunnel list
```

**Delete a tunnel:**
```bash
cloudflared tunnel delete mcc-agents
```

---

## What OpenClaw API Format Is Expected?

The dashboard expects OpenClaw to have an endpoint like:

**Request:**
```
POST /api/chat
Content-Type: application/json

{
  "message": "User's question here",
  "agent": "school-agent",
  "conversation_id": "conv-123"
}
```

**Response (streaming):**
```
Content-Type: text/event-stream

event: delta
data: {"text": "Hello "}

event: delta
data: {"text": "there!"}

event: done
data: {}
```

**If your OpenClaw uses a different format:**

You'll need to adjust the code in `web/app/api/chat/stream/route.ts` to transform:
- The request format (what you send to OpenClaw)
- The response format (what OpenClaw sends back)

Let me know your OpenClaw's exact API format and I can help adjust the code!

---

## Security Notes

- 🔒 The tunnel is encrypted end-to-end
- 🔒 No firewall ports need to be opened on your VPS
- 🔒 Consider adding API key authentication between dashboard and OpenClaw
- 🔒 Don't commit API keys to git - use environment variables

---

## Next Steps

Once this works:

1. **Add authentication** between dashboard and OpenClaw (API keys)
2. **Monitor usage** via Cloudflare Analytics
3. **Set up logging** to track agent conversations
4. **Add rate limiting** to prevent abuse
5. **Configure different agents** for different tasks

---

**Need help?**
- See [OPENCLAW_SETUP_GUIDE.md](../OPENCLAW_SETUP_GUIDE.md) for micro-step troubleshooting with verify/fix for every step
- Open an issue on GitHub with:
  - Your tunnel config (remove sensitive IDs)
  - Cloudflared logs: `sudo journalctl -u cloudflared -n 50`
  - OpenClaw logs (if accessible)
  - The exact error message you're seeing

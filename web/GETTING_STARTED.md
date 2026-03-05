# 🚀 Getting Started Checklist

Follow this checklist to get My Control Center running on your domain with AI agents.

## 🏃 Super Quick Start (Automated)

If you want the fastest setup, use the automated script:

```bash
cd my-control-center/web
./quickstart.sh
```

This script will:
- ✅ Check Node.js version
- ✅ Install dependencies
- ✅ Create `.env.local` file
- ✅ Build the app to verify it works
- ✅ Show you the next steps

Then just run `npm run dev` and you're ready to go!

**Or follow the detailed checklist below for manual setup:**

---

## ✅ Phase 1: Local Setup (5 minutes)

- [ ] **Install Node.js 18+** - Download from [nodejs.org](https://nodejs.org)
- [ ] **Clone the repository**
  ```bash
  git clone https://github.com/casonas/my-control-center.git
  cd my-control-center/web
  ```
- [ ] **Install dependencies**
  ```bash
  npm install
  ```
- [ ] **Create environment file**
  ```bash
  cp .env.example .env.local
  ```
- [ ] **Edit `.env.local`** and set your password:
  ```
  MCC_PASSWORD=your-secure-password-here
  ```
- [ ] **Run the development server**
  ```bash
  npm run dev
  ```
- [ ] **Open http://localhost:3000** and login with your password
- [ ] ✨ **You should see your dashboard!** (Agents will show demo responses for now)

## ✅ Phase 2: Deploy to Cloudflare (15 minutes)

- [ ] **Create Cloudflare account** at [cloudflare.com](https://cloudflare.com) (free)
- [ ] **Install Wrangler CLI**
  ```bash
  npm install -g wrangler
  wrangler login
  ```
- [ ] **Create D1 database** (stores your data)
  ```bash
  wrangler d1 create mcc-store
  ```
  - [ ] Copy the `database_id` from output
  - [ ] Paste it into `wrangler.toml` under `[[d1_databases]]`

- [ ] **Create KV namespace** (for caching)
  ```bash
  wrangler kv namespace create CACHE
  ```
  - [ ] Copy the `id` from output
  - [ ] Paste it into `wrangler.toml` under `[[kv_namespaces]]`

- [ ] **Create R2 bucket** (for file storage)
  ```bash
  wrangler r2 bucket create mcc-files
  ```

- [ ] **Initialize database**
  ```bash
  wrangler d1 execute mcc-store --file=./cloudflare/d1-schema.sql
  ```

- [ ] **Deploy to Cloudflare Pages**
  
  **Option A: Via GitHub (Recommended)**
  - [ ] Push your code to GitHub
  - [ ] Go to Cloudflare Dashboard → Pages → Create application
  - [ ] Connect to Git → Select your repo
  - [ ] Set build settings:
    - Build command: `npm run build`
    - Build output: `.next`
    - Root directory: `web`
  - [ ] Add environment variables in Pages settings:
    ```
    MCC_PASSWORD=your-secure-password-here
    MCC_COOKIE_SIGNING_SECRET=generate-a-long-random-secret
    NEXT_PUBLIC_API_BASE=/api
    ```
  - [ ] Use the **same values** for both **Production** and **Preview** environments unless you intentionally want different login sessions per environment
  
  **Option B: Via CLI**
  - [ ] Build the app: `npm run build`
  - [ ] Deploy: `npx wrangler pages deploy .next --project-name=my-control-center`
  - [ ] Add environment variables via dashboard

- [ ] **Visit your site!** It should be at `https://my-control-center.pages.dev`
- [ ] ✨ **Your dashboard is now live on the internet!**

## ✅ Phase 3: Connect AI Agents (Choose One)

### Option A: Use OpenAI (Easiest - ~5 minutes)

- [ ] **Get OpenAI API key** from [platform.openai.com](https://platform.openai.com)
- [ ] **Add to Cloudflare Pages environment variables:**
  ```
  OPENAI_API_KEY=sk-...
  ```
- [ ] **Update `/app/api/chat/stream/route.ts`** to call OpenAI:
  ```typescript
  // Replace the demo stream with:
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    }),
  });
  ```
- [ ] **Redeploy** your app
- [ ] ✨ **Your agents now use real AI!**

### Option B: Use Cloudflare Workers AI (Free - ~10 minutes)

- [ ] **Update `/app/api/chat/stream/route.ts`** to use Workers AI:
  ```typescript
  const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
    messages: [{ role: "user", content: prompt }]
  });
  ```
- [ ] **Make sure** `wrangler.toml` has the `[ai]` binding (already configured)
- [ ] **Redeploy** your app
- [ ] ✨ **Your agents now use Cloudflare's free AI!**

### Option C: Self-Host with Your Own AI (Advanced - ~30 minutes)

**📖 For very detailed, specific instructions, see:** [CONNECTING_VPS_AGENTS.md](CONNECTING_VPS_AGENTS.md)

**Quick checklist:**

- [ ] **Have a VPS** with your AI service running (e.g., OpenClaw, Ollama, etc.)
  - [ ] Note the port it's running on (e.g., 8080)
  - [ ] Verify it works: `curl http://localhost:8080/health`

- [ ] **On your VPS** (via SSH), install Cloudflare Tunnel:
  ```bash
  wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  sudo dpkg -i cloudflared-linux-amd64.deb
  ```

- [ ] **Authenticate with Cloudflare:**
  ```bash
  cloudflared tunnel login
  ```

- [ ] **Create tunnel:**
  ```bash
  cloudflared tunnel create mcc-agents
  ```
  - [ ] Note the Tunnel ID from output

- [ ] **Route your subdomain:**
  ```bash
  cloudflared tunnel route dns mcc-agents api.yourdomain.com
  ```

- [ ] **Create config** at `~/.cloudflared/config.yml`:
  ```yaml
  tunnel: <TUNNEL_ID_FROM_ABOVE>
  credentials-file: /home/your-username/.cloudflared/<TUNNEL_ID>.json
  ingress:
    - hostname: api.yourdomain.com
      service: http://localhost:8080  # Your AI service port
      originRequest:
        noTLSVerify: true
        connectTimeout: 30s
    - service: http_status:404
  ```

- [ ] **Test the tunnel:**
  ```bash
  cloudflared tunnel run mcc-agents
  ```
  - [ ] In another terminal: `curl https://api.yourdomain.com/health`
  - [ ] Should get response from your AI service

- [ ] **Install as service** (so it survives reboots):
  ```bash
  sudo cloudflared service install
  sudo systemctl start cloudflared
  sudo systemctl enable cloudflared
  ```

- [ ] **Update Cloudflare Pages environment variable:**
  ```
  NEXT_PUBLIC_API_BASE=https://api.yourdomain.com
  ```

- [ ] **Update chat route** in `app/api/chat/stream/route.ts` to proxy to your VPS
  - [ ] See [CONNECTING_VPS_AGENTS.md](CONNECTING_VPS_AGENTS.md) for the exact code

- [ ] **Redeploy** your app

- [ ] **Test from dashboard** - send a message to an agent

- [ ] ✨ **Your agents now use your self-hosted AI!**

**⚠️ If something doesn't work:**
- See the troubleshooting section in [CONNECTING_VPS_AGENTS.md](CONNECTING_VPS_AGENTS.md)
- Check tunnel logs: `sudo journalctl -u cloudflared -f`
- Verify OpenClaw is running: `ps aux | grep openclaw`

## ✅ Phase 4: Customize (Optional)

- [ ] **Add your custom domain** in Cloudflare Pages settings
- [ ] **Set up cron jobs** in `wrangler.toml` to fetch:
  - [ ] Job postings (Indeed API, Adzuna API, etc.)
  - [ ] News articles (RSS feeds)
  - [ ] Sports scores (TheSportsDB API)
  - [ ] Stock prices (Yahoo Finance API)
- [ ] **Customize agents** in `/app/api/agents/route.ts`
- [ ] **Modify styling** in `/app/globals.css`
- [ ] **Add your own data sources** and widgets

## 🎉 Done!

You now have:
- ✅ A personal dashboard running on your domain
- ✅ AI agents that can help you with different areas of your life
- ✅ Free hosting and AI on Cloudflare
- ✅ Full control over your data

## 🆘 Troubleshooting

**Can't login?**
- Make sure `MCC_PASSWORD` is set in environment variables
- Try clearing browser cookies

**MFA/device remember (24h) not sticking?**
- Make sure `MCC_COOKIE_SIGNING_SECRET` is set in Cloudflare Pages environment variables
- If you changed `MCC_COOKIE_SIGNING_SECRET`, all existing sessions/trusted-device cookies are invalidated (users must sign in again once)
- Confirm you are using HTTPS on your real domain (production cookies are `Secure`)
- If Cloudflare Access (Zero Trust) is enabled with OTP, that is a separate login layer and may still prompt independently of app MFA
- Check browser settings/extensions are not blocking cookies for your site

**Agents not working?**
- Check Cloudflare Pages logs for errors
- Verify API keys are set correctly
- If using tunnel, check it's running: `cloudflared tunnel info mcc-tunnel`

**Build fails?**
- Make sure Node version is 18+ in Pages settings
- Check build command is `npm run build`
- Verify output directory is `.next`

**Need more help?**
- Check the [README.md](../README.md) for detailed explanations
- See [BLUEPRINT.md](../BLUEPRINT.md) for architecture details
- Open an issue on GitHub with error messages

## 📚 Next Steps

Once everything is working:
1. Read [BLUEPRINT.md](../BLUEPRINT.md) to understand the full architecture
2. Explore [web/cloudflare/DEPLOY.md](cloudflare/DEPLOY.md) for advanced features
3. Customize the dashboard to fit your needs
4. Add your own agents and data sources
5. Share your experience and improvements!

---

**Estimated Total Time:**
- Local setup: 5 minutes
- Cloudflare deployment: 15 minutes
- AI agent setup: 5-30 minutes (depending on option)
- **Total: 25-50 minutes** to go from zero to fully working dashboard!

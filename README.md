# My Control Center 🎛️

A personal AI-powered dashboard that helps you manage school, jobs, skills, research, sports, and stocks — all in one place. Built to run entirely on Cloudflare's free tier with AI agents to help you stay organized.

## What is This?

My Control Center (MCC) is your personal command center. It gives you:
- 📚 **School Tab**: Track assignments and deadlines
- 💼 **Jobs Tab**: Find and track job applications
- 🧠 **Skills Tab**: Learn with spaced-repetition lessons
- 🔬 **Research Tab**: Stay updated with curated articles
- 🏀 **Sports Tab**: Follow your favorite teams
- 📈 **Stocks Tab**: Monitor your watchlist
- 🤖 **AI Agents**: Get personalized help for each area

## Quick Start (Local Development)

### Automated Setup (Easiest)

```bash
cd my-control-center/web
./quickstart.sh
```

The script will:
- Check Node.js version
- Install dependencies
- Create `.env.local` from template
- Build the app to verify everything works
- Show you the next steps

### Manual Setup

#### Prerequisites
- Node.js 18+ installed
- npm or yarn package manager

### 1. Clone and Install

```bash
git clone https://github.com/casonas/my-control-center.git
cd my-control-center/web
npm install
```

### 2. Set Up Environment Variables

Create a `.env.local` file in the `web` directory:

```bash
# Basic auth password (change this!)
MCC_PASSWORD=your-secure-password-here

# API base (use local for development)
NEXT_PUBLIC_API_BASE=/api
```

### 3. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. Login with the password you set above.

**That's it!** Your dashboard is running locally. The agents will show demo responses until you connect them to a real AI backend (see below).

## Deploy to Your Domain (Cloudflare)

Cloudflare offers everything you need for free: hosting, storage, AI, and more. Here's how to deploy:

### Step 1: Create a Cloudflare Account
1. Go to [cloudflare.com](https://cloudflare.com) and sign up for free
2. Add your domain (if you have one) or use Cloudflare's free `*.pages.dev` domain

### Step 2: Install Wrangler CLI

```bash
npm install -g wrangler
wrangler login
```

### Step 3: Create Required Services

From the `web` directory:

```bash
# Create database for storing your data
wrangler d1 create mcc-store

# Create cache storage
wrangler kv namespace create CACHE

# Create file storage
wrangler r2 bucket create mcc-files
```

**Important:** Copy the IDs that these commands output and paste them into `web/wrangler.toml`:
- Copy `database_id` to the `[[d1_databases]]` section
- Copy KV namespace `id` to the `[[kv_namespaces]]` section

### Step 4: Initialize Database

```bash
wrangler d1 execute mcc-store --file=./cloudflare/d1-schema.sql
```

### Step 5: Deploy to Cloudflare Pages

Option A: **Deploy via CLI**
```bash
npm run build
npx wrangler pages deploy .next --project-name=my-control-center
```

Option B: **Deploy via GitHub (Recommended)**
1. Push your code to GitHub
2. Go to Cloudflare Dashboard → Pages
3. Click "Create application" → "Connect to Git"
4. Select your repository
5. Set build settings:
   - Build command: `npm run build`
   - Build output directory: `.next`
   - Root directory: `web`

### Step 6: Set Environment Variables

In Cloudflare Dashboard → Pages → Your Project → Settings → Environment Variables:

```
MCC_PASSWORD=your-secure-password-here
NEXT_PUBLIC_API_BASE=/api
```

**Done!** Your site is now live at `https://my-control-center.pages.dev` (or your custom domain).

## Connect Your AI Agents

By default, agents return demo responses. To connect real AI:

### Option 1: Use OpenAI API (Easiest)

1. Get an API key from [platform.openai.com](https://platform.openai.com)
2. Add to environment variables:
   ```
   OPENAI_API_KEY=sk-...
   ```
3. Update `web/app/api/chat/stream/route.ts` to call OpenAI instead of returning demo text

### Option 2: Self-Host with OpenClaw (Advanced)

**📖 Complete step-by-step guide:** [web/CONNECTING_VPS_AGENTS.md](web/CONNECTING_VPS_AGENTS.md)

If you have a VPS running OpenClaw or similar AI agents:

**Quick overview:**

1. **On your VPS**, install Cloudflare Tunnel:
   ```bash
   # SSH into your VPS first
   wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i cloudflared-linux-amd64.deb
   
   # Authenticate with Cloudflare
   cloudflared tunnel login
   
   # Create a tunnel
   cloudflared tunnel create mcc-agents
   
   # Route your subdomain to the tunnel
   cloudflared tunnel route dns mcc-agents api.yourdomain.com
   ```

2. **Create tunnel config** at `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: <TUNNEL_ID>
   credentials-file: /home/your-username/.cloudflared/<TUNNEL_ID>.json
   ingress:
     - hostname: api.yourdomain.com
       service: http://localhost:8080  # Your OpenClaw port
     - service: http_status:404
   ```

3. **Run the tunnel as a service**:
   ```bash
   # Test first
   cloudflared tunnel run mcc-agents
   
   # Install as service so it survives reboots
   sudo cloudflared service install
   sudo systemctl start cloudflared
   sudo systemctl enable cloudflared
   ```

4. **Update dashboard** in Cloudflare Pages environment variables:
   ```
   NEXT_PUBLIC_API_BASE=https://api.yourdomain.com
   ```

5. **Update code** in `web/app/api/chat/stream/route.ts` to proxy to your VPS

**⚠️ Important:** The detailed guide includes:
- Specific commands for your exact setup
- How to test each step
- Troubleshooting common issues
- How to check OpenClaw is running correctly
- API format requirements

**👉 See the full guide:** [web/CONNECTING_VPS_AGENTS.md](web/CONNECTING_VPS_AGENTS.md)

### Option 3: Use Cloudflare Workers AI (Free Tier)

Cloudflare offers free AI inference. Update your API routes to use:

```javascript
const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
  messages: [{ role: "user", content: prompt }]
});
```

See [Cloudflare Workers AI docs](https://developers.cloudflare.com/workers-ai/) for details.

## Customizing Your Dashboard

### Add Your Own Data Sources

Edit `web/wrangler.toml` to add cron jobs that fetch:
- Job postings from APIs (Indeed, LinkedIn, etc.)
- News from RSS feeds
- Sports scores from TheSportsDB
- Stock prices from Yahoo Finance

### Modify Agents

Agents are defined in:
- `web/app/api/agents/route.ts` - List of available agents
- `web/app/api/chat/stream/route.ts` - Agent response logic
- `web/components/` - Agent UI components

### Change the Look

Edit `web/app/globals.css` for styling. The app uses Tailwind CSS.

## Troubleshooting

### "Authentication failed"
- Check that `MCC_PASSWORD` is set in your environment variables
- Try clearing your browser cookies

### "Agents not responding"
- Check that `NEXT_PUBLIC_API_BASE` is set correctly
- If using a tunnel, ensure it's running: `cloudflared tunnel info mcc-tunnel`
- Check Cloudflare Pages logs for errors

### "Database not found"
- Make sure you ran `wrangler d1 execute mcc-store --file=./cloudflare/d1-schema.sql`
- Check that `database_id` in `wrangler.toml` matches your D1 database

### "Build failed on Cloudflare Pages"
- Ensure build settings point to `web` directory
- Check that Node version is 18+ in Pages settings
- Look at build logs in Cloudflare Dashboard

## FAQ

### Do I need to pay for anything?
No! Everything runs on Cloudflare's free tier. You only need to pay if you:
- Use OpenAI API (OpenAI charges per token)
- Exceed free tier limits (very unlikely for personal use)
- Want a custom domain (domains cost $10-15/year)

### Is my data private?
Yes! Your data is stored in your own Cloudflare D1 database. No one else can access it. The password you set protects your dashboard.

### Can I use this without a VPS?
Absolutely! You can use:
- OpenAI API (easiest, but costs a few cents per conversation)
- Cloudflare Workers AI (completely free, but less powerful)
- Or just run it locally without AI (still useful as a dashboard)

### What if I don't have a domain?
Cloudflare gives you a free `*.pages.dev` subdomain when you deploy. You can use that instead of buying a custom domain.

### Can multiple people use this?
The current version is designed for single-user. To add multi-user support, you'd need to:
- Modify the auth system to support multiple accounts
- Add user isolation in the database
- This is possible but requires code changes

### How do I backup my data?
Your data is in Cloudflare D1. To backup:
```bash
wrangler d1 export mcc-store --output=backup.sql
```

To restore:
```bash
wrangler d1 execute mcc-store --file=backup.sql
```

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Browser    │────▶│ Cloudflare Pages │────▶│  D1 / KV    │
│  (Next.js)   │     │  (Dashboard UI)  │     │  (Storage)  │
└─────────────┘     └──────────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │  CF Tunnel  │  (optional)
                    │  (Reverse   │
                    │   Proxy)    │
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │  Your VPS   │  (optional)
                    │ (AI Backend)│
                    └─────────────┘
```

## Learn More

- **Full Architecture**: See [BLUEPRINT.md](BLUEPRINT.md) for detailed technical specs
- **Deployment Guide**: See [web/cloudflare/DEPLOY.md](web/cloudflare/DEPLOY.md) for advanced Cloudflare setup
- **Database Schema**: See [web/cloudflare/d1-schema.sql](web/cloudflare/d1-schema.sql) for data model

## Need Help?

Open an issue on GitHub with:
- What you were trying to do
- What happened instead
- Error messages (from browser console or Cloudflare logs)
- Your environment (OS, Node version, browser)

## License

MIT - Feel free to use this for your own personal dashboard!

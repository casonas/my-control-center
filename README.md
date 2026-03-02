# My Control Center 🎛️

A personal AI-powered dashboard that helps you manage school, jobs, skills, research, sports, and stocks — all in one place. Built to run on Cloudflare with your own AI agents.

## What is This?

My Control Center (MCC) is your personal command center that gives you:
- 📚 **School Tab**: Track assignments and deadlines
- 💼 **Jobs Tab**: Find and track job applications  
- 🧠 **Skills Tab**: Learn with spaced-repetition lessons
- 🔬 **Research Tab**: Stay updated with curated articles
- 🏀 **Sports Tab**: Follow your favorite teams
- 📈 **Stocks Tab**: Monitor your watchlist
- 🤖 **AI Agents**: Get personalized help powered by your VPS

---

## 🚀 Quick Start - Deploy to Your Domain

**Got a domain? Let's get you live in 30-45 minutes.**

### What You Need
- ✅ Your domain
- ✅ SSH access to VPS with OpenClaw agents
- ✅ Node.js 18+ (just for building)

### The Fast Track

**📖 Complete guide:** [DEPLOY_TO_DOMAIN.md](DEPLOY_TO_DOMAIN.md)

**Summary:**
1. Clone & build: `npm install && npm run build`
2. Set up Cloudflare: Create account, add domain, create services
3. Deploy: Connect GitHub or use `wrangler pages deploy`
4. Connect VPS: Set up Cloudflare Tunnel to your OpenClaw agents
5. **Done!** Dashboard live at your domain with working AI

**Choose your path:**
- 🏃 **[DEPLOY_TO_DOMAIN.md](DEPLOY_TO_DOMAIN.md)** - Streamlined guide to go live fast
- 📋 **[web/GETTING_STARTED.md](web/GETTING_STARTED.md)** - Detailed checklist with all options
- 🔌 **[web/CONNECTING_VPS_AGENTS.md](web/CONNECTING_VPS_AGENTS.md)** - VPS connection specifics
- 🔧 **[OPENCLAW_SETUP_GUIDE.md](OPENCLAW_SETUP_GUIDE.md)** - Micro-step setup & tunnel troubleshooting

---

## Architecture

```
Your Browser → yourdomain.com (Cloudflare Pages)
                     ↓
          Cloudflare D1 Database
                     ↓
          Cloudflare Tunnel
                     ↓
     Your VPS (OpenClaw Agents)
```

- **Frontend**: Next.js app on Cloudflare Pages
- **Data**: Cloudflare D1 (SQLite)
- **AI**: Your OpenClaw agents via secure tunnel
- **Cost**: $0 (Cloudflare free tier + your existing VPS)

---

## Customizing Your Dashboard

### Change Agents

Edit `web/app/api/agents/route.ts` to add/modify agents:

```typescript
{ id: "custom-agent", name: "My Agent", emoji: "🤖" }
```

### Modify Styling

Edit `web/app/globals.css` - uses Tailwind CSS.

### Add Data Sources

Edit `web/wrangler.toml` to add cron jobs:

```toml
[triggers]
crons = [
  "0 */4 * * *",   # Fetch jobs every 4 hours
  "0 */2 * * *",   # Fetch news every 2 hours
]
```

### Backup Your Data

```bash
wrangler d1 export mcc-store --output=backup.sql
```

---

## Optional: Local Development

**Don't need local dev? Skip this.**

<details>
<summary>Click to expand local setup (optional)</summary>

### Quick Setup

```bash
cd my-control-center/web
./quickstart.sh
npm run dev
```

Open http://localhost:3000

### Manual Setup

1. Clone repo: `git clone https://github.com/casonas/my-control-center.git`
2. Install: `cd my-control-center/web && npm install`
3. Create `.env.local`:
   ```
   MCC_PASSWORD=your-password
   NEXT_PUBLIC_API_BASE=/api
   ```
4. Run: `npm run dev`

See [web/README.md](web/README.md) for details.

</details>

---

## FAQ

### Do I need to run this locally first?
No! You can deploy directly to your domain. Local dev is optional.

### How much does hosting cost?
$0 - Cloudflare's free tier includes everything you need (Pages, D1, KV, R2, Tunnels).

### Is my data private?
Yes! Data is in your own Cloudflare D1 database. Only you can access it.

### Can I use this without OpenClaw?
Yes, but agents won't work. You'd need to:
- Use OpenAI API instead (costs a few cents per chat)
- Use Cloudflare Workers AI (free but less powerful)
- Or just use it as a dashboard without AI

### What if my tunnel stops working?
Check tunnel status: `sudo systemctl status cloudflared`  
View logs: `sudo journalctl -u cloudflared -f`  
Restart: `sudo systemctl restart cloudflared`

### How do I update the dashboard?
Just push to GitHub - Cloudflare auto-deploys. Or run `wrangler pages deploy .next`

### Can multiple people use this?
Current version is single-user. Multi-user would require code changes to add user accounts and data isolation.

---

## Troubleshooting

### Can't login
- Check `MCC_PASSWORD` is set in Cloudflare Pages environment variables
- Clear browser cookies

### Agents not responding
- Check tunnel is running: `sudo systemctl status cloudflared`
- Test: `curl https://api.yourdomain.com/`
- Check `NEXT_PUBLIC_API_BASE` environment variable

### 502 Bad Gateway
- Verify OpenClaw port in tunnel config
- Restart tunnel: `sudo systemctl restart cloudflared`

### Build fails
- Check Node.js version is 18+
- Check build settings in Cloudflare Pages
- View build logs in Cloudflare dashboard

**More help:**
- See [OPENCLAW_SETUP_GUIDE.md](OPENCLAW_SETUP_GUIDE.md) for micro-step tunnel troubleshooting
- See [web/CONNECTING_VPS_AGENTS.md](web/CONNECTING_VPS_AGENTS.md) for VPS agent connection details

---

## Learn More

- **[DEPLOY_TO_DOMAIN.md](DEPLOY_TO_DOMAIN.md)** - Fast track to production
- **[OPENCLAW_SETUP_GUIDE.md](OPENCLAW_SETUP_GUIDE.md)** - Micro-step OpenClaw setup & tunnel troubleshooting
- **[web/GETTING_STARTED.md](web/GETTING_STARTED.md)** - Comprehensive guide
- **[web/CONNECTING_VPS_AGENTS.md](web/CONNECTING_VPS_AGENTS.md)** - VPS setup details
- **[BLUEPRINT.md](BLUEPRINT.md)** - Full technical architecture
- **[web/cloudflare/DEPLOY.md](web/cloudflare/DEPLOY.md)** - Advanced Cloudflare features

---

## Need Help?

Open an issue on GitHub with:
- What you were trying to do
- What happened instead
- Error messages (browser console, Cloudflare logs, tunnel logs)
- Your environment (OS, Node version, browser)

---

## License

MIT - Use this for your own personal dashboard!

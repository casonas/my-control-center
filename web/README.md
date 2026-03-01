# My Control Center - Web Application

This is the Next.js web application for My Control Center.

## 🚀 Quick Start

**New here?** Follow the [GETTING_STARTED.md](GETTING_STARTED.md) guide for a step-by-step walkthrough!

### Local Development

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local

# Edit .env.local and set your password
# MCC_PASSWORD=your-password-here

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and login with your password.

## 📁 Project Structure

```
web/
├── app/
│   ├── api/          # API routes (auth, chat, agents, etc.)
│   ├── page.tsx      # Main dashboard page
│   └── layout.tsx    # App layout with auth
├── components/       # React components
├── lib/              # Utilities and helpers
├── cloudflare/       # Cloudflare-specific configs
│   ├── d1-schema.sql      # Database schema
│   └── DEPLOY.md          # Deployment guide
├── public/           # Static assets
├── .env.example      # Environment variable template
└── wrangler.toml     # Cloudflare configuration
```

## 🔧 Available Scripts

```bash
npm run dev       # Start development server
npm run build     # Build for production
npm start         # Start production server
npm run lint      # Run ESLint
```

## 📚 Documentation

- [GETTING_STARTED.md](GETTING_STARTED.md) - Step-by-step setup guide
- [cloudflare/DEPLOY.md](cloudflare/DEPLOY.md) - Detailed Cloudflare deployment
- [../BLUEPRINT.md](../BLUEPRINT.md) - Full technical architecture
- [../README.md](../README.md) - Project overview

## 🤖 AI Agents

The dashboard includes 7 AI agents:
- 🏠 Home Assistant - Overall guidance
- 🎓 Study Buddy - School assignments
- 💼 Job Scout - Job search help
- 🧠 Skill Coach - Learning paths
- 🏀 Sports Analyst - Team updates
- 📈 Market Watch - Stock tracking
- 🔬 Research AI - Article curation

See [GETTING_STARTED.md](GETTING_STARTED.md) for how to connect them to real AI.

## 🚢 Deployment

This app is designed to run on **Cloudflare Pages** (free tier):
- Unlimited bandwidth
- Free D1 database (SQLite)
- Free Workers AI
- Free KV storage
- Free R2 file storage

See [cloudflare/DEPLOY.md](cloudflare/DEPLOY.md) for detailed deployment instructions.

## 🛠️ Technology Stack

- **Framework**: Next.js 16 (React 19)
- **Styling**: Tailwind CSS 4
- **Deployment**: Cloudflare Pages
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare KV + R2
- **AI**: Cloudflare Workers AI (or bring your own)

## 🔐 Security

- Password-based authentication
- httpOnly cookies for sessions
- CSRF protection
- No secrets in client code
- All data encrypted at rest in D1

## 📝 License

MIT

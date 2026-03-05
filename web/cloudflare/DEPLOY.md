# 🚀 Cloudflare Deployment Guide (Free Tier)

## Overview

My Control Center runs entirely on Cloudflare's free tier:

| Service | Free Tier Limit | Usage |
|---------|----------------|-------|
| **Pages** | Unlimited bandwidth, 500 builds/mo | Host the Next.js dashboard |
| **Workers** | 100k requests/day | Cron jobs: fetch jobs, news, scores, stocks |
| **D1** | 5M reads/day, 100k writes/day, 5GB | Cross-device data storage (replaces localStorage) |
| **KV** | 100k reads/day, 1k writes/day, 1GB | API response cache |
| **R2** | 10GB, 10M ops/mo | File storage (notes exports, etc.) |
| **Workers AI** | Free tier inference | Embeddings for vector search |
| **Tunnels** | Unlimited | Reverse proxy to OpenClaw VPS |
| **Access** | ≤50 users free | Zero-trust auth layer |

## Step 1: Install Wrangler CLI

```bash
npm install -g wrangler
wrangler login
```

## Step 2: Create Cloudflare Resources

```bash
# Create D1 database
wrangler d1 create mcc-store
# Copy the database_id into wrangler.toml

# Create KV namespace
wrangler kv namespace create CACHE
# Copy the id into wrangler.toml

# Create R2 bucket
wrangler r2 bucket create mcc-files

# Apply D1 schema
wrangler d1 execute mcc-store --file=./cloudflare/d1-schema.sql
```

## Step 3: Deploy to Cloudflare Pages

```bash
cd web
npm run build
npx wrangler pages deploy .next
```

Or connect your GitHub repo in the Cloudflare dashboard for auto-deployments.

## Step 4: Set Up Cloudflare Tunnel to OpenClaw VPS

This creates a secure reverse proxy from your Cloudflare domain to your OpenClaw VPS:

```bash
# On your VPS
cloudflared tunnel create openclaw-tunnel
cloudflared tunnel route dns openclaw-tunnel api.yourdomain.com

# Create config.yml on VPS
cat > ~/.cloudflared/config.yml << EOF
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:8080  # OpenClaw port
  - service: http_status:404
EOF

# Run the tunnel
cloudflared tunnel run openclaw-tunnel
```

Then set `NEXT_PUBLIC_API_BASE=https://api.yourdomain.com` in your Pages environment variables.

## Step 5: Set Up Cloudflare Access (Zero Trust)

1. Go to Cloudflare Dashboard → Zero Trust → Access → Applications
2. Add your dashboard domain
3. Set authentication policy (email OTP, GitHub, etc.)
4. This adds an extra auth layer on top of your password login

## Step 5.1: Ensure 24-hour MFA "Remember this device" Works

The app stores trusted-device state in a signed, httpOnly cookie (`mcc_mfa_trust`) for 24 hours.

1. In **Cloudflare Dashboard → Pages → Your project → Settings → Environment variables**, set:
   - `MCC_PASSWORD` (your app login password)
   - `MCC_COOKIE_SIGNING_SECRET` (long random secret, different from password)
2. Add both variables to **Production** and **Preview** (if you use both).
3. Redeploy the Pages project.
4. Sign in once, then verify response headers include:
   - `set-cookie: mcc_mfa_trust=...; Max-Age=86400; HttpOnly; SameSite=lax`
5. If you rotate `MCC_COOKIE_SIGNING_SECRET`, existing trusted-device cookies are invalid and users must sign in again once.
6. If Cloudflare Access OTP is enabled, expect Access prompts separately (this app cookie does not bypass Access).

## Step 6: Enable Workers AI for Vector Search

```bash
# In your worker, use the AI binding:
const embedding = await env.AI.run('@cf/baai/bge-small-en-v1.5', {
  text: ["your search query"]
});
```

This gives you free semantic search across all your notes, research, and assignments.

## Architecture Diagram

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Browser    │────▶│ Cloudflare Pages │────▶│  D1 / KV    │
│  (Next.js)   │     │  (Dashboard UI)  │     │  (Storage)  │
└─────────────┘     └──────────────────┘     └─────────────┘
                           │                        │
                    ┌──────┴──────┐          ┌──────┴──────┐
                    │   Workers   │          │  Workers AI │
                    │  (Cron Jobs)│          │ (Embeddings)│
                    └──────┬──────┘          └─────────────┘
                           │
                    ┌──────┴──────┐
                    │  CF Tunnel  │
                    │  (Reverse   │
                    │   Proxy)    │
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │ OpenClaw VPS│
                    │  (AI Agents)│
                    └─────────────┘
```

## Free API Sources (No Keys Required)

| Data | Source | Cost |
|------|--------|------|
| Weather | Open-Meteo API | Free, no key |
| Crypto | CoinGecko API | Free, no key |
| Sports | TheSportsDB | Free, no key |
| News | RSS feeds (TechCrunch, Krebs, HackerNews) | Free |
| Stocks | Yahoo Finance (via worker proxy) | Free |
| Jobs | Adzuna API (free tier) | Free with signup |

## Cron Worker Schedule

| Schedule | Task |
|----------|------|
| Every 4 hours | Fetch new cybersecurity job postings |
| Every 2 hours | Fetch news & research articles |
| Every 30 min | Fetch sports scores (game days) |
| Every 15 min | Fetch stock prices (market hours) |

All cron workers are defined in `wrangler.toml` and run within the free tier limits.

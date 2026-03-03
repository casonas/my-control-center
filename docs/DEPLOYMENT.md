# MCC Deployment Guide

## Required Environment Variables

### Authentication (required)
| Variable | Description | Where to set |
|---|---|---|
| `MCC_COOKIE_SIGNING_SECRET` | Signs session cookies (256-bit secret) | Cloudflare Dashboard → Pages → Settings → Env vars |
| `MCC_PASSWORD` | Login password | Same |
| `MCC_ALLOWED_ORIGINS` | Comma-separated allowed origins | Same (e.g. `https://my-control-center.com`) |

### Cron Worker (required for autonomy)
| Variable | Description | Where to set |
|---|---|---|
| `CRON_SECRET` | Shared secret for cron auth | Cloudflare Dashboard → Workers → mcc-cron → Settings → Env vars |

### VPS Bridge (optional)
| Variable | Description | Where to set |
|---|---|---|
| `MCC_BRIDGE_URL` | URL to VPS bridge endpoint | Cloudflare Dashboard → Pages → Settings → Env vars |
| `INTERNAL_SHARED_SECRET` | Token for VPS → MCC internal API calls | Same |

### Data Providers (optional, for real-time data)
| Variable | Description | Where to set |
|---|---|---|
| `STOCKS_API_KEY` | Market data provider API key | Cloudflare Dashboard → Pages → Settings → Env vars |
| `SPORTS_API_KEY` | Sports data provider API key | Same |

## Cloudflare Bindings

### Required
| Binding | Type | Name | Setup |
|---|---|---|---|
| `DB` | D1 Database | `mcc-store` | `wrangler d1 create mcc-store` |

### Recommended
| Binding | Type | Name | Setup |
|---|---|---|---|
| `FILES` | R2 Bucket | `mcc-files` | `wrangler r2 bucket create mcc-files` |
| `CACHE` | KV Namespace | — | `wrangler kv namespace create CACHE` |

## Deployment Steps

### 1. Deploy Pages (web app)
```bash
cd web
npm run build
npx wrangler pages deploy .next
```

### 2. Run D1 Migrations
```bash
# Run each migration in order
for f in cloudflare/migrations/00*.sql; do
  wrangler d1 execute mcc-store --file="$f"
done
```

### 3. Deploy Cron Worker
```bash
cd worker
npx wrangler deploy
```

### 4. Set Environment Variables
In Cloudflare Dashboard:
1. Go to **Pages** → your project → **Settings** → **Environment variables**
2. Add all required variables from the table above
3. Go to **Workers** → `mcc-cron` → **Settings** → **Variables**
4. Add `CRON_SECRET`

### 5. Enable Cron Triggers
Cron triggers are configured in `worker/wrangler.toml`. They activate automatically on deploy.

## Post-Deploy Verification

1. **Health check**: `curl https://your-domain.com/api/health`
   - Verify `ok: true` and all services show as configured
2. **Auth check**: Log in via the UI
3. **D1 check**: Navigate to any tab — data should load from D1
4. **Cron check**: Go to Settings → Autonomy panel — click "Run" on any job
5. **Diagnostics**: `curl -b cookies.txt https://your-domain.com/api/diagnostics`

## Common Failure Cases

### D1 binding missing
**Symptom**: API returns `500 { error: "D1 database binding not available" }`
**Fix**: Check `wrangler.toml` has `[[d1_databases]]` with correct `database_id`. Run migrations.

### R2 not configured
**Symptom**: File uploads return `400 { hint: "Configure R2 bindings in Cloudflare" }`
**Fix**: Create R2 bucket and add binding to `wrangler.toml`. Not required for core functionality.

### VPS bridge unreachable
**Symptom**: Chat streaming fails or times out
**Fix**: Check `MCC_BRIDGE_URL` is set and VPS is running. Verify tunnel is active.

### CRON_SECRET missing
**Symptom**: Cron worker logs "CRON_SECRET not set — refusing to run"
**Fix**: Set `CRON_SECRET` in Worker environment variables.

### Cookie signing secret missing
**Symptom**: Login fails or sessions expire immediately
**Fix**: Set `MCC_COOKIE_SIGNING_SECRET` to a random 64+ character string.

### CORS / Origin errors
**Symptom**: `403 Origin not allowed`
**Fix**: Set `MCC_ALLOWED_ORIGINS` to include your domain (e.g. `https://my-control-center.com`).

## Cron Schedule Reference

| Job | Cron Expression | Frequency |
|---|---|---|
| `research_scan` | `0 * * * *` | Hourly |
| `stocks_refresh` | `*/10 * * * *` | Every 10 minutes |
| `stocks_news_scan` | `15 * * * *` | Hourly at :15 |
| `skills_radar_scan` | `0 8 * * *` | Daily at 8am UTC |
| `jobs_refresh` | `0 9,13,18 * * 1-5` | Weekdays 9am/1pm/6pm |
| `sports_refresh_nba` | `*/15 * * * *` | Every 15 minutes |
| `sports_refresh_nfl` | `0 */4 * * *` | Every 4 hours |

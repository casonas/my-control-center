# Deploy Checklist

## 1. Deploy Web
```bash
cd web && npm ci && npm run build
npx wrangler pages deploy .next
```

## 2. Deploy Worker
```bash
cd worker && npm ci
npx wrangler deploy
```

## 3. Run Remote Migrations
```bash
cd web
npx wrangler d1 execute mcc-store --remote --file=./cloudflare/d1-schema.sql
```

## 4. Verify Health Endpoints
```bash
curl -sf https://<YOUR_DOMAIN>/api/health
curl -sf https://<YOUR_DOMAIN>/api/ping
```

## 5. Verify cron_runs
```bash
curl -sf https://<YOUR_DOMAIN>/api/agents/heartbeat
# Check Cloudflare dashboard → Workers → Cron Triggers for last-run timestamps
```

## 6. Verify Session Persistence
```bash
# Log in via browser, confirm cookie is set, refresh the page — session should survive.
curl -sf -b cookies.txt https://<YOUR_DOMAIN>/api/auth/me
```

## 7. Verify Lesson / Radar Refresh
```bash
curl -sf https://<YOUR_DOMAIN>/api/skills/radar?limit=5
curl -sf https://<YOUR_DOMAIN>/api/skills/radar/scan
```

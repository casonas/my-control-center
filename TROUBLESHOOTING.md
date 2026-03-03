# 🔧 Troubleshooting & Deployment Guide

Complete step-by-step instructions for deploying My Control Center to
Cloudflare Pages + connecting your VPS agents.  Covers what to do
**before** you push, **after** you push, and **when things go wrong**.

---

## Table of Contents

1. [What Was Fixed (and Why It Broke)](#1-what-was-fixed-and-why-it-broke)
2. [Before You Push — Pre-Flight Checklist](#2-before-you-push--pre-flight-checklist)
3. [Cloudflare Dashboard Setup (Step-by-Step with Screenshots)](#3-cloudflare-dashboard-setup)
4. [After You Push — Verify the Deployment](#4-after-you-push--verify-the-deployment)
5. [VPS Setup — Complete Walkthrough](#5-vps-setup--complete-walkthrough)
6. [If the Deployment Gives You Another Error](#6-if-the-deployment-gives-you-another-error)
7. [Common Errors & Fixes](#7-common-errors--fixes)
8. [Self-Diagnosis Prompts (for AI Assistants)](#8-self-diagnosis-prompts)

---

## 1. What Was Fixed (and Why It Broke)

### Build Errors That Were Fixed

| # | Error | File(s) | Root Cause | Fix |
|---|-------|---------|------------|-----|
| 1 | `'requireD1' is not exported from '@/lib/d1'` | `chat/sessions/route.ts`, `chat/sessions/[id]/route.ts` | The function `requireD1()` was imported but never defined in `lib/d1.ts` | Added `requireD1()` — calls `getD1()` and throws if D1 is unavailable |
| 2 | `'getEnvStatus' is not exported from '@/lib/env'` | `diagnostics/route.ts` | `lib/env.ts` was a route handler, not a library — had no `getEnvStatus` export | Rewrote `lib/env.ts` as a proper helper that checks env vars + Cloudflare bindings |
| 3 | `Package path . is not exported from @cloudflare/next-on-pages` | `health/route.ts` | The package only exports ESM (`import`), not CommonJS (`require`). The `require()` call fails at build time | Removed **all** imports of the deprecated package. Now reads the `globalThis` symbol directly |
| 4 | `Type "{ params: { id: string; } }" is not valid` | `files/[id]/download/route.ts` | Next.js 15 changed route params to be async: `Promise<{ id: string }>` | Changed type to `Promise<{ id: string }>` and added `await ctx.params` |

### Why D1 Connection Was Failing

`@cloudflare/next-on-pages` is **deprecated** (Cloudflare now recommends
`@opennextjs/cloudflare`).  Its `getRequestContext()` function works by
reading a well-known symbol on `globalThis`:

```
globalThis[Symbol.for("__cloudflare-request-context__")]
```

This symbol is set by the Cloudflare Pages adapter at **runtime**.  There
are two reasons it might not contain your D1 binding:

1. **D1 binding not configured in Cloudflare Pages dashboard** — this is
   the #1 cause.  Even if `wrangler.toml` lists the binding, **Pages
   ignores wrangler.toml for bindings**.  You must configure them in the
   dashboard UI (see [Section 3.3](#33-add-d1-binding-critical)).

2. **The adapter isn't running** — if the build/deploy process changed
   and the Cloudflare Pages adapter doesn't wrap Next.js properly, the
   `globalThis` symbol is never set.

**Our fix:** We now read the `globalThis` symbol directly (the exact same
thing `getRequestContext()` did internally) and log a clear warning when
the `DB` binding is missing, listing what bindings *are* available.

---

## 2. Before You Push — Pre-Flight Checklist

Run these commands **on your local machine** before pushing to GitHub.

### 2.1 Make sure dependencies are installed

```bash
cd web
npm install
```

### 2.2 Build locally

```bash
npm run build
```

✅ **Expected output:**
```
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Generating static pages (5/5)
```

❌ **If you see errors**, check [Section 7](#7-common-errors--fixes).

### 2.3 Verify no import warnings for your routes

Look at the build output.  You should **not** see any of these:
- `Attempted import error: 'requireD1' is not exported`
- `Attempted import error: 'getEnvStatus' is not exported`
- `Module not found: Package path . is not exported from @cloudflare/next-on-pages`

If you still see them, your local code is outdated.  Pull the latest:
```bash
git pull origin main
npm install
npm run build
```

### 2.4 Check for TypeScript errors

```bash
npx tsc --noEmit
```

This runs the TypeScript compiler without producing output — just checks
for type errors.

### 2.5 Run the linter

```bash
npm run lint
```

Fix any errors it reports (warnings are OK to ignore for now).

---

## 3. Cloudflare Dashboard Setup

**This is the section most people skip, and it's why D1 doesn't work.**

### 3.1 Create a Cloudflare Account and Add Your Domain

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → Sign up (free)
2. Click **"Add a site"** → enter your domain (e.g. `yourdomain.com`)
3. Choose the **Free** plan
4. Cloudflare shows you 2 nameservers — copy them to your domain registrar
5. Wait 5–30 min for DNS to propagate
6. ✅ Your domain should show **"Active"** in Cloudflare

### 3.2 Create Cloudflare Resources (CLI)

From the `web/` directory on your local machine:

```bash
# Install the Wrangler CLI if you haven't
npm install -g wrangler
wrangler login     # opens browser, click Allow

# Create D1 database
wrangler d1 create mcc-store
# ⚠️ COPY the database_id from the output!

# Create KV namespace
wrangler kv namespace create CACHE
# ⚠️ COPY the id from the output!

# Create R2 bucket
wrangler r2 bucket create mcc-files

# Apply the database schema
wrangler d1 execute mcc-store --file=./cloudflare/d1-schema.sql
```

### 3.3 Add D1 Binding (⚠️ CRITICAL)

**Cloudflare Pages ignores `wrangler.toml` for bindings.**  You must
configure them manually in the dashboard.

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Click **"Workers & Pages"** in the left sidebar
3. Click your project name (e.g. `my-control-center`)
4. Click **"Settings"** tab at the top
5. Scroll down to **"Functions"** section
6. Click **"D1 database bindings"**
7. Click **"Add binding"**
8. Fill in:

   | Field | Value |
   |-------|-------|
   | **Variable name** | `DB` |
   | **D1 database** | Select `mcc-store` from dropdown |

9. Click **"Save"**

> **⚠️ The variable name MUST be exactly `DB`** (uppercase).  The code
> reads `env["DB"]`.  If you name it `d1` or `database`, it won't work.

### 3.4 Add KV Binding

Same location (Settings → Functions):

1. Click **"KV namespace bindings"**
2. Click **"Add binding"**
3. Fill in:

   | Field | Value |
   |-------|-------|
   | **Variable name** | `CACHE` |
   | **KV namespace** | Select your CACHE namespace |

4. Click **"Save"**

### 3.5 Add R2 Binding

1. Click **"R2 bucket bindings"**
2. Click **"Add binding"**
3. Fill in:

   | Field | Value |
   |-------|-------|
   | **Variable name** | `FILES` |
   | **R2 bucket** | Select `mcc-files` |

4. Click **"Save"**

### 3.6 Add Environment Variables

Still in Settings → **"Environment variables"**:

1. Click **"Add variable"** for each:

   | Variable name | Value | Notes |
   |---------------|-------|-------|
   | `MCC_PASSWORD` | `your-strong-password` | Dashboard login password |
   | `MCC_COOKIE_SIGNING_SECRET` | *(random string)* | Generate with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
   | `NEXT_PUBLIC_API_BASE` | `/api` | Keep as `/api` unless using VPS bridge directly |

2. Click **"Save"**

> **Tip:** Set these for both **Production** and **Preview** environments.

### 3.7 Configure the Build

1. Go to your project → **"Settings"** → **"Builds & deployments"**
2. Set:

   | Setting | Value |
   |---------|-------|
   | **Framework preset** | `Next.js` |
   | **Build command** | `npm run build` |
   | **Build output directory** | `.next` |
   | **Root directory** | `web` |

3. Click **"Save"**

### 3.8 Connect GitHub Repository

1. Go to **"Workers & Pages"** → **"Create application"** → **"Pages"**
2. Click **"Connect to Git"**
3. Select your GitHub repo: `casonas/my-control-center`
4. Select the branch: `main`
5. Configure build settings as in 3.7 above
6. Click **"Save and Deploy"**

From now on, every push to `main` triggers an automatic deployment.

---

## 4. After You Push — Verify the Deployment

### 4.1 Watch the Build

1. Go to Cloudflare → Workers & Pages → your project
2. Click **"Deployments"** tab
3. Click on the latest deployment
4. Watch the build log

✅ **Expected:** Build completes with `✓ Compiled successfully`

### 4.2 Test Health Endpoint

Once deployed, open in your browser:

```
https://your-project.pages.dev/api/health
```

✅ **Expected response:**
```json
{
  "ok": false,
  "time": "2026-03-03T...",
  "services": {
    "d1": { "ok": true, "configured": true, "latencyMs": 5 },
    "r2": { "ok": true, "configured": true },
    "vps": { "ok": false, "configured": false },
    "cron": { "ok": false, "configured": false }
  }
}
```

- `d1.ok: true` → D1 binding is working ✅
- `d1.ok: false, configured: false` → D1 binding missing → Go back to [3.3](#33-add-d1-binding-critical)
- `d1.ok: false, configured: true` → D1 binding found but query failed → Check schema was applied

### 4.3 Test Debug Endpoint

```
https://your-project.pages.dev/api/debug/d1
```

✅ **Expected:** `{ "ok": true, "sessions_count": 0 }`
❌ **If `ok: false`:** The `DB` binding is not configured. See [3.3](#33-add-d1-binding-critical).

### 4.4 Test Diagnostics (Requires Login)

1. Go to `https://your-project.pages.dev`
2. Log in with your `MCC_PASSWORD`
3. Visit `https://your-project.pages.dev/api/diagnostics`

This shows all env vars and bindings status.

### 4.5 Redeploy After Adding Bindings

If you added bindings after the first deployment, you must **redeploy**
for them to take effect:

1. Go to Deployments tab
2. Find the latest successful deployment
3. Click the **"⋮"** menu → **"Retry deployment"**

Or push a new commit to trigger a fresh build.

---

## 5. VPS Setup — Complete Walkthrough

### 5.1 SSH into Your VPS

```bash
ssh your-username@YOUR_VPS_IP
```

### 5.2 Install Node.js 18+

```bash
node --version   # Check — needs v18+

# If missing or too old:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

node --version   # Should show v20.x
npm --version
```

### 5.3 Clone and Build

```bash
cd ~
git clone https://github.com/casonas/my-control-center.git
cd my-control-center/web
npm install
```

### 5.4 Create Secrets

```bash
nano ~/.env.secrets
```

Paste:
```bash
export MCC_PASSWORD="your-strong-password-here"
export MCC_COOKIE_SIGNING_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
```

Lock it down:
```bash
chmod 600 ~/.env.secrets
echo 'source ~/.env.secrets' >> ~/.profile
source ~/.profile
echo $MCC_PASSWORD   # Verify it prints your password
```

### 5.5 Build the Dashboard

```bash
cd ~/my-control-center/web
npm run build
```

✅ Should see: `✓ Compiled successfully`

### 5.6 Install PM2 and Start Services

```bash
npm install -g pm2
mkdir -p ~/logs
cd ~/my-control-center
pm2 start vps/pm2.config.js
pm2 status    # Should show mcc-dashboard and mcc-bridge as "online"
pm2 save
pm2 startup   # Copy and run the command it prints
```

### 5.7 Open the Firewall

```bash
sudo ufw allow 3000/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
```

### 5.8 Test It

```bash
# From the VPS:
curl http://localhost:3000/api/ping
curl http://localhost:3000/api/health

# From your browser:
# http://YOUR_VPS_IP:3000
```

### 5.9 Set Up HTTPS with Caddy (Optional but Recommended)

```bash
# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudflare.com/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudflare.com/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# Configure
sudo nano /etc/caddy/Caddyfile
```

Paste (replace with your domain):
```
dashboard.yourdomain.com {
    reverse_proxy localhost:3000
}

bridge.yourdomain.com {
    reverse_proxy localhost:8081
}
```

```bash
sudo systemctl reload caddy
sudo systemctl status caddy
```

### 5.10 Connect Bridge to Cloudflare Pages

If running the dashboard on Cloudflare Pages (not on VPS), you need the
bridge accessible via HTTPS.  Add these environment variables in Cloudflare
Pages Settings → Environment Variables:

| Variable | Value |
|----------|-------|
| `MCC_VPS_SSE_URL` | `https://bridge.yourdomain.com/chat/stream` |
| `MCC_VPS_CONNECT_URL` | `https://bridge.yourdomain.com/agents/connect` |
| `MCC_VPS_HEARTBEAT_URL` | `https://bridge.yourdomain.com/agents/heartbeat` |
| `MCC_VPS_SCAN_URL` | `https://bridge.yourdomain.com/agents/scan` |

Then redeploy.

---

## 6. If the Deployment Gives You Another Error

### Step-by-Step Triage Process

#### Step 1: Read the Build Log

1. Go to Cloudflare → Workers & Pages → your project → Deployments
2. Click the failed deployment
3. Read the log — scroll to the **first red error**

#### Step 2: Identify the Error Category

| Error Pattern | Category | Go To |
|---------------|----------|-------|
| `Attempted import error: 'X' is not exported` | Missing export | [7.1](#71-missing-export-errors) |
| `Module not found: Package path . is not exported` | Package issue | [7.2](#72-package-not-exported) |
| `Type error: Route "..." has an invalid "GET" export` | TypeScript | [7.3](#73-next15-route-type-errors) |
| `Type error: ...` (other) | TypeScript | [7.4](#74-general-typescript-errors) |
| `Error: Command "npm run build" exited with 1` | Build failed | Read the lines above this |
| `D1 database binding not available` | Runtime | [7.5](#75-d1-not-available-at-runtime) |
| `Failed to retrieve the Cloudflare request context` | Runtime | [7.6](#76-cloudflare-context-not-available) |

#### Step 3: Test Locally First

Always reproduce the error locally before guessing:

```bash
cd web
npm install
npm run build
```

If it builds locally but fails on Cloudflare, the issue is environment
(bindings, env vars, Node.js version).

#### Step 4: Check Bindings

Visit `https://your-site/api/health` after deployment.  If `d1.configured`
is `false`, the D1 binding is missing from the dashboard.

---

## 7. Common Errors & Fixes

### 7.1 Missing Export Errors

**Error:** `Attempted import error: 'someFunction' is not exported from '@/lib/something'`

**What it means:** A route file imports a function that doesn't exist in the
specified library file.

**Fix:**
1. Open the library file (e.g. `web/lib/d1.ts`)
2. Check what functions are actually exported: `export function ...`
3. Either add the missing export or fix the import

**Self-diagnosis prompt:**
> My Next.js build shows "Attempted import error: 'FUNCTION_NAME' is not
> exported from 'MODULE_PATH'".  Show me what MODULE_PATH currently exports
> and write the missing FUNCTION_NAME function.

### 7.2 Package Not Exported

**Error:** `Module not found: Package path . is not exported from package`

**What it means:** You're using `require()` (CommonJS) on a package that
only supports ESM `import`.

**Fix:**
- Replace `require("package")` with `import { thing } from "package"`
- Or, if you don't need the package at all, remove the import
  (this is what we did — removed `@cloudflare/next-on-pages` entirely)

**Self-diagnosis prompt:**
> My Next.js build shows "Package path . is not exported from PACKAGE_NAME".
> Check the package.json exports field for that package and show me how to
> fix the import.

### 7.3 Next.js 15 Route Type Errors

**Error:** `Type "{ params: { id: string; } }" is not a valid type for the function's second argument`

**What it means:** Next.js 15 changed route handler params to be async.

**Fix:** Change the params type from:
```typescript
// ❌ Old (Next.js 14)
ctx: { params: { id: string } }
const id = ctx.params.id;

// ✅ New (Next.js 15)
ctx: { params: Promise<{ id: string }> }
const { id } = await ctx.params;
```

**Self-diagnosis prompt:**
> My Next.js 15 route handler has a type error about params.  The error
> says the type is not valid for the function's second argument.  Show me
> the Next.js 15 way to type route params with Promise<>.

### 7.4 General TypeScript Errors

**Fix process:**
1. Run `npx tsc --noEmit` locally
2. Fix the errors it reports
3. Rebuild: `npm run build`

### 7.5 D1 Not Available at Runtime

**Symptoms:**
- `/api/health` shows `d1: { ok: false, configured: false }`
- `/api/debug/d1` returns `{ ok: false, error: "DB binding not found" }`
- Chat, diagnostics, and other features return 500 errors

**Cause:** D1 binding not configured in Cloudflare Pages dashboard.

**Fix:**
1. Go to Cloudflare → Workers & Pages → your project
2. Settings → Functions → D1 database bindings
3. Add binding: Variable name = `DB`, Database = `mcc-store`
4. Save → Redeploy

**Also check:**
- Schema was applied: `wrangler d1 execute mcc-store --file=./cloudflare/d1-schema.sql`
- The D1 database exists: `wrangler d1 list`

### 7.6 Cloudflare Context Not Available

**Error:** `Failed to retrieve the Cloudflare request context`

**What it means:** The Cloudflare Pages adapter isn't setting up the
runtime context.  This usually means:

1. The route is missing `export const runtime = "edge"` at the top
2. The deployment isn't on Cloudflare Pages
3. Local development isn't configured properly

**Fix:**
- Ensure every API route starts with `export const runtime = "edge";`
- For local dev, you're expected to run on Cloudflare locally using
  `npx wrangler pages dev` or accept that D1 won't be available locally

### 7.7 Login Fails ("Invalid credentials")

1. Check `MCC_PASSWORD` is set in Cloudflare Pages → Settings → Environment Variables
2. Make sure it's set for both **Production** and **Preview**
3. Redeploy after adding/changing the variable
4. Clear browser cookies and try again

### 7.8 502 Bad Gateway / Agent Connection Failed

1. SSH to VPS: `pm2 status` → both processes should be "online"
2. Test bridge: `curl -X POST http://localhost:8081/agents/connect -H "Content-Type: application/json" -d '{"agentId":"main"}'`
3. Check logs: `pm2 logs mcc-bridge --lines 50`
4. Check firewall: `sudo ufw status | grep -E "80|443|8081"`

---

## 8. Self-Diagnosis Prompts

Copy-paste these into any AI assistant (ChatGPT, Claude, etc.) to
diagnose specific issues.  Replace the placeholders with your actual
error messages.

### Build Failure

> I'm deploying a Next.js 15.5.2 app to Cloudflare Pages.  The build
> fails with this error:
>
> ```
> PASTE YOUR FULL ERROR HERE
> ```
>
> The app uses edge runtime (`export const runtime = "edge"`) and
> accesses Cloudflare D1/R2/KV bindings via
> `globalThis[Symbol.for("__cloudflare-request-context__")]`.
>
> What's the fix?  Show me the exact code change.

### D1 Not Working

> My Next.js app deployed to Cloudflare Pages can't connect to D1.
> The `/api/health` endpoint shows `d1: { ok: false, configured: false }`.
>
> My code reads D1 like this:
> ```typescript
> const sym = Symbol.for("__cloudflare-request-context__");
> const ctx = globalThis[sym];
> const db = ctx?.env?.DB;
> ```
>
> I've created the D1 database with `wrangler d1 create mcc-store`.
> What am I missing?  Walk me through the Cloudflare Pages dashboard
> steps to configure the D1 binding.

### Runtime 500 Error

> My Cloudflare Pages Next.js app returns 500 on API routes.  The route
> file is:
>
> ```
> PASTE YOUR ROUTE FILE HERE
> ```
>
> The build succeeds but the route fails at runtime.  How do I debug
> this?  What should I check in the Cloudflare dashboard?

### VPS Bridge Not Connecting

> I have a Next.js dashboard on Cloudflare Pages and a Python bridge
> (`bridge.py`) on my VPS at port 8081.  The bridge runs behind Caddy
> at `https://bridge.mydomain.com`.
>
> The dashboard shows "Failed to connect to AI agents".
>
> How do I troubleshoot the connection?  What should I check on the
> VPS, in the bridge logs, and in the Cloudflare environment variables?

### New Route Type Error

> I'm adding a new API route to my Next.js 15.5.2 app deployed on
> Cloudflare Pages (edge runtime).  The route has dynamic params.
>
> Show me the correct boilerplate for a route at
> `app/api/[something]/route.ts` that:
> 1. Uses edge runtime
> 2. Reads D1 via the globalThis symbol pattern
> 3. Has properly typed params for Next.js 15
> 4. Uses auth wrappers (withReadAuth / withMutatingAuth)

---

## Quick Reference

### Key URLs After Deployment

| URL | What It Does |
|-----|-------------|
| `/api/health` | Public health check — shows D1, R2, VPS, cron status |
| `/api/debug/d1` | Tests D1 connection directly |
| `/api/diagnostics` | Full env + binding status (requires login) |
| `/api/ping` | Simple ping test |

### Key Commands

| Task | Command |
|------|---------|
| Build locally | `cd web && npm run build` |
| Type-check | `npx tsc --noEmit` |
| Lint | `npm run lint` |
| Apply D1 schema | `wrangler d1 execute mcc-store --file=./cloudflare/d1-schema.sql` |
| List D1 databases | `wrangler d1 list` |
| Query D1 directly | `wrangler d1 execute mcc-store --command="SELECT COUNT(*) FROM sessions"` |
| VPS — check status | `pm2 status` |
| VPS — view logs | `pm2 logs` |
| VPS — restart all | `pm2 restart all` |
| VPS — update code | `git pull && cd web && npm install && npm run build && pm2 restart mcc-dashboard` |

### Cloudflare Pages Binding Checklist

| Binding Type | Variable Name | Resource |
|-------------|---------------|----------|
| D1 database | `DB` | `mcc-store` |
| KV namespace | `CACHE` | Your CACHE namespace |
| R2 bucket | `FILES` | `mcc-files` |
| Workers AI | `AI` | *(auto-configured)* |

### Environment Variable Checklist

| Variable | Required | Where to Set |
|----------|----------|-------------|
| `MCC_PASSWORD` | ✅ Yes | Pages → Settings → Environment Variables |
| `MCC_COOKIE_SIGNING_SECRET` | ✅ Yes | Pages → Settings → Environment Variables |
| `NEXT_PUBLIC_API_BASE` | ✅ Yes | Pages → Settings → Environment Variables |
| `MCC_VPS_SSE_URL` | If using VPS | Pages → Settings → Environment Variables |
| `MCC_VPS_CONNECT_URL` | If using VPS | Pages → Settings → Environment Variables |
| `MCC_VPS_HEARTBEAT_URL` | If using VPS | Pages → Settings → Environment Variables |
| `MCC_VPS_SCAN_URL` | If using VPS | Pages → Settings → Environment Variables |
| `MCC_RUNNER_TOKEN` | Optional | Pages → Settings → Environment Variables |
| `CRON_SECRET` | Optional | Pages → Settings → Environment Variables |

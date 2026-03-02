// PM2 process manager config — keeps the dashboard and bridge alive 24/7
// on your VPS even after crashes or reboots.
//
// ── BEFORE YOU START ────────────────────────────────────────────────────────
// Sensitive secrets (MCC_PASSWORD, MCC_COOKIE_SIGNING_SECRET) must be set in
// the shell environment BEFORE starting PM2 — do NOT hardcode them here since
// this file is committed to git.
//
// Quickest way: create /home/openclaw/.env.secrets with:
//   export MCC_PASSWORD="your-strong-password"
//   export MCC_COOKIE_SIGNING_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
//
// Then load it and start PM2 in one command:
//   source /home/openclaw/.env.secrets && pm2 start vps/pm2.config.js
//
// ── INSTALL & RUN ────────────────────────────────────────────────────────────
// Install:  npm install -g pm2
// Start:    source ~/.env.secrets && pm2 start vps/pm2.config.js
// Save:     pm2 save          (persists process list across reboots)
// Boot:     pm2 startup       (follow the printed command to enable autostart)
//
// Logs:     pm2 logs
// Status:   pm2 status
// Restart:  pm2 restart all

module.exports = {
  apps: [
    // ── 1. MCC Dashboard (Next.js) ────────────────────────────────
    {
      name: "mcc-dashboard",
      cwd: "/home/openclaw/my-control-center/web",
      script: "node_modules/.bin/next",
      args: "start -p 3000",
      interpreter: "none",        // next is already a Node.js binary wrapper

      // Non-sensitive env vars only.
      // MCC_PASSWORD and MCC_COOKIE_SIGNING_SECRET are read from the shell
      // environment (set via `source ~/.env.secrets` before `pm2 start`).
      env: {
        NODE_ENV: "production",

        // ── API base: stays /api so Next.js routes the calls itself ─
        NEXT_PUBLIC_API_BASE: "/api",

        // ── VPS bridge — localhost because bridge.py runs on same box ─
        MCC_VPS_SSE_URL: "http://localhost:8081/chat/stream",
        MCC_VPS_CONNECT_URL: "http://localhost:8081/agents/connect",
        MCC_VPS_HEARTBEAT_URL: "http://localhost:8081/agents/heartbeat",
        MCC_VPS_SCAN_URL: "http://localhost:8081/agents/scan",
      },

      // Restart policy
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,        // 5 s between restarts

      // Logs
      out_file: "/home/openclaw/logs/mcc-dashboard.log",
      error_file: "/home/openclaw/logs/mcc-dashboard-error.log",
      merge_logs: true,
    },

    // ── 2. MCC Bridge (Python) ────────────────────────────────────
    // Translates dashboard API calls → OpenClaw CLI commands.
    {
      name: "mcc-bridge",
      cwd: "/home/openclaw/my-control-center/vps",
      script: "bridge.py",
      interpreter: "/usr/bin/python3",

      env: {
        MCC_PORT: "8081",
        MCC_AGENTS_DIR: "/home/openclaw/.openclaw/agents",
        MCC_NODE_BIN: "/usr/bin/node",
        MCC_OPENCLAW_BIN: "/usr/lib/node_modules/openclaw/openclaw.mjs",
      },

      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,

      out_file: "/home/openclaw/logs/mcc-bridge.log",
      error_file: "/home/openclaw/logs/mcc-bridge-error.log",
      merge_logs: true,
    },
  ],
};

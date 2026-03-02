// PM2 process manager config — keeps the dashboard and bridge alive 24/7
// on your VPS even after crashes or reboots.
//
// Install:  npm install -g pm2
// Start:    pm2 start pm2.config.js
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

      // Env vars — never hardcode secrets; edit this file on the VPS only
      env: {
        NODE_ENV: "production",

        // ── Auth ───────────────────────────────────────────────────
        // Change both of these to strong random values.
        MCC_PASSWORD: "CHANGE_ME_strong_password",
        MCC_COOKIE_SIGNING_SECRET: "CHANGE_ME_random_64char_secret",

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

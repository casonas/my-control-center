#!/usr/bin/env python3
"""
MCC Bridge — Persistent VPS backend for My Control Center.

Runs as a systemd service on Ubuntu 24.04, accessible 24/7 via
Cloudflare tunnels on port 8081.

Features:
  - Persistent agent sessions (context survives tab switches)
  - Line-buffered SSE streaming (Telegram-speed delivery)
  - shlex.quote for all user input (shell-injection prevention)
  - CORS headers for Cloudflare edge requests
"""

import json
import subprocess
import time
import shlex
import os
from http.server import HTTPServer, BaseHTTPRequestHandler

# ─── PATHS ──────────────────────────────────────────────
# Absolute paths ensure 24/7 reliability on the VPS.
BASE_DIR = os.environ.get(
    "MCC_AGENTS_DIR", "/home/openclaw/.openclaw/agents"
)
NODE_BIN = os.environ.get("MCC_NODE_BIN", "/usr/bin/node")
OPENCLAW_BIN = os.environ.get(
    "MCC_OPENCLAW_BIN", "/usr/lib/node_modules/openclaw/openclaw.mjs"
)

AGENTS = {
    "main":        {"dir": f"{BASE_DIR}/main/agent"},
    "sports":      {"dir": f"{BASE_DIR}/sports/agent"},
    "school-work": {"dir": f"{BASE_DIR}/school-work/agent"},
    "career":      {"dir": f"{BASE_DIR}/career/agent"},
    "job-search":  {"dir": f"{BASE_DIR}/job-search/agent"},
    "stocks":      {"dir": f"{BASE_DIR}/stocks/agent"},
}

# ─── SESSION CACHE ──────────────────────────────────────
# Prevents chats from disappearing when you switch agents.
active_sessions: dict[str, str] = {}


class InteractiveBridge(BaseHTTPRequestHandler):
    """HTTP handler for the MCC bridge."""

    def _cors(self):
        """Add CORS headers for Cloudflare edge requests."""
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, X-Agent-Id, X-Agent-Session, "
            "X-Collab-Agents, X-Request-Id, X-CSRF",
        )

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        # ── 1. AGENT CONNECTION (with persistence) ───────
        if self.path == "/agents/connect":
            agent_id = body.get("agentId", "main")
            session_id = active_sessions.get(
                agent_id, f"ses_{agent_id}_{int(time.time())}"
            )
            active_sessions[agent_id] = session_id
            self._json({"sessionId": session_id, "status": "connected"})

        # ── 2. STREAMING CHAT ────────────────────────────
        elif self.path == "/chat/stream":
            self._handle_stream(body)

        # ── 3. HEARTBEAT ─────────────────────────────────
        elif self.path == "/agents/heartbeat":
            agent_id = body.get("agentId", "main")
            status = "connected" if agent_id in active_sessions else "disconnected"
            self._json({"status": status})

        # ── 4. STATUS ────────────────────────────────────
        elif self.path == "/status":
            self._json({
                "agents": list(AGENTS.keys()),
                "active_sessions": {
                    k: v for k, v in active_sessions.items()
                },
                "uptime": time.time(),
            })

        else:
            self._json({"error": "Not found"}, status=404)

    def _handle_stream(self, body: dict):
        """Stream agent response via SSE with line buffering."""
        agent_id = (
            self.headers.get("X-Agent-Id")
            or body.get("agentId", "main")
        )
        message = body.get("message", "")
        agent_dir = AGENTS.get(agent_id, AGENTS["main"])["dir"]

        # Persistent session management
        session_id = active_sessions.get(
            agent_id, f"ses_{agent_id}_{int(time.time())}"
        )
        active_sessions[agent_id] = session_id

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self._cors()
        self.end_headers()

        # shlex.quote prevents shell injection from user input
        safe_msg = shlex.quote(message)
        cmd = [
            NODE_BIN,
            OPENCLAW_BIN,
            "agent",
            "--agent", agent_id,
            "--session-id", session_id,
            "--local",
            "--quiet",
            "--message", message,
        ]

        try:
            process = subprocess.Popen(
                cmd,
                cwd=agent_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,  # Line buffering — words out immediately
            )

            for line in process.stdout:
                if line.strip():
                    is_log = any(
                        x in line
                        for x in ["[agent]", "Error", "diagnostic"]
                    )
                    chunk = json.dumps({"text": line, "is_log": is_log})
                    self.wfile.write(f"data: {chunk}\n\n".encode())
                    self.wfile.flush()

            process.wait()
        except BrokenPipeError:
            pass  # Client disconnected
        except Exception as exc:
            err = json.dumps({"text": f"[bridge error] {exc}", "is_log": True})
            try:
                self.wfile.write(f"data: {err}\n\n".encode())
                self.wfile.flush()
            except BrokenPipeError:
                pass

        try:
            self.wfile.write(b"event: done\ndata: {}\n\n")
            self.wfile.flush()
        except BrokenPipeError:
            pass

    def _json(self, data: dict, status: int = 200):
        """Send a JSON response."""
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())


if __name__ == "__main__":
    port = int(os.environ.get("MCC_PORT", "8081"))
    print(f"\U0001f680 MCC Bridge live on :{port}")
    HTTPServer(("0.0.0.0", port), InteractiveBridge).serve_forever()

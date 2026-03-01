// lib/api.ts (cookie-based auth)

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8080";

// Helper to build URLs safely
function url(path: string) {
  // Ensure leading slash
  const p = path.startsWith("/") ? path : `/${path}`;
  // If API_BASE already ends with /api, don't double it
  // Recommended: set NEXT_PUBLIC_API_BASE to "https://dashboard.my-control-center.com"
  // and always call with "/api/..."
  return `${API_BASE}${p}`;
}

async function readError(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    // Sometimes backend returns JSON error bodies
    const j = JSON.parse(text);
    return JSON.stringify(j);
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

/**
 * Core fetch wrapper:
 * - Sends cookies (credentials: "include")
 * - Adds JSON headers when needed
 */
export async function apiFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(url(path), {
    ...init,
    credentials: "include", // ✅ cookie session
    headers: {
      ...(init.headers || {}),
    },
  });

  if (!res.ok) throw new Error(await readError(res));
  return res;
}

export async function apiGet<T = any>(path: string): Promise<T> {
  const res = await apiFetch(path, { method: "GET" });
  return res.json();
}

export async function apiPost<T = any>(path: string, body: any): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

/**
 * Auth helpers
 * Your backend currently returns {"authed": false} when not logged in.
 */
export async function authMe(): Promise<{ authed: boolean }> {
  return apiGet("/api/auth/me");
}

export async function login(password: string, rememberDays = 180) {
  return apiPost("/api/auth/login", {
    password,
    remember_days: rememberDays,
  });
}

export async function logout() {
  return apiPost("/api/auth/logout", {});
}

/**
 * Streams SSE from /api/chat/stream and calls onDelta(text)
 * Preserves your event: start/delta/done approach.
 */
export async function streamChat(
  body: any,
  onDelta: (t: string) => void,
  onEvent?: (event: string, data: any) => void
) {
  const res = await apiFetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.body) throw new Error("No response body for stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by a blank line
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";

    for (const chunk of chunks) {
      const lines = chunk.split("\n").filter(Boolean);

      const event =
        lines.find((l) => l.startsWith("event:"))?.slice(6).trim() || "message";

      const dataLine = lines.find((l) => l.startsWith("data:"))?.slice(5).trim();
      if (!dataLine) continue;

      let data: any = dataLine;
      try {
        data = JSON.parse(dataLine);
      } catch {
        // keep as string
      }

      onEvent?.(event, data);

      if (event === "delta" && data?.text) onDelta(data.text);
    }
  }
}
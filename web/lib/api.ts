// web/lib/api.ts (cookie-based auth, same-origin by default)

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "/api";

function buildUrl(path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${p}`;
}

async function readError(res: Response) {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text().catch(() => "");
  if (ct.includes("application/json")) {
    try {
      const j = JSON.parse(text);
      return j?.detail ? String(j.detail) : JSON.stringify(j);
    } catch {
      return text || `HTTP ${res.status}`;
    }
  }
  return text || `HTTP ${res.status}`;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(buildUrl(path), {
    ...init,
    credentials: "include",
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ---- Auth ----
export async function authMe(): Promise<{ authed: boolean }> {
  return apiGet("/auth/me");
}

export async function login(password: string, rememberDays = 180) {
  return apiPost("/auth/login", { password, remember_days: rememberDays });
}

export async function logout() {
  return apiPost("/auth/logout", {});
}

// ---- SSE streaming ----
export async function streamChat(
  body: any,
  onDelta: (t: string) => void,
  onEvent?: (event: string, data: any) => void
) {
  const res = await apiFetch("/chat/stream", {
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
      } catch {}

      onEvent?.(event, data);

      if (event === "delta" && data?.text) onDelta(data.text);
    }
  }
}

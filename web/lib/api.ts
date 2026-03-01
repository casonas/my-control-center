// web/lib/api.ts (cookie-based auth, same-origin by default)

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "/api";

function buildUrl(path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${p}`;
}

type AuthMeApiResponse = {
  ok?: boolean;
  authenticated?: boolean;
  authed?: boolean;
  user?: { id: string; username: string };
  csrfToken?: string;
  error?: string;
};

export type AuthState = {
  authed: boolean;
  user?: { id: string; username: string };
  csrfToken?: string;
};

// --- CSRF token storage (memory + localStorage) ---
const CSRF_LS_KEY = "mcc.csrf";
let csrfMem: string | null = null;

function getCsrfToken(): string | null {
  if (csrfMem) return csrfMem;
  try {
    const v = localStorage.getItem(CSRF_LS_KEY);
    if (v) csrfMem = v;
    return v;
  } catch {
    return null;
  }
}

function setCsrfToken(token: string | null) {
  csrfMem = token;
  try {
    if (!token) localStorage.removeItem(CSRF_LS_KEY);
    else localStorage.setItem(CSRF_LS_KEY, token);
  } catch {
    // ignore storage errors
  }
}

function isMutating(method?: string) {
  const m = (method || "GET").toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
}

async function readError(res: Response) {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text().catch(() => "");
  if (ct.includes("application/json")) {
    try {
      const j = JSON.parse(text);
      return j?.detail ? String(j.detail) : j?.error ? String(j.error) : JSON.stringify(j);
    } catch {
      return text || `HTTP ${res.status}`;
    }
  }
  return text || `HTTP ${res.status}`;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || {});

  // Always include cookies
  // For mutating requests, include CSRF header if we have it.
  if (isMutating(method)) {
    const csrf = getCsrfToken();
    if (csrf) headers.set("X-CSRF", csrf);
  }

  const res = await fetch(buildUrl(path), {
    ...init,
    method,
    credentials: "include",
    headers,
  });

  if (!res.ok) throw new Error(await readError(res));
  return res;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  // For GETs that depend on auth/cookies, we generally want fresh data.
  // Individual calls can override cache in init if needed.
  const res = await apiFetch(path, { method: "GET", cache: "no-store" });
  return res.json();
}

export async function apiPost<T = unknown>(
  path: string,
  body: Record<string, unknown>,
  init: RequestInit = {}
): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    body: JSON.stringify(body),
    ...init,
  });
  return res.json();
}

// ---- Auth ----
// Returns a normalized AuthState your UI expects.
export async function authMe(): Promise<AuthState> {
  const res = await fetch(buildUrl("/auth/me"), {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: {
      // Helps avoid intermediaries caching in weird environments
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  const data = (await res.json().catch(() => null)) as AuthMeApiResponse | null;

  // If your /auth/me returns 200 always, res.ok will be true.
  // If it returns 401, we treat that as not authed.
  if (!res.ok || !data) {
    setCsrfToken(null);
    return { authed: false };
  }

  const authed =
    data.authed === true || data.authenticated === true;

  if (!authed) {
    setCsrfToken(null);
    return { authed: false };
  }

  if (typeof data.csrfToken === "string" && data.csrfToken) {
    setCsrfToken(data.csrfToken);
  }

  return {
    authed: true,
    user: data.user,
    csrfToken: data.csrfToken,
  };
}

export async function login(password: string, rememberDays = 180) {
  // Login itself should not require CSRF (no session yet).
  const res = await fetch(buildUrl("/auth/login"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, remember_days: rememberDays }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Login failed");

  // Immediately fetch /auth/me to capture csrfToken and store it.
  await authMe();
  return data;
}

export async function logout() {
  // This POST will automatically include X-CSRF via apiPost/apiFetch.
  const out = await apiPost("/auth/logout", {});

  // Clear local csrf no matter what
  setCsrfToken(null);

  return out;
}

// ---- SSE streaming ----
export async function streamChat(
  body: Record<string, unknown>,
  onDelta: (t: string) => void,
  onEvent?: (event: string, data: unknown) => void,
  agentHeaders?: { agentId?: string; sessionId?: string; collaborators?: string[] }
) {
  // Build extra headers for agent routing (avoids body-parsing on server)
  const extraHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (agentHeaders?.agentId) extraHeaders["X-Agent-Id"] = agentHeaders.agentId;
  if (agentHeaders?.sessionId) extraHeaders["X-Agent-Session"] = agentHeaders.sessionId;
  if (agentHeaders?.collaborators?.length) {
    extraHeaders["X-Collab-Agents"] = agentHeaders.collaborators.join(",");
  }

  const res = await apiFetch("/chat/stream", {
    method: "POST",
    headers: extraHeaders,
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

      let data: unknown = dataLine;
      try {
        data = JSON.parse(dataLine);
      } catch {
        /* not JSON, keep as string */
      }

      onEvent?.(event, data);

      if (
        event === "delta" &&
        typeof data === "object" &&
        data !== null &&
        "text" in data &&
        typeof (data as { text: unknown }).text === "string"
      ) {
        onDelta((data as { text: string }).text);
      }
    }
  }
}

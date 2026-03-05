export type HttpRequestOptions = {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  userAgent?: string;
};

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 600;

export async function httpRequest(url: string, opts: HttpRequestOptions = {}): Promise<Response> {
  const {
    method = "GET",
    headers,
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    userAgent = "MCC-HTTP/1.0",
  } = opts;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const reqHeaders = new Headers(headers ?? {});
      if (!reqHeaders.has("User-Agent")) reqHeaders.set("User-Agent", userAgent);
      const res = await fetch(url, {
        method,
        headers: reqHeaders,
        body,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(retryDelayMs * (attempt + 1));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function httpGetText(url: string, opts?: HttpRequestOptions): Promise<string> {
  const res = await httpRequest(url, opts);
  return res.text();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


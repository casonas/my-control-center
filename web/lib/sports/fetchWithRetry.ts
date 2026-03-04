// web/lib/sports/fetchWithRetry.ts — Reliable HTTP fetch with timeout + retry

const DEFAULT_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 1500;

/**
 * Fetch with timeout + single retry on failure.
 * Returns null on permanent failure (logs but does not throw).
 */
export async function fetchWithRetry(
  url: string,
  opts?: { timeoutMs?: number; retries?: number }
): Promise<string | null> {
  const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts?.retries ?? 1;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "MCC-Sports/1.0" },
      });
      clearTimeout(timer);
      if (!res.ok) {
        console.warn(`[sports] ${url} returned ${res.status}`);
        if (attempt < maxRetries) {
          await delay(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        return null;
      }
      return await res.text();
    } catch (err) {
      console.warn(`[sports] fetch ${url} attempt ${attempt + 1} failed:`, err instanceof Error ? err.message : err);
      if (attempt < maxRetries) {
        await delay(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }
  return null;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

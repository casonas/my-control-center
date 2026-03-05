// web/lib/sports/fetchWithRetry.ts - Reliable HTTP fetch with timeout + retry

import { httpGetText } from "@/lib/http";

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Fetch with timeout + retries.
 * Returns null on permanent failure (logs but does not throw).
 */
export async function fetchWithRetry(
  url: string,
  opts?: { timeoutMs?: number; retries?: number }
): Promise<string | null> {
  const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts?.retries ?? 1;

  try {
    return await httpGetText(url, {
      timeoutMs: timeout,
      retries,
      retryDelayMs: 1200,
      userAgent: "MCC-Sports/1.0",
    });
  } catch (err) {
    console.warn(`[sports] fetch ${url} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

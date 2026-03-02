// web/lib/readAuth.ts — Auth check for GET routes (no CSRF required)

import { getSession } from "@/lib/auth";

export type ReadAuthContext = {
  userId: string;
};

/**
 * Convenience wrapper for GET routes that need auth but not CSRF.
 * Returns JSON errors consistently on auth failure.
 */
export async function withReadAuth(
  handler: (ctx: ReadAuthContext) => Promise<Response>
): Promise<Response> {
  try {
    const session = await getSession();
    if (!session) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    return await handler({ userId: session.userId });
  } catch (e: unknown) {
    console.error("withReadAuth unexpected error:", e);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

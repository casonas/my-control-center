export const runtime = "edge";
// web/app/api/conversations/route.ts

import { withMutatingAuth } from "@/lib/mutatingAuth";

export async function POST(req: Request) {
  return withMutatingAuth(req, async () => {
    // At this point:
    // - valid session cookie exists
    // - Origin is allowed
    // - X-CSRF matches sessions.csrf_token

    return Response.json({
      conversationId: "mock-conv-" + Date.now().toString(36),
    });
  });
}

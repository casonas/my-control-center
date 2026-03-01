export const runtime = "edge";

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    conversationId: "mock-conv-" + Date.now().toString(36),
  });
}

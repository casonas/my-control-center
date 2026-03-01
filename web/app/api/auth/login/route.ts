export const runtime = "edge";

import { NextResponse } from "next/server";
import { createSession, verifyPassword } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { password } = body;

    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    if (!(await verifyPassword(password))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const { csrfToken } = await createSession();
    return NextResponse.json({ ok: true, csrfToken });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}


import { NextResponse } from "next/server";
import { BUILTIN_AGENTS } from "@/lib/agents";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parentId = url.searchParams.get("parent");

  // If ?parent=<id> is provided, return only sub-agents of that parent.
  // The client-side registry handles custom agents; the API returns built-ins
  // so the VPS runner and external callers always have the canonical list.
  const agents = parentId
    ? BUILTIN_AGENTS.filter((a) => a.parentId === parentId)
    : BUILTIN_AGENTS;

  return NextResponse.json({ agents });
}

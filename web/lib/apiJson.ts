export function apiJson(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
    ...(init ?? {}),
  });
}

export function apiError(error: string, status = 400, extra?: Record<string, unknown>): Response {
  return apiJson(
    {
      ok: false,
      error,
      ...(extra ?? {}),
    },
    { status },
  );
}


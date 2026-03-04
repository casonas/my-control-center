export const runtime = "edge";

import { withMutatingAuth } from "@/lib/mutatingAuth";
import { getD1 } from "@/lib/d1";
import { getCfEnv } from "@/lib/cloudflare";

const RATE_LIMIT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PROPS_FOR_LLM = 50;

interface AiTextGeneration {
  run(
    model: string,
    input: { messages: { role: string; content: string }[] }
  ): Promise<{ response?: string }>;
}

/** Get the Workers AI binding from Cloudflare env */
function getAI(): AiTextGeneration | null {
  const env = getCfEnv();
  if (!env) return null;
  return (env["AI"] as AiTextGeneration) ?? null;
}

interface PropRow {
  player: string;
  market: string;
  line: number | null;
  odds: number | null;
  edge_score: number;
  book: string | null;
  event_id: string | null;
}

interface PickLeg {
  player: string;
  market: string;
  line: number | null;
  pick: string;
  confidence: number;
  reason: string;
}

interface PicksOutput {
  top_plays: PickLeg[];
  safe_slip: PickLeg[];
  aggressive_slip: PickLeg[];
}

function buildPrompt(props: PropRow[]): string {
  const compact = props.map((p) =>
    [p.player, p.market, p.line ?? "-", p.odds ?? "-", p.edge_score, p.book ?? "-", p.event_id ?? "-"].join(",")
  );

  return `You are an NBA sports betting analyst. Given these player props (player,market,line,odds,edge_score,book,event):
${compact.join("\n")}

Return ONLY valid JSON (no markdown, no explanation outside JSON) with this exact structure:
{
  "top_plays": [up to 3 best picks],
  "safe_slip": [exactly 5 legs for a safe parlay],
  "aggressive_slip": [exactly 5 legs for an aggressive parlay]
}

Each leg must be: {"player":"...","market":"...","line":number_or_null,"pick":"over|under","confidence":0.0-1.0,"reason":"short reason"}

Pick based on edge_score (higher=better), reasonable lines, and player consistency. Safe slip should have legs with confidence >= 0.6. Aggressive slip can use lower confidence but higher upside.`;
}

function parsePicksResponse(raw: string): PicksOutput | null {
  try {
    // Try to extract JSON from possible markdown wrapping
    let jsonStr = raw.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    const parsed = JSON.parse(jsonStr) as PicksOutput;

    // Validate structure
    if (!Array.isArray(parsed.top_plays)) return null;
    if (!Array.isArray(parsed.safe_slip)) return null;
    if (!Array.isArray(parsed.aggressive_slip)) return null;

    return parsed;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  return withMutatingAuth(req, async ({ session }) => {
    const db = getD1();
    if (!db)
      return Response.json({ ok: false, error: "D1 not available" }, { status: 500 });

    let body: { league?: string; force?: boolean };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const userId = session.user_id;
    const league = (body.league ?? "nba").trim().toLowerCase();
    const force = body.force === true;
    const now = new Date().toISOString();

    // 1. Fetch active props and latest board_hash
    const activeProps = await db
      .prepare(
        `SELECT player, market, line, odds, edge_score, book, event_id
         FROM sports_props_board
         WHERE user_id = ? AND league = ? AND status = 'active'
         ORDER BY edge_score DESC
         LIMIT ?`
      )
      .bind(userId, league, MAX_PROPS_FOR_LLM)
      .all<PropRow>();

    const rows = activeProps.results || [];
    if (rows.length === 0) {
      return Response.json({ ok: false, reason: "no_active_props" });
    }

    // Get the latest board_hash
    const hashRow = await db
      .prepare(
        `SELECT board_hash FROM sports_props_board
         WHERE user_id = ? AND league = ? AND status = 'active'
         ORDER BY fetched_at DESC LIMIT 1`
      )
      .bind(userId, league)
      .first<{ board_hash: string }>();

    const boardHash = hashRow?.board_hash ?? "unknown";

    // 2. Check cache: do we already have all 3 card_types for this board_hash?
    const cachedCards = await db
      .prepare(
        `SELECT card_type, payload_json, rationale_md, created_at
         FROM sports_pick_cards
         WHERE user_id = ? AND league = ? AND board_hash = ?
         ORDER BY created_at DESC`
      )
      .bind(userId, league, boardHash)
      .all<{ card_type: string; payload_json: string; rationale_md: string | null; created_at: string }>();

    const cachedByType: Record<string, { payload_json: string; rationale_md: string | null; created_at: string }> = {};
    for (const c of cachedCards.results || []) {
      if (!cachedByType[c.card_type]) cachedByType[c.card_type] = c;
    }

    const allCached =
      cachedByType["top_plays"] && cachedByType["safe_slip"] && cachedByType["aggressive_slip"];

    if (allCached && !force) {
      // Log cache hit
      await db
        .prepare(
          `INSERT INTO sports_generation_log (id, user_id, league, board_hash, action, token_estimate, created_at)
           VALUES (?, ?, ?, ?, 'cache_hit', 0, ?)`
        )
        .bind(crypto.randomUUID(), userId, league, boardHash, now)
        .run();

      return Response.json({
        ok: true,
        cached: true,
        board_hash: boardHash,
        cards: {
          top_plays: JSON.parse(cachedByType["top_plays"].payload_json),
          safe_slip: JSON.parse(cachedByType["safe_slip"].payload_json),
          aggressive_slip: JSON.parse(cachedByType["aggressive_slip"].payload_json),
        },
      });
    }

    // 3. Rate limit: check last generation timestamp
    if (!force) {
      const lastGen = await db
        .prepare(
          `SELECT created_at FROM sports_generation_log
           WHERE user_id = ? AND league = ? AND action = 'generated'
           ORDER BY created_at DESC LIMIT 1`
        )
        .bind(userId, league)
        .first<{ created_at: string }>();

      if (lastGen) {
        const elapsed = Date.now() - new Date(lastGen.created_at).getTime();
        if (elapsed < RATE_LIMIT_MS) {
          await db
            .prepare(
              `INSERT INTO sports_generation_log (id, user_id, league, board_hash, action, token_estimate, created_at)
               VALUES (?, ?, ?, ?, 'skipped_rate_limit', 0, ?)`
            )
            .bind(crypto.randomUUID(), userId, league, boardHash, now)
            .run();

          return Response.json({
            ok: false,
            reason: "skipped_rate_limit",
            retry_after_ms: RATE_LIMIT_MS - elapsed,
          });
        }
      }
    }

    // 4. Call LLM via Workers AI binding
    const ai = getAI();
    if (!ai) {
      return Response.json({
        ok: false,
        reason: "ai_unavailable",
        error: "Workers AI binding not available. Ensure [ai] binding is configured.",
      });
    }

    const startMs = Date.now();
    const prompt = buildPrompt(rows);
    let picksOutput: PicksOutput | null = null;

    try {
      const aiResult = await ai.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          { role: "system", content: "You are an NBA betting analyst. Respond only with valid JSON." },
          { role: "user", content: prompt },
        ],
      });

      picksOutput = parsePicksResponse(aiResult.response ?? "");
    } catch (e) {
      console.error("[picks/generate] AI error:", e);
      return Response.json({
        ok: false,
        reason: "ai_error",
        error: e instanceof Error ? e.message : String(e),
      });
    }

    if (!picksOutput) {
      return Response.json({
        ok: false,
        reason: "parse_error",
        error: "LLM returned invalid JSON structure",
      });
    }

    const durationMs = Date.now() - startMs;
    // ~4 chars per token is a rough approximation for English text
    const CHARS_PER_TOKEN = 4;
    const tokenEstimate = Math.round(prompt.length / CHARS_PER_TOKEN + JSON.stringify(picksOutput).length / CHARS_PER_TOKEN);

    // 5. Store 3 card rows
    const cardTypes: (keyof PicksOutput)[] = ["top_plays", "safe_slip", "aggressive_slip"];
    for (const cardType of cardTypes) {
      await db
        .prepare(
          `INSERT INTO sports_pick_cards
           (id, user_id, league, board_hash, model, card_type, payload_json, rationale_md, cached, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
        )
        .bind(
          crypto.randomUUID(),
          userId,
          league,
          boardHash,
          "@cf/meta/llama-3.1-8b-instruct",
          cardType,
          JSON.stringify(picksOutput[cardType]),
          null,
          now
        )
        .run();
    }

    // 6. Log generation
    await db
      .prepare(
        `INSERT INTO sports_generation_log (id, user_id, league, board_hash, action, token_estimate, created_at)
         VALUES (?, ?, ?, ?, 'generated', ?, ?)`
      )
      .bind(crypto.randomUUID(), userId, league, boardHash, tokenEstimate, now)
      .run();

    return Response.json({
      ok: true,
      cached: false,
      board_hash: boardHash,
      duration_ms: durationMs,
      token_estimate: tokenEstimate,
      cards: {
        top_plays: picksOutput.top_plays,
        safe_slip: picksOutput.safe_slip,
        aggressive_slip: picksOutput.aggressive_slip,
      },
    });
  });
}

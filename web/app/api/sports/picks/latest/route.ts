export const runtime = "edge";

import { withReadAuth } from "@/lib/readAuth";
import { getD1 } from "@/lib/d1";

export async function GET(req: Request) {
  return withReadAuth(async ({ userId }) => {
    const db = getD1();
    if (!db) return Response.json({ cards: null, reason: "d1_unavailable" });

    const url = new URL(req.url);
    const league = url.searchParams.get("league") || "nba";

    try {
      // Get latest board_hash from active props
      let hashRow = await db
        .prepare(
          `SELECT board_hash FROM sports_props_board
           WHERE user_id = ? AND league = ?
           ORDER BY fetched_at DESC LIMIT 1`
        )
        .bind(userId, league)
        .first<{ board_hash: string }>();
      if (!hashRow && userId !== "owner") {
        hashRow = await db
          .prepare(
            `SELECT board_hash FROM sports_props_board
             WHERE user_id = ? AND league = ?
             ORDER BY fetched_at DESC LIMIT 1`
          )
          .bind("owner", league)
          .first<{ board_hash: string }>();
      }
      if (!hashRow) {
        hashRow = await db
          .prepare(
            `SELECT board_hash FROM sports_props_board
             WHERE league = ?
             ORDER BY fetched_at DESC LIMIT 1`
          )
          .bind(league)
          .first<{ board_hash: string }>();
      }

      if (!hashRow) {
        return Response.json({ cards: null, reason: "no_active_board" });
      }

      const boardHash = hashRow.board_hash;

      // Fetch all card types for this board_hash
      let cardsResult = await db
        .prepare(
          `SELECT card_type, payload_json, rationale_md, created_at, cached, model
           FROM sports_pick_cards
           WHERE user_id = ? AND league = ? AND board_hash = ?
           ORDER BY created_at DESC`
        )
        .bind(userId, league, boardHash)
        .all<{
          card_type: string;
          payload_json: string;
          rationale_md: string | null;
          created_at: string;
          cached: number;
          model: string | null;
        }>();
      if ((cardsResult.results || []).length === 0 && userId !== "owner") {
        cardsResult = await db
          .prepare(
            `SELECT card_type, payload_json, rationale_md, created_at, cached, model
             FROM sports_pick_cards
             WHERE user_id = ? AND league = ? AND board_hash = ?
             ORDER BY created_at DESC`
          )
          .bind("owner", league, boardHash)
          .all<{
            card_type: string;
            payload_json: string;
            rationale_md: string | null;
            created_at: string;
            cached: number;
            model: string | null;
          }>();
      }
      if ((cardsResult.results || []).length === 0) {
        cardsResult = await db
          .prepare(
            `SELECT card_type, payload_json, rationale_md, created_at, cached, model
             FROM sports_pick_cards
             WHERE league = ? AND board_hash = ?
             ORDER BY created_at DESC`
          )
          .bind(league, boardHash)
          .all<{
            card_type: string;
            payload_json: string;
            rationale_md: string | null;
            created_at: string;
            cached: number;
            model: string | null;
          }>();
      }

      const byType: Record<string, unknown> = {};
      let createdAt: string | null = null;
      let model: string | null = null;

      for (const c of cardsResult.results || []) {
        if (!byType[c.card_type]) {
          try {
            byType[c.card_type] = JSON.parse(c.payload_json);
          } catch {
            byType[c.card_type] = [];
          }
          if (!createdAt) createdAt = c.created_at;
          if (!model) model = c.model;
        }
      }

      if (Object.keys(byType).length === 0) {
        const lastAction = await db
           .prepare(
             `SELECT action FROM sports_generation_log
              WHERE user_id = ? AND league = ? AND board_hash = ?
              ORDER BY created_at DESC LIMIT 1`
           )
           .bind(userId, league, boardHash)
           .first<{ action: string }>();
        
        return Response.json({
          cards: null,
          board_hash: boardHash,
          reason: "no_picks_generated",
          cached: lastAction?.action === "cache_hit",
        });
      }
        const lastAction = await db
          .prepare(
            `SELECT action FROM sports_generation_log
            WHERE user_id = ? AND league = ? AND board_hash = ?
            ORDER BY created_at DESC LIMIT 1`
         )
         .bind(userId, league, boardHash)
         .first<{ action: string }>();
      return Response.json({
        cards: byType,
        board_hash: boardHash,
        created_at: createdAt,
        model,
        cached: lastAction?.action === "cache_hit",
      });
    } catch {
      return Response.json({ cards: null, reason: "error" });
    }
  });
}

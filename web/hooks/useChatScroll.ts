import { useRef, useState, useEffect, useCallback } from "react";

const AT_BOTTOM_THRESHOLD = 50; // px

/**
 * useChatScroll — smart auto-scroll for a chat messages container.
 *
 * Returns:
 *   scrollRef       — attach to the scrollable messages <div>
 *   atBottom         — whether the user is near the bottom
 *   unreadCount      — messages arrived while user was scrolled up
 *   jumpToBottom()   — programmatic scroll-to-bottom + clear unread
 *   onNewMessage()   — call when a new assistant message starts
 *   onStreamDelta()  — call on every streaming token
 */
export function useChatScroll() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  // Use a ref for the "at bottom" flag so scroll-event and rAF
  // callbacks always read the latest value without re-renders.
  const atBottomRef = useRef(true);
  const rafPending = useRef(false);

  // ── Check whether the user is at the bottom ───────────
  const checkAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isBottom = gap <= AT_BOTTOM_THRESHOLD;
    atBottomRef.current = isBottom;
    setAtBottom(isBottom);
    if (isBottom) setUnreadCount(0);
  }, []);

  // ── Attach scroll listener ────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => checkAtBottom();
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [checkAtBottom]);

  // ── Smooth scroll to bottom ───────────────────────────
  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setUnreadCount(0);
    atBottomRef.current = true;
    setAtBottom(true);
  }, []);

  // ── Scroll to bottom instantly (for initial load / agent switch) ──
  // Uses rAF so the DOM has rendered new messages before we measure scrollHeight.
  const snapToBottom = useCallback(() => {
    const snap = () => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      atBottomRef.current = true;
      setAtBottom(true);
      setUnreadCount(0);
    };
    // Immediate attempt (covers already-rendered content)
    snap();
    // Post-render pass to catch React-batched state updates
    requestAnimationFrame(snap);
  }, []);

  // ── Call when a new assistant message bubble is created ──
  const onNewMessage = useCallback(() => {
    if (atBottomRef.current) {
      // Schedule one rAF scroll so the DOM has rendered the new node
      if (!rafPending.current) {
        rafPending.current = true;
        requestAnimationFrame(() => {
          rafPending.current = false;
          const el = scrollRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    } else {
      setUnreadCount((c) => c + 1);
    }
  }, []);

  // ── Call on every streaming delta token ─────────────────
  const onStreamDelta = useCallback(() => {
    if (atBottomRef.current) {
      if (!rafPending.current) {
        rafPending.current = true;
        requestAnimationFrame(() => {
          rafPending.current = false;
          const el = scrollRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    }
    // Don't increment unread on deltas — only on new messages
  }, []);

  return {
    scrollRef,
    atBottom,
    unreadCount,
    jumpToBottom,
    snapToBottom,
    onNewMessage,
    onStreamDelta,
  } as const;
}

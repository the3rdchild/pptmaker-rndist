"use client";

import { useCallback, useEffect, useRef } from "react";

// Cross-window sync between the audience-facing Present Mode window and the
// separate Presenter View window (PRD #50), plus the laser pointer/freehand
// annotation live tools (#41) that ride the same channel. BroadcastChannel
// is same-origin, same-browser only — exactly the scope needed here (no
// server round-trip, no real multi-user collab).
export type PresenterPoint = { x: number; y: number };

export type PresenterSyncMessage =
  | { type: "slide-change"; index: number }
  /** Presenter View announces itself on open so an already-running Present
   * Mode window can reply with where it currently is. */
  | { type: "ping" }
  | { type: "state"; index: number; total: number }
  /** x/y are normalized 0-1 within the slide's own box, so either window can
   * be a different physical size/zoom and the dot still lands correctly. */
  | { type: "laser"; x: number; y: number; visible: boolean }
  /** `done: false` while the stroke is still being drawn — the receiver
   * replaces its "in progress" preview with each successive points array
   * rather than diffing. `done: true` commits it as a finished stroke. */
  | { type: "annotation-stroke"; points: PresenterPoint[]; done: boolean }
  | { type: "annotation-clear" };

function presenterChannelName(deckId: string) {
  return `ppt-presenter-${deckId}`;
}

function createPresenterChannel(deckId: string): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }
  return new BroadcastChannel(presenterChannelName(deckId));
}

/** Opens (or subscribes to) the deck's presenter-sync channel. Returns a
 * `post` function; pass `onMessage` to also receive incoming messages. */
export function usePresenterChannel(
  deckId: string | null | undefined,
  onMessage?: (message: PresenterSyncMessage) => void,
) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!deckId) return;
    const channel = createPresenterChannel(deckId);
    channelRef.current = channel;
    if (!channel) return;

    const handleMessage = (event: MessageEvent<PresenterSyncMessage>) => {
      onMessageRef.current?.(event.data);
    };
    channel.addEventListener("message", handleMessage);
    return () => {
      channel.removeEventListener("message", handleMessage);
      channel.close();
      channelRef.current = null;
    };
  }, [deckId]);

  return useCallback((message: PresenterSyncMessage) => {
    channelRef.current?.postMessage(message);
  }, []);
}

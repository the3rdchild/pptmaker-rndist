"use client";

// Debounced autosave of the open deck back to the API.
//
// Three guarantees the plain debounce did not give:
//   - leaving the editor (a client-side navigation unmounts it) writes the
//     pending edit instead of cancelling it with the timer;
//   - closing or reloading the tab while an edit is unsaved asks first — a
//     keepalive request cannot carry it, since a deck with images is far over
//     the 64KB keepalive body limit;
//   - saves run one after another, so a slow older PUT can never land after a
//     newer one and leave the server holding the stale deck.

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { saveDeck } from "@/lib/api";
import type { PresentationData } from "@/store/presentationGeneration";

export type SaveState = "idle" | "pending" | "saving" | "saved";

type SaveBody = Parameters<typeof saveDeck>[2];

const DEBOUNCE_MS = 1500;

function bodyFor(data: PresentationData, deckThemeId: string | null): SaveBody {
  const title = data.title ?? "Untitled";
  return {
    title,
    payload: {
      title,
      slides: data.slides,
      // The font map (theme typefaces + uploaded fonts) is part of the deck —
      // dropping it here is what made uploaded/theme fonts vanish on reload.
      ...(data.fonts ? { fonts: data.fonts } : {}),
      // The theme generation resolved to, read back on load so
      // add_slide/regenerate_slide pin to the deck's real template.
      ...(deckThemeId ? { deckThemeId } : {}),
    },
  };
}

export function useDeckAutosave({
  presentationData,
  token,
  deckId,
  disabled,
  deckThemeIdRef,
}: {
  presentationData: PresentationData | null | undefined;
  token: string | null | undefined;
  deckId: string;
  /** Template mode saves explicitly to disk; an autosave would write
   *  half-finished layouts on every drag. */
  disabled: boolean;
  deckThemeIdRef: MutableRefObject<string | null>;
}): SaveState {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<SaveBody | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const isFirstChange = useRef(true);
  const mountedRef = useRef(true);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const body = pendingRef.current;
    if (!body || !token) return;
    pendingRef.current = null;
    if (mountedRef.current) setSaveState("saving");
    chainRef.current = chainRef.current.then(async () => {
      try {
        await saveDeck(token, deckId, body);
        if (mountedRef.current && !pendingRef.current) setSaveState("saved");
      } catch {
        // Non-critical here: the next edit retries with the full deck.
        if (mountedRef.current) setSaveState("pending");
      }
    });
  }, [token, deckId]);

  useEffect(() => {
    if (disabled || !presentationData || !token) return;
    // The first value is the deck as loaded — nothing to write back.
    if (isFirstChange.current) {
      isFirstChange.current = false;
      return;
    }
    pendingRef.current = bodyFor(presentationData, deckThemeIdRef.current);
    setSaveState("pending");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, DEBOUNCE_MS);
  }, [presentationData, token, disabled, flush, deckThemeIdRef]);

  // Unmount writes whatever the debounce was still holding.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      flushRef.current();
    };
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingRef.current) return;
      flushRef.current();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return saveState;
}

"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { saveDeck } from "@/lib/api";
import type { PresentationData } from "@/store/presentationGeneration";

export type SaveState = "idle" | "pending" | "saving" | "saved";
type SaveJob = { token: string; deckId: string; body: Parameters<typeof saveDeck>[2] };
const DEBOUNCE_MS = 1500;

function bodyFor(data: PresentationData, deckThemeId: string | null): SaveJob["body"] {
  const title = data.title ?? "Untitled";
  return { title, payload: {
    title, slides: data.slides,
    ...(data.fonts ? { fonts: data.fonts } : {}),
    ...(deckThemeId ? { deckThemeId } : {}),
  } };
}

export function useDeckAutosave({ presentationData, token, deckId, disabled, deckThemeIdRef }: {
  presentationData: PresentationData | null | undefined;
  token: string | null | undefined;
  deckId: string;
  /** Loading, streamed generation and template editing are not persisted edits. */
  disabled: boolean;
  deckThemeIdRef: MutableRefObject<string | null>;
}) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<SaveJob | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const latestQueuedRef = useRef<SaveJob | null>(null);
  const inFlightRef = useRef(0);
  const mountedRef = useRef(true);
  const observedRef = useRef<PresentationData | null | undefined>(undefined);
  const enabledRef = useRef(false);
  const pausedRef = useRef(disabled);
  // Pause before passive effects or an old timer can save transient data.
  pausedRef.current = disabled;
  if (disabled) enabledRef.current = false;

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const enqueue = useCallback((job: SaveJob) => {
    latestQueuedRef.current = job;
    inFlightRef.current += 1;
    if (mountedRef.current) setSaveState("saving");
    const write = chainRef.current.then(async () => {
      const slides = (job.body.payload?.slides as unknown[] | undefined)?.length;
      console.info("[deck][save:start]", { deckId: job.deckId, slides });
      await saveDeck(job.token, job.deckId, job.body);
      console.info("[deck][save:done]", { deckId: job.deckId, slides });
      if (mountedRef.current && !pendingRef.current) setSaveState("saved");
    });
    // A failed PUT must not break the queue or silently lose the pending edit.
    // Explicit callers still receive the rejection.
    chainRef.current = write.catch(error => {
      if (latestQueuedRef.current === job) pendingRef.current ??= job;
      if (mountedRef.current) setSaveState("pending");
      console.error("[deck][save:error]", { deckId: job.deckId, message: String(error) });
    }).finally(() => { inFlightRef.current -= 1; });
    return write;
  }, []);

  const flush = useCallback(() => {
    clearTimer();
    if (pausedRef.current) return;
    const job = pendingRef.current;
    if (!job) return;
    pendingRef.current = null;
    void enqueue(job).catch(() => {});
  }, [clearTimer, enqueue]);

  const saveNow = useCallback(async (data: PresentationData) => {
    if (!token || data.id !== deckId) throw new Error("Cannot save a deck that is not open.");
    clearTimer();
    pendingRef.current = null;
    observedRef.current = data;
    await enqueue({ token, deckId, body: bodyFor(data, deckThemeIdRef.current) });
  }, [token, deckId, clearTimer, enqueue, deckThemeIdRef]);

  useEffect(() => {
    if (disabled || !presentationData || presentationData.id !== deckId || !token) {
      clearTimer();
      pendingRef.current = null;
      enabledRef.current = false;
      return;
    }
    // Hydration and the first state after generation are baselines.
    // Identity prevents StrictMode's second setup from saving them.
    if (!enabledRef.current || observedRef.current?.id !== deckId) {
      enabledRef.current = true;
      observedRef.current = presentationData;
      return;
    }
    if (observedRef.current === presentationData) return;
    observedRef.current = presentationData;
    pendingRef.current = { token, deckId, body: bodyFor(presentationData, deckThemeIdRef.current) };
    setSaveState("pending");
    clearTimer();
    timerRef.current = setTimeout(flush, DEBOUNCE_MS);
  }, [presentationData, token, deckId, disabled, flush, clearTimer, deckThemeIdRef]);

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
      if (inFlightRef.current === 0 && (pausedRef.current || !pendingRef.current)) return;
      if (!pausedRef.current) flushRef.current();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
  return { saveState, saveNow };
}

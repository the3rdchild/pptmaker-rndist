"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/store/session.store";
import { createDeck } from "@/lib/api";

type DeckPayload = NonNullable<Parameters<typeof createDeck>[1]["payload"]>;

/** A deck that already holds one empty slide.
 *
 *  Created without a payload, a deck arrives at the editor with no slides at
 *  all, and the editor seeds it from the default theme's first layout — a fully
 *  designed title slide. That is a reasonable place to land a brand-new deck in
 *  general, which is why the fallback stays, but it is exactly what `?blank=1`
 *  exists to skip. Giving the deck a slide of its own means the fallback never
 *  fires, and the deck reads back blank on reload too.
 *
 *  Shape is the editor's own — `{ slides: [{ ui }] }`, what
 *  adaptDeckToPresentation reads and what the autosave writes — rather than the
 *  legacy `Presentation` the API client is typed against, hence the cast. The
 *  save path in editor-react-client.tsx casts the same way.
 *
 *  An empty `ui` renders white on its own: readBackgroundStyle falls back to a
 *  solid #FFFFFF when a slide carries no background.
 */
function blankDeckPayload(title: string): DeckPayload {
  return {
    title,
    slides: [{ ui: { components: [], elements: [] } }],
  } as unknown as DeckPayload;
}

export default function EditorReactIndex() {
  const router = useRouter();
  const { token, init, ready, error } = useSessionStore();
  const [msg, setMsg] = useState("Starting editor…");

  useEffect(() => {
    (async () => {
      await init();
    })();
  }, [init]);

  useEffect(() => {
    if (!ready || !token) return;
    let cancelled = false;
    (async () => {
      try {
        setMsg("Creating deck…");
        const title = "Untitled Presentation";
        // Read the flag off the location instead of useSearchParams(): this
        // page has no Suspense boundary around it, and the hook would require
        // one.
        const blank =
          new URLSearchParams(window.location.search).get("blank") === "1";
        const deck = await createDeck(token, {
          title,
          ...(blank ? { payload: blankDeckPayload(title) } : {}),
        });
        if (!cancelled) router.replace(`/editor-react/${deck.id}`);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Failed to create deck");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, token, router]);

  return (
    <div className="flex h-screen items-center justify-center text-zinc-400">
      {error ?? msg}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/store/session.store";
import { createDeck } from "@/lib/api";

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
        const deck = await createDeck(token, { title: "Untitled Presentation" });
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

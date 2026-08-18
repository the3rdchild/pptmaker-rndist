import { Suspense } from "react";
import { OutlinePage } from "@/components/outline/outline-page";

export default function OutlineRoute() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-[var(--bg-base)] text-zinc-400">
          Loading…
        </div>
      }
    >
      <OutlinePage />
    </Suspense>
  );
}

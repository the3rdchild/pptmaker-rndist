"use client";

import { Suspense } from "react";
import EditorReactClient from "@/components/editor-react-client";

export default function TemplateEnginePage() {
  return (
    <Suspense>
      {/* deckId is only a seed for per-deck editor behaviour here — in template
          mode nothing is read from or written to the deck API. */}
      <EditorReactClient deckId="template-engine" templateMode />
    </Suspense>
  );
}

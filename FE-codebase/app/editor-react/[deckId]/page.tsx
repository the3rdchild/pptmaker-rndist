"use client";

import { use } from "react";
import EditorReactClient from "@/components/editor-react-client";

export default function EditorReactPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = use(params);
  return <EditorReactClient deckId={deckId} />;
}

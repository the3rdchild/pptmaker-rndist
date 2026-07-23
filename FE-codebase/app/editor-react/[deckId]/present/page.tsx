"use client";

import { use } from "react";
import { PresenterView } from "@/components/editor-react/presenter-view";

export default function PresenterViewPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = use(params);
  return <PresenterView deckId={deckId} />;
}

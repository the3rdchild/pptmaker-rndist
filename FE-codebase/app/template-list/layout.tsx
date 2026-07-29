"use client";

// The layout previews on this page mount the editor's own Konva surface, and
// that surface reads the editor store. Without this Provider it throws on
// every render attempt — which does not surface as an error boundary here, it
// takes the whole page down. The two editor routes carry the same wrapper for
// the same reason.

import { Provider } from "react-redux";
import { makeEditorStore } from "@/store/editorStore";

const editorStore = makeEditorStore();

export default function TemplateListLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Provider store={editorStore}>{children}</Provider>;
}

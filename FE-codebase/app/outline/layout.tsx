"use client";

// The theme picker on this page renders live layout thumbnails, and those
// mount the editor's Konva surface, which reads the editor store. Without
// this Provider the surface throws on render — same wrapper the template-list
// and editor routes carry for the same reason.

import { Provider } from "react-redux";
import { makeEditorStore } from "@/store/editorStore";

const editorStore = makeEditorStore();

export default function OutlineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Provider store={editorStore}>{children}</Provider>;
}

"use client";

import { Provider } from "react-redux";
import { makeEditorStore } from "@/store/editorStore";

const editorStore = makeEditorStore();

export default function TemplateEngineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Provider store={editorStore}>{children}</Provider>;
}

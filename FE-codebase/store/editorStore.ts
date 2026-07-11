import { configureStore } from "@reduxjs/toolkit";
import presentationReducer from "./presentationGeneration";

export function makeEditorStore() {
  return configureStore({
    reducer: {
      presentationGeneration: presentationReducer,
    },
  });
}

export type EditorStore = ReturnType<typeof makeEditorStore>;
export type RootState = ReturnType<EditorStore["getState"]>;
export type AppDispatch = EditorStore["dispatch"];

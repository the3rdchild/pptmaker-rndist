import { configureStore } from "@reduxjs/toolkit";
import presentationReducer from "./presentationGeneration";

export const store = configureStore({
  reducer: {
    presentationGeneration: presentationReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

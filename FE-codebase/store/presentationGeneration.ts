import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface SlideData {
  ui?: Record<string, unknown> | null;
  content?: unknown;
  images?: unknown;
  icons?: unknown;
  graph_id?: string | null;
  index?: number;
  type?: string;
  design_index?: number;
}

export interface PresentationData {
  id: string;
  language?: string;
  layout?: unknown;
  n_slides?: number;
  title?: string;
  slides: SlideData[];
  theme?: unknown;
  version?: number;
  fonts?: unknown;
  structure?: unknown;
}

interface PresentationGenerationState {
  presentationData: PresentationData | null;
}

  const initialState: PresentationGenerationState = {
    presentationData: null,
  };

  function reindex(slides: SlideData[]): SlideData[] {
    return slides.map((s, i) => ({ ...s, index: i }));
  }

  const presentationSlice = createSlice({
    name: "presentationGeneration",
    initialState,
    reducers: {
      setPresentationData: (
        state,
        action: PayloadAction<PresentationData | null>
      ) => {
        state.presentationData = action.payload;
      },
      updateSlideUi: (
        state,
        action: PayloadAction<{
          index: number;
          ui: Record<string, unknown> | null;
        }>
      ) => {
        const { index, ui } = action.payload;
        if (state.presentationData?.slides[index]) {
          state.presentationData.slides[index].ui = ui;
        }
      },
      addSlide: (
        state,
        action: PayloadAction<{ ui: Record<string, unknown>; atIndex?: number }>
      ) => {
        if (!state.presentationData) return;
        const { ui, atIndex } = action.payload;
        const insertAt = atIndex ?? state.presentationData.slides.length;
        state.presentationData.slides.splice(insertAt, 0, { ui });
        state.presentationData.slides = reindex(state.presentationData.slides);
      },
      deleteSlide: (
        state,
        action: PayloadAction<number>
      ) => {
        if (!state.presentationData) return;
        const idx = action.payload;
        if (state.presentationData.slides.length <= 1) return;
        state.presentationData.slides.splice(idx, 1);
        state.presentationData.slides = reindex(state.presentationData.slides);
      },
      duplicateSlide: (
        state,
        action: PayloadAction<number>
      ) => {
        if (!state.presentationData) return;
        const idx = action.payload;
        const src = state.presentationData.slides[idx];
        if (!src) return;
        const clone = { ui: structuredClone(src.ui) };
        state.presentationData.slides.splice(idx + 1, 0, clone);
        state.presentationData.slides = reindex(state.presentationData.slides);
      },
    },
  });

  export const {
    setPresentationData,
    updateSlideUi,
    addSlide,
    deleteSlide,
    duplicateSlide,
  } = presentationSlice.actions;
export default presentationSlice.reducer;

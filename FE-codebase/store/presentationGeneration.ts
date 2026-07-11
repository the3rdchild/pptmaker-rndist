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
  },
});

export const { setPresentationData, updateSlideUi } = presentationSlice.actions;
export default presentationSlice.reducer;

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { applyPaletteToUi } from "@/components/slide-editor/utils/ai-palette";
import type { GeneratedPalette } from "@/components/slide-editor/utils/color-theory";

export interface SlideData {
  ui?: Record<string, unknown> | null;
  content?: unknown;
  images?: unknown;
  icons?: unknown;
  graph_id?: string | null;
  index?: number;
  type?: string;
  design_index?: number;
  isLocked?: boolean;
  isHidden?: boolean;
  notes?: string;
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

  // Retroactive repaint, used only by the rare cover-photo fallback (the
  // theme line already applies its palette per-slide as each is created —
  // see editor-react-client.tsx's tintIfThemed). Runs applyPaletteToUi
  // (background/shape/text/icon, all explicit roles) over every slide
  // currently in state with a fresh icon-color counter — an acceptable
  // inconsistency for a rarely-hit fallback path, not worth threading the
  // deck-wide icon rotation counter through Redux for.

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
      /** Bulk insert — "Apply all N pages" adds a whole theme at once, and
       *  dispatching addSlide N times would re-render and restart the autosave
       *  debounce on every slide. */
      addSlides: (
        state,
        action: PayloadAction<{
          uis: Record<string, unknown>[];
          atIndex?: number;
          /** Drop existing slides first — used when the deck is still the
           *  single untouched blank slide. */
          replaceAll?: boolean;
        }>
      ) => {
        if (!state.presentationData) return;
        const { uis, atIndex, replaceAll } = action.payload;
        if (uis.length === 0) return;
        const slides = uis.map((ui) => ({ ui }));
        if (replaceAll) {
          state.presentationData.slides = reindex(slides);
          return;
        }
        const insertAt = atIndex ?? state.presentationData.slides.length;
        state.presentationData.slides.splice(insertAt, 0, ...slides);
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
        if (!src || !src.ui) return;
        const clone = { ui: JSON.parse(JSON.stringify(src.ui)) };
        state.presentationData.slides.splice(idx + 1, 0, clone);
        state.presentationData.slides = reindex(state.presentationData.slides);
      },
      reorderSlide: (
        state,
        action: PayloadAction<{ fromIndex: number; toIndex: number }>
      ) => {
        if (!state.presentationData) return;
        const { fromIndex, toIndex } = action.payload;
        const slides = state.presentationData.slides;
        if (!slides[fromIndex]) return;
        const [moved] = slides.splice(fromIndex, 1);
        slides.splice(toIndex, 0, moved);
        state.presentationData.slides = reindex(slides);
      },
      setSlideLocked: (
        state,
        action: PayloadAction<{ index: number; locked: boolean }>
      ) => {
        const { index, locked } = action.payload;
        if (state.presentationData?.slides[index]) {
          state.presentationData.slides[index].isLocked = locked;
        }
      },
      setSlideHidden: (
        state,
        action: PayloadAction<{ index: number; hidden: boolean }>
      ) => {
        const { index, hidden } = action.payload;
        if (state.presentationData?.slides[index]) {
          state.presentationData.slides[index].isHidden = hidden;
        }
      },
      setSlideNotes: (
        state,
        action: PayloadAction<{ index: number; notes: string }>
      ) => {
        const { index, notes } = action.payload;
        if (state.presentationData?.slides[index]) {
          state.presentationData.slides[index].notes = notes;
        }
      },
      applyAccentBackground: (state, action: PayloadAction<GeneratedPalette>) => {
        if (!state.presentationData) return;
        const palette = action.payload;
        state.presentationData.slides = state.presentationData.slides.map((slide) =>
          slide.ui ? { ...slide, ui: applyPaletteToUi(slide.ui, palette) } : slide,
        );
      },
    },
  });

  export const {
    setPresentationData,
    updateSlideUi,
    addSlide,
    addSlides,
    deleteSlide,
    duplicateSlide,
    reorderSlide,
    setSlideLocked,
    setSlideHidden,
    setSlideNotes,
    applyAccentBackground,
  } = presentationSlice.actions;
export default presentationSlice.reducer;

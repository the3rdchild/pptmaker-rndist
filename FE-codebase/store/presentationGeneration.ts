import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { hexLightness } from "@/components/slide-editor/utils/extract-image-colors";

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

  // Tints every slide's full-stage background rectangle to `color`, but only
  // if it's currently white/near-white — a cover/section layout that already
  // ships with an intentionally-colored full-bleed background is left alone.
  const STAGE_W = 1280;
  const STAGE_H = 720;

  function withBackgroundTint(
    ui: Record<string, unknown> | null | undefined,
    color: string,
  ): Record<string, unknown> | null | undefined {
    const components = Array.isArray(ui?.components) ? (ui.components as Record<string, unknown>[]) : null;
    if (!components) return ui;

    let changedAny = false;
    const nextComponents = components.map((component) => {
      const elements = Array.isArray(component.elements)
        ? (component.elements as Record<string, unknown>[])
        : [];
      let changed = false;
      const nextElements = elements.map((el) => {
        if (el.type !== "rectangle") return el;
        const size = el.size as { width?: number; height?: number } | undefined;
        const isFullStage =
          size && Math.abs((size.width ?? 0) - STAGE_W) < 4 && Math.abs((size.height ?? 0) - STAGE_H) < 4;
        if (!isFullStage) return el;
        const fill = (el.fill as { color?: string } | undefined) ?? {};
        const currentLightness = fill.color ? hexLightness(fill.color) : 1;
        if (currentLightness < 0.92) return el;
        changed = true;
        return { ...el, fill: { ...fill, color } };
      });
      if (!changed) return component;
      changedAny = true;
      return { ...component, elements: nextElements };
    });
    return changedAny ? { ...ui, components: nextComponents } : ui;
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
      applyAccentBackground: (state, action: PayloadAction<string>) => {
        if (!state.presentationData) return;
        const color = action.payload;
        state.presentationData.slides = state.presentationData.slides.map((slide) =>
          slide.ui ? { ...slide, ui: withBackgroundTint(slide.ui, color) } : slide,
        );
      },
    },
  });

  export const {
    setPresentationData,
    updateSlideUi,
    addSlide,
    deleteSlide,
    duplicateSlide,
    reorderSlide,
    setSlideLocked,
    setSlideHidden,
    setSlideNotes,
    applyAccentBackground,
  } = presentationSlice.actions;
export default presentationSlice.reducer;

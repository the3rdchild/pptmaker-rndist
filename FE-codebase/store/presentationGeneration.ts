import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { hexLightness, tintTowardWhite } from "@/components/slide-editor/utils/extract-image-colors";

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

  // Retints EVERY rectangle in a slide to `color`, not just the full-stage
  // background — the decorative "accent chip" cards each template pack ships
  // (e.g. swift's #BFF4FF light-blue cards) are their own small rectangles
  // with a hardcoded pack color, completely untouched by a background-only
  // fix. Each rectangle keeps ITS OWN current lightness as the tint amount
  // (tintTowardWhite(color, lightness)) so a light pastel wash stays a light
  // wash and a bolder accent chip stays bolder — just recolored to the new
  // hue instead of the pack's original one. Near-black rectangles (borders,
  // text-box backings) are left alone entirely; recoloring those to an
  // accent hue would look wrong, not better.
  const NEAR_BLACK_LIGHTNESS = 0.15;
  const NEAR_WHITE_LIGHTNESS = 0.92;
  const NEAR_WHITE_TINT_AMOUNT = 0.88;

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
        const fill = (el.fill as { color?: string } | undefined) ?? {};
        if (!fill.color) return el;
        const lightness = hexLightness(fill.color);
        if (lightness <= NEAR_BLACK_LIGHTNESS) return el;
        const tintAmount = lightness >= NEAR_WHITE_LIGHTNESS ? NEAR_WHITE_TINT_AMOUNT : lightness;
        changed = true;
        return { ...el, fill: { ...fill, color: tintTowardWhite(color, tintAmount) } };
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

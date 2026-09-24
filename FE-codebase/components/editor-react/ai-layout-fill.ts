// Fills AI-generated slide content into one of the existing hand-designed
// template layouts (templates/*/template.json in storage) instead of authoring
// a slide from scratch. Picks a layout matching the slide's role, then
// walks its component tree filling only non-decorative text placeholders —
// every other design decision (colors, decorative shapes, positions,
// chart/table example data) is left exactly as the template author made it,
// EXCEPT icon placeholders (every pack ships every icon slot as the exact
// same generic /static/icons/placeholder.svg) — those get swapped for a
// real, content-relevant icon below.
//
// This mirrors the old PPTist "AIPPT" template-filling behaviour (see
// worker/services/deck_service.py's AIPPTSlide contract) that got dropped
// when the flat hardcoded layouts in map-slide.ts were written as a stub.
//
// The actual work is split by concern across sibling modules — this file
// only keeps the high-level orchestrator (mapAIPPTSlideToTemplateUi) and
// re-exports everything importers use, so nothing outside this module needs
// to know it moved:
//   - deck-layout-picker.ts: AIPPTSlide contract, theme resolution, DeckLayoutPicker
//   - text-fit.ts: text-box fitting/shrinking and fillLayout
//   - card-grid-explode.ts: splitting filled card grids into components
//   - photo-slots.ts: hero/secondary photo slot detection and patching
//   - icon-fill.ts: placeholder icon auto-fill

import {
  DeckLayoutPicker,
  type AIPPTSlide,
} from "@/components/editor-react/deck-layout-picker";
import {
  fillLayout,
  type FilledSlide,
} from "@/components/editor-react/text-fit";
import { fillPlaceholderIcons } from "@/components/editor-react/icon-fill";

export {
  DeckLayoutPicker,
  resolveThemeFromPrompt,
  type AIPPTSlide,
} from "@/components/editor-react/deck-layout-picker";
export {
  fillLayout,
  setText,
  type FilledSlide,
  type SetTextOptions,
} from "@/components/editor-react/text-fit";
export { pruneEmptyContainers } from "@/components/editor-react/card-grid-explode";
export {
  type HeroImageMarker,
  findAllPhotoSlots,
  findHeroImage,
  findSecondaryImages,
  patchHeroImage,
  findPhotoSlotHint,
} from "@/components/editor-react/photo-slots";
export { fillPlaceholderIcons } from "@/components/editor-react/icon-fill";

function slideTitleForIconFallback(slide: AIPPTSlide): string {
  if (slide.type === "cover" || slide.type === "transition" || slide.type === "content") {
    return slide.data.title;
  }
  return "presentation";
}

/** High-level entry point: pick a layout for this slide's role and fill it. */
export async function mapAIPPTSlideToTemplateUi(
  slide: AIPPTSlide,
  picker: DeckLayoutPicker
): Promise<FilledSlide | null> {
  await picker.ensureLoaded();
  const layout = picker.pickFor(slide.type);
  if (!layout) return null;
  const filled = fillLayout(layout, slide);
  filled.ui = await fillPlaceholderIcons(filled.ui, slideTitleForIconFallback(slide));
  return filled;
}

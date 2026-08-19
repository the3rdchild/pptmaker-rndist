import type {
  PresentationData,
  SlideTransition,
} from "@/store/presentationGeneration";

// Shared between the main editor (editor-react-client.tsx) and Presenter
// View (which re-fetches the deck independently in its own window rather
// than receiving props from the opener — see presenter-sync.ts) so both
// read a saved deck's slides the same way.
export function adaptDeckToPresentation(
  deckId: string,
  payload: Record<string, unknown> | null
): PresentationData | null {
  if (!payload) return null;
  const rawSlides = Array.isArray(payload.slides) ? payload.slides : [];
  const slides = rawSlides
    .map((s) => {
      const rec = (s ?? {}) as Record<string, unknown>;
      const ui = rec.ui ?? null;
      return {
        ui: ui as Record<string, unknown> | null,
        isLocked: rec.isLocked as boolean | undefined,
        isHidden: rec.isHidden as boolean | undefined,
        notes: rec.notes as string | undefined,
        transition: rec.transition as SlideTransition | undefined,
      };
    })
    .filter((s) => s.ui);
  if (slides.length === 0) return null;
  return {
    id: deckId,
    title: (payload.title as string) ?? "Untitled",
    slides,
    // Carry the deck's template font map so the render path loads the right
    // per-pack typeface (Poppins / Montserrat / Playfair / Albert Sans) when
    // a saved deck is reopened — without this, presentationData.fonts is
    // always undefined for loaded decks and only the generic Google-Fonts
    // fallback is used.
    fonts: payload.fonts,
  };
}

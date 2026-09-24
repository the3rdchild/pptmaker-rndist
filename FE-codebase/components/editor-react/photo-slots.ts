import { isImageFrameElement } from "@/components/editor-react/image-frames";
import { type Rec } from "@/components/editor-react/deck-layout-picker";

/* --------------------------- Photo slots ------------------------------ */

// `occurrenceIndex` matters because several layouts repeat the SAME element
// name multiple times (e.g. a 4-portrait team grid has 4 elements all named
// "portrait_image") — componentId+elementName alone can't tell them apart,
// so patchHeroImage would always hit the first one and leave the other 3
// pointing at the placeholder forever.
export interface HeroImageMarker {
  componentId: string;
  elementName: string;
  occurrenceIndex: number;
}

type PhotoCandidate = HeroImageMarker & { area: number };

// Full-bleed background photos (near stage size, 1280x720) must stay
// sharp-cornered — rounding them would show the slide background through the
// corner gaps. Everything smaller (hero panels, card/portrait photos) gets
// rounded like Canva.
const STAGE_W = 1280;
const STAGE_H = 720;

/** Sets a generous uniform corner radius on a photo element, scaled to its
 * size, unless it's a full-bleed background. Mutates in place (components are
 * already deep-cloned by fillLayout). */
function roundPhotoCorners(el: Rec, w: number, h: number): void {
  if (w >= STAGE_W * 0.94 && h >= STAGE_H * 0.94) return;
  const radius = Math.round(Math.min(28, Math.max(14, Math.min(w, h) * 0.07)));
  el.border_radius = { tl: radius, tr: radius, br: radius, bl: radius };
}

/** Finds every fillable photo slot in the layout. Plain images qualify when
 * they are named, non-icon, non-decorative and big enough to matter. Image
 * CONTAINERS (frames — clipped images) always qualify, even decorative or
 * tiny ones: a frame is by definition a photo holder, and leaving it on the
 * placeholder landscape looks broken. Unnamed frames get a synthetic name so
 * the patch step can still target them. */
export function findAllPhotoSlots(components: Rec[]): PhotoCandidate[] {
  const candidates: PhotoCandidate[] = [];
  const occurrenceCounters = new Map<string, number>();

  const visit = (el: Rec, componentId: string) => {
    const frame = isImageFrameElement(el);
    if (
      el.type === "image" &&
      (frame || (el.is_icon !== true && el.decorative !== true && el.name))
    ) {
      const size = el.size as Rec | undefined;
      const w = typeof size?.width === "number" ? (size.width as number) : 0;
      const h = typeof size?.height === "number" ? (size.height as number) : 0;
      const area = w * h;
      if (!el.name) el.name = "frame_photo"; // unnamed frame — see docstring
      const key = `${componentId}::${el.name}`;
      const occurrenceIndex = occurrenceCounters.get(key) ?? 0;
      occurrenceCounters.set(key, occurrenceIndex + 1);
      if (frame || area > 20000) {
        // Corner rounding is for plain photos — a frame's clip already
        // shapes it, and rounding would cut into the shape's bounding box.
        if (!frame) roundPhotoCorners(el, w, h);
        candidates.push({ area, componentId, elementName: String(el.name), occurrenceIndex });
      }
      return;
    }
    const children = el.children as Rec[] | undefined;
    if (Array.isArray(children)) {
      for (const child of children) visit(child, componentId);
      return;
    }
    const child = el.child as Rec | undefined;
    if (child) visit(child, componentId);
  };

  for (const component of components) {
    const elements = (component.elements as Rec[]) ?? [];
    for (const el of elements) visit(el, component.id as string);
  }

  return candidates;
}

/** The largest photo slot — almost always the template's "hero photo"
 * (main_photo, header_photo, background_photo, ...). Used to drop an
 * AI-generated image in without flattening the slide — the image stays its
 * own editable element. */
export function findHeroImage(candidates: PhotoCandidate[]): HeroImageMarker | null {
  const sorted = [...candidates].sort((a, b) => b.area - a.area);
  const best = sorted[0];
  if (!best) return null;
  const { componentId, elementName, occurrenceIndex } = best;
  return { componentId, elementName, occurrenceIndex };
}

/** Every OTHER real photo slot in the layout besides the hero — e.g. the
 * remaining 3 portraits in a 4-person team grid, or the 2nd/3rd card photo
 * in a 3-card row. Each one gets its own AI-generated image too instead of
 * being left on the generic placeholder file (which used to blend into a
 * flat white background but now stands out against a colored theme). */
export function findSecondaryImages(candidates: PhotoCandidate[], hero: HeroImageMarker | null): HeroImageMarker[] {
  return candidates
    .filter(
      (c) =>
        !(
          hero &&
          c.componentId === hero.componentId &&
          c.elementName === hero.elementName &&
          c.occurrenceIndex === hero.occurrenceIndex
        ),
    )
    .map(({ componentId, elementName, occurrenceIndex }) => ({ componentId, elementName, occurrenceIndex }));
}

/** Deep-clones `ui` and swaps ONE photo slot's `data` for a generated image
 * URL/data-URL, using occurrenceIndex to pick out the right element among
 * same-named siblings. No-ops if the marker no longer matches anything.
 * `extra` optionally stamps attribution fields (stock-photo fills only —
 * AI-generated images have no photographer/source to credit).
 *
 * `fit` is forced to "cover" — what the toolbar calls "Fill". Template photo
 * slots are routinely authored as "fill", an anisotropic stretch, and that is
 * harmless for the placeholder art because it was cut to the slot's exact
 * aspect ratio. A generated 1024x1024 photo dropped into a 16:9 slot is not,
 * and inheriting "fill" is what left generated decks full of squashed people.
 * Cropping to fill is what a photograph wants. A document figure must NOT be
 * cropped — it goes through source-asset-fill.ts, which sets "contain". */
export function patchHeroImage(
  ui: Rec,
  marker: HeroImageMarker,
  dataUrl: string,
  extra?: Partial<Pick<Rec, "credit" | "credit_url" | "source_url">>,
): Rec {
  const cloned = JSON.parse(JSON.stringify(ui)) as Rec;
  const components = (cloned.components as Rec[]) ?? [];
  const component = components.find((c) => c.id === marker.componentId);
  if (!component) return cloned;

  let seen = 0;
  const visit = (el: Rec): boolean => {
    if (el.type === "image" && el.name === marker.elementName) {
      if (seen === marker.occurrenceIndex) {
        el.data = dataUrl;
        el.fit = "cover";
        if (extra) Object.assign(el, extra);
        return true;
      }
      seen += 1;
      return false;
    }
    const children = el.children as Rec[] | undefined;
    if (Array.isArray(children)) return children.some(visit);
    const child = el.child as Rec | undefined;
    if (child) return visit(child);
    return false;
  };

  const elements = (component.elements as Rec[]) ?? [];
  elements.some(visit);
  return cloned;
}

/** The slot hint authored for one photo slot ("what photo belongs here") —
 *  used as the image-generation prompt guidance when present, so an
 *  auto-labelled frame ("smiling barista, warm tones") beats the generic
 *  per-slide subject prompt. Returns null when the slot has no hint. */
export function findPhotoSlotHint(ui: Rec, marker: HeroImageMarker): string | null {
  const components = (ui.components as Rec[]) ?? [];
  const component = components.find((c) => c.id === marker.componentId);
  if (!component) return null;

  let seen = 0;
  let found: string | null = null;
  const visit = (el: Rec): boolean => {
    if (el.type === "image" && el.name === marker.elementName) {
      if (seen === marker.occurrenceIndex) {
        const slot =
          el.slot && typeof el.slot === "object" && !Array.isArray(el.slot)
            ? (el.slot as Rec)
            : null;
        const hint = slot?.hint;
        found = typeof hint === "string" && hint.trim() ? hint.trim() : null;
        return true;
      }
      seen += 1;
      return false;
    }
    const children = el.children as Rec[] | undefined;
    if (Array.isArray(children)) return children.some(visit);
    const child = el.child as Rec | undefined;
    if (child) return visit(child);
    return false;
  };

  const elements = (component.elements as Rec[]) ?? [];
  elements.some(visit);
  return found;
}

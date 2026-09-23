// Morph planning for the HTML pipeline — pure functions, no I/O.
//
// A morph pairs elements across two slides by `morph_id` (set from the HTML's
// `data-morph`), so the slide morphing IN has to be written knowing what the
// slide before it actually rendered. Slides joined by morph therefore form a
// chain generated in order; separate chains still run in parallel.

/**
 * Splits slide indices into chains: a slide whose transition is morph joins
 * the chain of the slide before it. The first slide never morphs in.
 * @param {{ transition?: string }[]} slides
 * @returns {number[][]}
 */
export function groupMorphChains(slides) {
  const chains = [];
  slides.forEach((slide, index) => {
    if (index > 0 && slide.transition === "morph") chains[chains.length - 1].push(index);
    else chains.push([index]);
  });
  return chains;
}

/**
 * The elements a following slide can carry across: every extracted element
 * with a bare `morph_id` (suffixed ids are secondary pieces of the same node),
 * described the way the slide prompt shows them.
 * @param {{ elements?: object[] }} ui
 */
export function morphAnchorsFrom(ui) {
  const anchors = [];
  for (const element of ui?.elements ?? []) {
    const id = typeof element.morph_id === "string" ? element.morph_id : "";
    if (!id || id.includes("~")) continue;
    const text = Array.isArray(element.runs) ? element.runs.map((run) => run.text).join("").trim() : "";
    anchors.push({
      id,
      kind: element.type === "text" ? "text" : element.type === "image" ? "photo" : "shape",
      text: text.slice(0, 80),
      box: {
        x: Math.round(element.position?.x ?? 0),
        y: Math.round(element.position?.y ?? 0),
        width: Math.round(element.size?.width ?? 0),
        height: Math.round(element.size?.height ?? 0),
      },
    });
  }
  return anchors;
}

/** Ids of `anchors` that the rendered slide reuses — empty means the morph
 *  would pair nothing and play as a plain crossfade. */
export function sharedMorphIds(anchors, ui) {
  const onSlide = new Set(
    (ui?.elements ?? []).map((element) => element.morph_id).filter((id) => typeof id === "string"),
  );
  return anchors.map((anchor) => anchor.id).filter((id) => onSlide.has(id));
}

/** Index of the slide's heading in practice: the text set in the largest type. */
function headingIndex(elements) {
  let best = -1;
  elements.forEach((element, index) => {
    if (element.type !== "text") return;
    const size = element.font?.size ?? 0;
    if (best < 0 || size > (elements[best].font?.size ?? 0)) best = index;
  });
  return best;
}

function withMorphId(ui, index, id) {
  const elements = ui.elements.map((element, i) => {
    if (i === index) return { ...element, morph_id: id };
    // the id must stay unique on the slide
    if (element.morph_id === id) {
      const { morph_id: _dropped, ...rest } = element;
      return rest;
    }
    return element;
  });
  return { ...ui, elements };
}

/**
 * When the next slide morphs from this one but the model tagged nothing, the
 * heading becomes the anchor — a planned morph always has a title to carry.
 */
export function ensureMorphAnchor(ui) {
  const elements = ui?.elements ?? [];
  if (morphAnchorsFrom(ui).length) return ui;
  const index = headingIndex(elements);
  return index < 0 ? ui : withMorphId(ui, index, "title");
}

/**
 * When this slide morphs in but reuses none of the previous slide's ids, pair
 * the two headings: this slide's heading takes the previous slide's first
 * text anchor id.
 */
export function pairHeadingsIfUnmatched(anchors, ui) {
  if (!anchors.length || sharedMorphIds(anchors, ui).length) return ui;
  const target = anchors.find((anchor) => anchor.kind === "text");
  const index = headingIndex(ui?.elements ?? []);
  return target && index >= 0 ? withMorphId(ui, index, target.id) : ui;
}

/**
 * Inserts one completed HTML slide without creating blank placeholders for
 * pages that have not arrived yet. `logicalIndices` maps each physical canvas
 * position to its approved-outline index.
 *
 * @template T
 * @param {{ logicalIndices: number[], slides: T[] }} state
 * @param {number} logicalIndex
 * @param {T} slide
 * @returns {{ logicalIndices: number[], slides: T[], physicalIndex: number, inserted: boolean }}
 */
export function insertHtmlSlideAt(state, logicalIndex, slide) {
  const existing = state.logicalIndices.indexOf(logicalIndex);
  if (existing >= 0) {
    return {
      logicalIndices: state.logicalIndices,
      slides: state.slides,
      physicalIndex: existing,
      inserted: false,
    };
  }

  const following = state.logicalIndices.findIndex((index) => index > logicalIndex);
  const physicalIndex = following < 0 ? state.slides.length : following;
  return {
    logicalIndices: [
      ...state.logicalIndices.slice(0, physicalIndex),
      logicalIndex,
      ...state.logicalIndices.slice(physicalIndex),
    ],
    slides: [
      ...state.slides.slice(0, physicalIndex),
      slide,
      ...state.slides.slice(physicalIndex),
    ],
    physicalIndex,
    inserted: true,
  };
}

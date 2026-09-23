// The homepage "Transisi" toggle: whether the AI plans slide transitions
// (morph first) while it writes the outline. The homepage stores it, /outline
// and the editor read it from the URL, so a reload re-runs the same choice.

export const TRANSITIONS_PARAM = "transitions";

const STORAGE_KEY = "ppt_transitions";

export function transitionsFromParams(params: { get(name: string): string | null }): boolean {
  return params.get(TRANSITIONS_PARAM) === "on";
}

export function loadStoredTransitions(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function storeTransitions(on: boolean) {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, "on");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // a browser that blocks storage still gets a working toggle for this visit
  }
}

// The homepage "Transisi" toggle: on by default for new decks. An explicit
// off value persists in the URL and local storage across outline and editor.

export const TRANSITIONS_PARAM = "transitions";

const STORAGE_KEY = "ppt_transitions";

export function transitionsFromParams(params: { get(name: string): string | null }): boolean {
  return params.get(TRANSITIONS_PARAM) !== "off";
}

export function loadStoredTransitions(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function storeTransitions(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // a browser that blocks storage still gets a working toggle for this visit
  }
}

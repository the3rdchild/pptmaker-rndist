// Google Font shortlist for substituting unresolved .pptx fonts.
//
// When a .pptx import surfaces a font the app cannot resolve (anything not in
// the Google Fonts catalogue — commercial fonts like Pagkaki Full are the
// canonical case), the editor cannot render it and falls back to a generic
// system font with very different metrics, so text comes out oversized. The
// substitution route (/api/fonts/substitute) asks the AI to pick the closest
// visual match from this list. The list is deliberately short and spread
// across the major type categories so the model has a sane answer for any
// incoming family, and every entry is verified to exist in font.json so the
// renderer can actually load it.
//
// Adding a category here means it shows up as a possible substitution — keep
// the list curated. Do not pad it with "everything"; that just makes the
// model's job harder and the choices less predictable.

/** One substitutable Google Font, tagged with its visual category so the
 *  prompt can describe what each option is for. */
export interface SubstituteFontEntry {
  family: string;
  category:
    | "sans"
    | "serif"
    | "display"
    | "slab"
    | "mono"
    | "script";
}

export const SUBSTITUTE_FONTS: SubstituteFontEntry[] = [
  // Sans-serif neutral — the safest default for body text and UI.
  { family: "Inter", category: "sans" },
  { family: "Poppins", category: "sans" },
  { family: "Montserrat", category: "sans" },
  { family: "Work Sans", category: "sans" },
  { family: "Manrope", category: "sans" },
  // Serif classic — for editorial / long-form / formal type.
  { family: "Playfair Display", category: "serif" },
  { family: "Lora", category: "serif" },
  { family: "Merriweather", category: "serif" },
  { family: "Libre Baskerville", category: "serif" },
  { family: "Source Serif 4", category: "serif" },
  // Display / bold / heading — tall or heavy, attention-grabbing.
  { family: "Bebas Neue", category: "display" },
  { family: "Anton", category: "display" },
  { family: "Archivo Black", category: "display" },
  { family: "Oswald", category: "display" },
  { family: "Fraunces", category: "display" },
  // Slab — geometric, technical-but-friendly.
  { family: "Roboto Slab", category: "slab" },
  { family: "Corben", category: "slab" },
  // Monospace.
  { family: "Inconsolata", category: "mono" },
  // Script / handwriting — the only entries that match calligraphic or
  // hand-lettered sources without falling back to a generic serif.
  { family: "Caveat", category: "script" },
  { family: "Dancing Script", category: "script" },
  { family: "Nanum Pen Script", category: "script" },
];

/** Family-name lookup set used by the route to validate that every AI-chosen
 *  substitute is actually one of the options offered — anything else the model
 *  emits is discarded rather than written into the deck. */
export const SUBSTITUTE_FONT_FAMILIES: ReadonlySet<string> = new Set(
  SUBSTITUTE_FONTS.map((entry) => entry.family),
);

/** Neutral fallback when the AI call fails or every choice for a font was
 *  rejected. Inter renders cleanly at any size and never looks wrong, so the
 *  import still succeeds even if the substitution step broke. */
export const DEFAULT_FONT_SUBSTITUTE = "Inter";

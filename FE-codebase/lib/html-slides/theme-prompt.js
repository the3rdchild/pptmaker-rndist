import { tokensForPrompt } from "./design-system.js";

const placement = {
  left: "left side", center: "centre", right: "right side", top: "top", bottom: "bottom", background: "background layer",
};

const compositionRules = {
  "bento-asymmetric": "Use one dominant tile and two smaller supporting tiles. Give them unequal spans and one reading path; three identical cards are not a bento layout.",
  "big-number": "Center the headline and number as one composition. Make one supplied numeric fact dominant, with a short label and source if the outline includes one.",
  "process-steps": "Show only the ordered steps supplied by the outline, linked by a clear directional path. Keep each step to one action and one short explanation.",
  "comparison-matrix": "Compare two named alternatives on the same criteria in aligned rows. Highlight only a supported difference; an unknown value stays absent.",
};

/** Converts saved theme rules into bounded design language for one slide. The
 * persisted record never contains CSS/HTML; this is the only bridge to the
 * model-facing prompt. */
export function compileThemePrompt(theme, recipe) {
  const regions = recipe.regions.length
    ? recipe.regions.map((region) => `- ${region.kind}: ${region.emphasis} emphasis at ${placement[region.placement]}`).join("\n")
    : "- Keep one clear primary heading and supporting content within safe margins.";
  const decorations = recipe.decorations.length ? recipe.decorations.join(", ") : "none";
  const imageRule = theme.effects.imageTreatment === "duotone"
    ? "For duotone imagery, use a real translucent color overlay layer above the image; never use a CSS filter."
    : theme.effects.imageTreatment === "monochrome"
      ? "Use monochrome-looking imagery through restrained color overlays, never a CSS filter."
      : "Keep images natural and use a real image element or photo placeholder.";
  const surfaceRule = theme.effects.surface === "translucent"
    ? "Surfaces may be translucent solid or gradient rectangles, without blur."
    : theme.effects.surface === "gradient"
      ? "Use restrained extractable CSS gradients only on real rectangular layers."
      : "Use flat, solid surfaces with deliberate contrast.";
  const backgroundRule = theme.backgroundImageMode === "generated"
    ? 'Generate exactly one topic-specific full-bleed photo placeholder as the FIRST child of .slide: <div class="photo theme-background" data-theme-background="true" data-theme-overlay="0.42" data-brief="specific English documentary-photo description"></div>. This is the locked slide background, not a content image.'
    : theme.backgroundImageUrl
    ? "A supplied full-bleed background image is locked behind this slide. Do not create another background image; put all text on one or two readable surface panels above it."
    : "No locked background image is supplied.";

  return `THEME: ${theme.name}

${tokensForPrompt(theme)}

VISUAL SYSTEM:
- Surface: ${surfaceRule}
- Background: ${backgroundRule}
- Corners: ${theme.effects.radius}; shadow: ${theme.effects.shadow}; grid: ${theme.effects.grid}; slide number: ${theme.effects.slideNumber}.
- ${imageRule}
- Art direction: ${theme.guidance.artDirection || "Follow the named visual system consistently."}
- Do: ${theme.guidance.dos.join("; ") || "Use hierarchy and purposeful whitespace."}
- Don't: ${theme.guidance.donts.join("; ") || "Do not repeat one composition on every slide."}

SELECTED LAYOUT RECIPE: ${recipe.name}
Description: ${recipe.description}
Composition: ${recipe.composition}
Composition rule: ${compositionRules[recipe.composition] ?? "Keep one clear visual anchor and balance the supporting content around it."}
Required content regions:
${regions}
Decorations to render as real elements: ${decorations}
Recipe instruction: ${recipe.instructions || "Follow the composition while adapting content to the outline."}`;
}

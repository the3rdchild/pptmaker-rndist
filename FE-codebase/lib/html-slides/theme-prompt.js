import { tokensForPrompt } from "./design-system.js";

const placement = {
  left: "left side", center: "centre", right: "right side", top: "top", bottom: "bottom", background: "background layer",
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
  const backgroundRule = theme.backgroundImageUrl
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
Required content regions:
${regions}
Decorations to render as real elements: ${decorations}
Recipe instruction: ${recipe.instructions || "Follow the composition while adapting content to the outline."}`;
}

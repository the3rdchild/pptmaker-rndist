import assert from "node:assert/strict";
import test from "node:test";

import { buildFreestyleThemePrompt, themeFromDraft } from "./freestyle-theme.js";

const draft = () => ({
  name: "Tidal Ledger",
  description: "Sea-glass greens over deep ink for a coastal economics deck.",
  backgroundImageMode: "none",
  colors: {
    background: "#0B1F24", surface: "#12303A", primary: "#3FB8A5", secondary: "#8FB9B0",
    accent: "#F2C14E", text: "#F4F7F5", muted: "#B6CCC6", border: "#24505A",
  },
  typography: { headingFont: "Fraunces", bodyFont: "Inter", scale: "expressive" },
  effects: { surface: "flat", radius: "soft", shadow: "subtle", imageTreatment: "natural", grid: "none", slideNumber: "rule" },
  guidance: { artDirection: "Horizon lines split every slide.", dos: ["Anchor numbers large"], donts: ["No drop shadows on text"] },
  recipes: [
    { id: "cover", name: "Cover", roles: ["cover"], composition: "full-bleed", regions: [{ kind: "heading", placement: "left", emphasis: "primary" }], decorations: ["accent-rule"] },
    { id: "content-split", name: "Split", roles: ["content"], composition: "split-left", regions: [], decorations: [] },
  ],
});

test("fills the fields the model is not asked for and validates the rest", () => {
  const theme = themeFromDraft(draft());
  assert.equal(theme.schemaVersion, 1);
  assert.equal(theme.id, "ai-tidal-ledger");
  assert.equal(theme.backgroundImageUrl, null);
  assert.equal(theme.recipes.length, 2);
});

test("a font outside the editor catalogue is rejected with the validator's reason", () => {
  const bad = draft();
  bad.typography.headingFont = "Comic Neue";
  assert.throws(() => themeFromDraft(bad), /headingFont/);
});

test("unreadable text is rejected so the model can be told what to fix", () => {
  const bad = draft();
  bad.colors.text = "#1A3A40";
  assert.throws(() => themeFromDraft(bad), /colors\.text .* needs at least 4\.5:1/);
});

test("a locked background is never offered — there is no asset to lock to", () => {
  const prompt = buildFreestyleThemePrompt({ title: "Deck", slides: [{ role: "cover", heading: "Hi" }] });
  assert.match(prompt, /"backgroundImageMode": "none" \| "generated"/);
  assert.doesNotMatch(prompt, /"locked"/);
});

test("repair feedback is carried into the next prompt", () => {
  const prompt = buildFreestyleThemePrompt({ title: "Deck", slides: [] }, "colors.text is too dark");
  assert.match(prompt, /REJECTED[\s\S]*colors\.text is too dark/);
});

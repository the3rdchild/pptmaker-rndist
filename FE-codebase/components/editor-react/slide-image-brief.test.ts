import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
const moduleUnderTest = await import("./slide-image-brief.ts").catch(() => ({}));
const buildSlidePhotoRequest = (moduleUnderTest as {
  buildSlidePhotoRequest?: (input: {
    imageBrief?: string;
    subject?: string;
    deckTopic?: string;
    slotHint?: string;
    additionalGuidance?: string;
    style: string;
  }) => { prompt: string; searchHint: string };
}).buildSlidePhotoRequest;

test("keeps the page subject when a template slot also has a generic hint", () => {
  assert.equal(typeof buildSlidePhotoRequest, "function");
  const request = buildSlidePhotoRequest!({
    imageBrief: "A barista pouring latte art beside a brass espresso machine",
    subject: "Pertumbuhan kedai kopi",
    deckTopic: "# Industri kopi\n## Pertumbuhan\n...",
    slotHint: "Use a friendly lifestyle photograph in landscape orientation",
    style: "editorial photograph, no text",
  });

  assert.equal(
    request.prompt,
    "A barista pouring latte art beside a brass espresso machine. Slot composition: Use a friendly lifestyle photograph in landscape orientation. editorial photograph, no text",
  );
  assert.equal(
    request.searchHint,
    "A barista pouring latte art beside a brass espresso machine",
  );
});

test("keeps the approved page subject authoritative during visual-review replacement", () => {
  assert.equal(typeof buildSlidePhotoRequest, "function");
  const request = buildSlidePhotoRequest!({
    imageBrief: "A mangrove researcher measuring young trees in a coastal restoration plot",
    subject: "Pemulihan Mangrove",
    deckTopic: "Ekosistem pesisir",
    slotHint: "wide image",
    additionalGuidance: "Show clearer human activity and stronger foreground depth",
    style: "documentary photograph, no text",
  });

  assert.match(request.prompt, /^A mangrove researcher measuring young trees/);
  assert.match(request.prompt, /Additional guidance: Show clearer human activity/);
  assert.equal(
    request.searchHint,
    "A mangrove researcher measuring young trees in a coastal restoration plot",
  );
});

test("falls back to the slide subject instead of the whole serialized outline", () => {
  assert.equal(typeof buildSlidePhotoRequest, "function");
  const request = buildSlidePhotoRequest!({
    imageBrief: "",
    subject: "Pelabuhan hijau masa depan",
    deckTopic: "# Logistik\n## Masa Kini\n...\n## Masa Depan\n...",
    slotHint: "",
    style: "cinematic lighting",
  });

  assert.equal(request.prompt, "Pelabuhan hijau masa depan. cinematic lighting");
  assert.equal(request.searchHint, "Pelabuhan hijau masa depan");
  assert.doesNotMatch(request.prompt, /Masa Kini/);
});

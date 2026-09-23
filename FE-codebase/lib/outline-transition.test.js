import assert from "node:assert/strict";
import test from "node:test";

import { formatTransitionLine, isTransitionLine, parseTransitionLine } from "./outline-transition.js";

test("reads the id and the note across the separators models actually write", () => {
  assert.deepEqual(parseTransitionLine("Transition: morph — judul mengecil ke kiri atas"), { transition: "morph", note: "judul mengecil ke kiri atas" });
  assert.deepEqual(parseTransitionLine("transition: fade-black - babak baru"), { transition: "fade-black", note: "babak baru" });
  assert.deepEqual(parseTransitionLine("Transisi: slide-left: langkah berikutnya"), { transition: "slide-left", note: "langkah berikutnya" });
  assert.deepEqual(parseTransitionLine("Transition: morph"), { transition: "morph", note: "" });
});

test("maps loose words onto real ids and rejects unknown ones", () => {
  assert.equal(parseTransitionLine("Transition: Fade — x").transition, "fade-black");
  assert.equal(parseTransitionLine("Transition: magic-move").transition, "morph");
  assert.equal(parseTransitionLine("Transition: spin — x"), null);
  assert.equal(isTransitionLine("Transition: spin — x"), true, "still recognised as a transition line");
  assert.equal(parseTransitionLine("Visual: a harbour"), null);
});

test("round-trips through the formatter", () => {
  const line = formatTransitionLine({ transition: "morph", note: "  foto   geser ke kanan " });
  assert.equal(line, "Transition: morph — foto geser ke kanan");
  assert.deepEqual(parseTransitionLine(line), { transition: "morph", note: "foto geser ke kanan" });
  assert.equal(formatTransitionLine({ transition: "none" }), "Transition: none");
});

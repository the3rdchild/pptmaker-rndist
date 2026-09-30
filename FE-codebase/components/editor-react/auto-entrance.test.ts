import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAnimationPlan } from "./animation-sequence";
import { applyAutoEntrance, prepareGeneratedEntrance, recoverPartialAutoEntrance } from "./auto-entrance";
import { walkSlideElements } from "./morph";
import { MAX_ANIMATION_FLIGHTS } from "./animation-sequence";

const box = (x: number, y: number, width: number, height: number) => ({ position: { x, y }, size: { width, height } });
const htmlSlide = {
  elements: [
    { type: "rectangle", ...box(0, 0, 1280, 720), fill: "#101010" },
    { type: "text", ...box(64, 64, 700, 90), font: { size: 56 }, runs: [{ text: "Judul" }] },
    { type: "image", ...box(700, 200, 500, 400), data: "https://img.example/a.jpg" },
    { type: "text", ...box(64, 220, 560, 60), font: { size: 20 }, runs: [{ text: "Poin satu" }] },
    { type: "text", ...box(64, 300, 560, 60), font: { size: 20 }, runs: [{ text: "Poin dua" }] },
  ],
};

test("builds the slide as one click-free cascade in reading order, sparing the backdrop", () => {
  const animated = applyAutoEntrance(htmlSlide)!;
  const steps = walkSlideElements(animated).map((ref) => [ref.element.type, (ref.element.animations as { effect: string; delay: number }[] | undefined)?.[0] ?? null]);
  assert.equal(steps[0][1], null, "the full-slide backdrop is not animated");
  assert.deepEqual(steps.slice(1).map(([type, step]) => [type, step?.effect, step?.delay]), [
    ["text", "rise", 0],
    // same 40px reading band as "Poin satu", which sits further left
    ["image", "fade-in", 180],
    ["text", "rise", 90],
    ["text", "rise", 270],
  ]);
  const plan = buildAnimationPlan(animated);
  assert.equal(plan.groups.length, 1, "one group: Present Mode plays it without a click");
  assert.ok(plan.groups[0].durationMs <= 1400 + 450);
  assert.equal(htmlSlide.elements[1].hasOwnProperty("animations"), false, "input is not mutated");
});

test("a slide with nothing but a backdrop gets no build", () => {
  assert.equal(applyAutoEntrance({ elements: [htmlSlide.elements[0]] }), null);
});

test("a dense generated slide animates every eligible element up to the flight budget", () => {
  const dense = { elements: Array.from({ length: 62 }, (_, index) => ({
    type: "text", ...box(40, index * 9, 180, 20), runs: [{ text: `Item ${index}` }],
  })) };
  const animated = applyAutoEntrance(dense)!;
  assert.equal(walkSlideElements(animated).filter((ref) => ref.element.animations).length, 62);
  assert.ok(MAX_ANIMATION_FLIGHTS >= 62);
});

test("over-budget auto entrance leaves the planned slide transition intact", () => {
  const tooDense = { elements: Array.from({ length: MAX_ANIMATION_FLIGHTS + 1 }, (_, index) => ({
    type: "text", ...box(40, index * 9, 180, 20), runs: [{ text: `Item ${index}` }],
  })) };
  assert.equal(applyAutoEntrance(tooDense), null);
  assert.equal(prepareGeneratedEntrance(tooDense, "none").transition, "none");
  assert.equal(prepareGeneratedEntrance(tooDense, "slide-left").transition, "slide-left");
  assert.equal(prepareGeneratedEntrance(tooDense, "morph").transition, "morph");
});

test("legacy 40-element auto entrance is completed for playback without changing stored ui", () => {
  const elements = Array.from({ length: 43 }, (_, index) => ({
    type: "text", ...box(40, index * 9, 180, 20), runs: [{ text: `Item ${index}` }],
    ...(index < 40 ? { animations: [{
      effect: "rise", trigger: index === 0 ? "after-previous" : "with-previous",
      order: index + 1, duration: 450, delay: Math.min(index * 90, 1400), easing: "ease-out",
    }] } : {}),
  }));
  const oldSlide = { elements };
  const repaired = recoverPartialAutoEntrance(oldSlide)!;
  assert.equal(repaired.overflow, false);
  assert.equal(walkSlideElements(repaired.ui).filter((ref) => ref.element.animations).length, 43);
  assert.equal(walkSlideElements(oldSlide).filter((ref) => ref.element.animations).length, 40);
  const authored = structuredClone(oldSlide);
  authored.elements[0].animations![0].effect = "pop";
  assert.equal(recoverPartialAutoEntrance(authored), null, "manual animation edits are preserved");
});

test("an over-budget legacy deck uses a whole-slide fade, without retaining a partial build", () => {
  const oldSlide = { elements: Array.from({ length: MAX_ANIMATION_FLIGHTS + 1 }, (_, index) => ({
    type: "text", ...box(40, index * 9, 180, 20), runs: [{ text: `Item ${index}` }],
    ...(index < 40 ? { animations: [{
      effect: "rise", trigger: index === 0 ? "after-previous" : "with-previous",
      order: index + 1, duration: 450, delay: Math.min(index * 90, 1400), easing: "ease-out",
    }] } : {}),
  })) };
  const repaired = recoverPartialAutoEntrance(oldSlide)!;
  assert.equal(repaired.overflow, true);
  assert.equal(walkSlideElements(repaired.ui).filter((ref) => ref.element.animations).length, 0);
});

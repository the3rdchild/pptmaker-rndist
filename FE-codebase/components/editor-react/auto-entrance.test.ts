import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAnimationPlan } from "./animation-sequence";
import { applyAutoEntrance } from "./auto-entrance";
import { walkSlideElements } from "./morph";

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

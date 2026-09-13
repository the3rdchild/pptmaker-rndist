import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ChromeSession } from "./chrome-session.js";
import { extractSlide } from "./dom-extract.js";

test("merges styled fragments only inside the same horizontal text flow", async () => {
  const fixturePath = join(tmpdir(), `dom-extract-${process.pid}.html`);
  await writeFile(
    fixturePath,
    `<!doctype html>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0 }
        .slide { position: relative; width: 1280px; height: 720px; background: white }
        .sentence { position: absolute; left: 40px; top: 40px; display: flex; align-items: baseline; gap: 8px }
        .sentence span, .independent { font: 16px/1.4 Arial; color: rgb(20, 20, 20) }
        .independent { position: absolute; top: 100px }
      </style>
      <section class="slide">
        <div class="sentence"><span>Energy</span><span style="font-weight: 700; color: rgb(200, 0, 0)">release</span><span>is large</span><span>.</span></div>
        <p class="independent" style="left: 40px">Alpha</p>
        <p class="independent" style="left: 100px">Beta</p>
      </section>`,
  );

  const chrome = await ChromeSession.launch();
  try {
    await chrome.loadFile(fixturePath);
    const extracted = await chrome.evaluate(`(${extractSlide.toString()})()`);
    const textElements = extracted.elements.filter((element) => element.type === "text");

    assert.deepEqual(
      textElements.map((element) => element.runs.map((run) => run.text).join("")),
      ["Energy release is large.", "Alpha", "Beta"],
    );
    assert.equal(textElements[0].runs.length, 3);
    assert.equal(textElements[0].runs[1].font.bold, true);
    assert.equal(textElements[0].runs[1].font.color, "#C80000");
  } finally {
    await chrome.close();
    await rm(fixturePath, { force: true });
  }
});

test("preserves element geometry that intentionally overflows the slide", async () => {
  const fixturePath = join(tmpdir(), `dom-extract-overflow-${process.pid}.html`);
  await writeFile(
    fixturePath,
    `<!doctype html>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0 }
        html, body { width: 1280px; height: 720px; overflow: hidden }
        .slide { position: relative; width: 1280px; height: 720px; overflow: hidden; background: white }
        .overflowing { position: absolute; left: 1200px; top: 680px; width: 300px; height: 200px; background: rgb(255, 0, 0) }
      </style>
      <section class="slide"><div class="overflowing"></div></section>`,
  );

  const chrome = await ChromeSession.launch();
  try {
    await chrome.loadFile(fixturePath);
    const extracted = await chrome.evaluate(`(${extractSlide.toString()})()`);
    const rectangle = extracted.elements.find(
      (element) =>
        element.type === "rectangle" && element.fill?.color === "#FF0000",
    );

    assert.ok(rectangle);
    assert.deepEqual(rectangle.position, { x: 1200, y: 680 });
    assert.deepEqual(rectangle.size, { width: 300, height: 200 });
  } finally {
    await chrome.close();
    await rm(fixturePath, { force: true });
  }
});

test("extracts absolutely positioned descendants from a zero-height wrapper", async () => {
  const fixturePath = join(tmpdir(), `dom-extract-absolute-child-${process.pid}.html`);
  await writeFile(
    fixturePath,
    `<!doctype html>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0 }
        .slide { position: relative; width: 1280px; height: 720px; background: white }
        .collage { position: absolute; left: 500px; top: 40px; width: 690px; height: 640px }
        .tile { width: auto; height: 0 }
        .photo { position: absolute; left: 30px; top: 20px; width: 240px; height: 160px }
        .label { position: absolute; left: 80px; top: 140px; width: 220px; height: 70px; background: white }
        .label p { font: 20px/1.2 Arial; color: rgb(10, 20, 30) }
      </style>
      <section class="slide">
        <section class="collage">
          <div class="tile">
            <img class="photo" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='160'%3E%3Crect width='240' height='160' fill='blue'/%3E%3C/svg%3E">
            <div class="label"><p>Absolute card</p></div>
          </div>
        </section>
      </section>`,
  );

  const chrome = await ChromeSession.launch();
  try {
    await chrome.loadFile(fixturePath);
    const extracted = await chrome.evaluate(`(${extractSlide.toString()})()`);

    assert.equal(
      extracted.elements.filter((element) => element.type === "image").length,
      1,
    );
    assert.equal(
      extracted.elements
        .filter((element) => element.type === "text")
        .map((element) => element.runs.map((run) => run.text).join(""))
        .includes("Absolute card"),
      true,
    );
  } finally {
    await chrome.close();
    await rm(fixturePath, { force: true });
  }
});

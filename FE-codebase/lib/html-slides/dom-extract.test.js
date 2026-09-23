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
            <img class="photo" data-credit="Ayu Photo" data-credit-url="https://photos.test/ayu" data-source-url="https://photos.test/image/1" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='160'%3E%3Crect width='240' height='160' fill='blue'/%3E%3C/svg%3E">
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
    const imageElement = extracted.elements.find((element) => element.type === "image");
    assert.equal(imageElement.credit, "Ayu Photo");
    assert.equal(imageElement.credit_url, "https://photos.test/ayu");
    assert.equal(imageElement.source_url, "https://photos.test/image/1");
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

test("maps the locked theme image to slide background instead of a canvas element", async () => {
  const fixturePath = join(tmpdir(), `dom-extract-theme-background-${process.pid}.html`);
  const image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1280' height='720'%3E%3Crect width='1280' height='720' fill='navy'/%3E%3C/svg%3E";
  await writeFile(
    fixturePath,
    `<!doctype html><style>
      * { box-sizing: border-box; margin: 0; padding: 0 }
      .slide { position: relative; width: 1280px; height: 720px; background: rgb(3, 16, 36) }
      .theme-background { position: absolute; inset: 0; width: 100%; height: 100% }
      h1 { position: absolute; left: 80px; top: 80px; font: 48px Arial; color: white }
    </style><section class="slide"><img class="theme-background" data-theme-background data-theme-overlay="0.36" src="${image}"><h1>Theme title</h1></section>`,
  );

  const chrome = await ChromeSession.launch();
  try {
    await chrome.loadFile(fixturePath);
    const extracted = await chrome.evaluate(`(${extractSlide.toString()})()`);
    assert.deepEqual(extracted.backgroundStyle, {
      type: "image",
      from: "#031024",
      imageUrl: image,
      overlayOpacity: 0.36,
    });
    assert.equal(extracted.elements.filter((element) => element.type === "image").length, 0);
  } finally {
    await chrome.close();
    await rm(fixturePath, { force: true });
  }
});

test("carries data-morph onto the extracted element, once per source node", async () => {
  const fixturePath = join(tmpdir(), `dom-extract-morph-${process.pid}.html`);
  await writeFile(
    fixturePath,
    `<!doctype html>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0 }
        .slide { position: relative; width: 1280px; height: 720px; background: white }
        h1 { position: absolute; left: 64px; top: 64px; font: 700 48px/1.2 Arial }
        .card { position: absolute; left: 64px; top: 300px; width: 400px; height: 200px;
                background: rgb(230, 230, 250); border-left: 6px solid rgb(90, 60, 200) }
      </style>
      <section class="slide">
        <h1 data-morph="title">Kopi Nusantara</h1>
        <div class="card" data-morph="card"></div>
        <p style="position:absolute;left:600px;top:300px;font:16px Arial">Tanpa morph</p>
      </section>`,
  );

  const chrome = await ChromeSession.launch();
  try {
    await chrome.loadFile(fixturePath);
    const extracted = await chrome.evaluate(`(${extractSlide.toString()})()`);
    const ids = extracted.elements.map((element) => element.morph_id ?? null);
    assert.ok(ids.includes("title"));
    assert.ok(ids.includes("card"));
    const plain = extracted.elements.find((element) => element.runs?.[0]?.text === "Tanpa morph");
    assert.equal(plain.morph_id, undefined);
    const tagged = ids.filter(Boolean);
    assert.equal(new Set(tagged).size, tagged.length, "no id appears twice on one slide");
  } finally {
    await chrome.close();
    await rm(fixturePath, { force: true });
  }
});

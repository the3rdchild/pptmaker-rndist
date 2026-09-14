import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ChromeSession, imageReadinessScript } from "./chrome-session.js";

function runInFakePage(script, document) {
  return Function("document", `return (${script});`)(document);
}

test("clears an event timeout after the CDP event arrives", async () => {
  const socket = new EventTarget();
  socket.send = () => {};
  const session = new ChromeSession({ kill() {} }, socket, "");
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let cleared = false;
  global.setTimeout = () => 42;
  global.clearTimeout = (id) => { if (id === 42) cleared = true; };

  try {
    const waiting = session.once("Page.domContentEventFired", 30000);
    socket.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({ method: "Page.domContentEventFired", params: {} }),
    }));
    await waiting;
    assert.equal(cleared, true);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test("settles a page whose image never loads within the configured timeout", async () => {
  const started = Date.now();
  const result = await runInFakePage(imageReadinessScript(10), {
    fonts: { ready: Promise.resolve() },
    images: [{ complete: false, addEventListener() {} }],
  });

  assert.equal(result.imagesTimedOut, true);
  assert.ok(Date.now() - started < 250, "the page image wait must not hang indefinitely");
});

test("does not flag a page whose fonts and images already settled", async () => {
  const result = await runInFakePage(imageReadinessScript(10), {
    fonts: { ready: Promise.resolve() },
    images: [{ complete: true }],
  });

  assert.deepEqual(result, { fontsTimedOut: false, imagesTimedOut: false });
});

test("loads a page after DOM content even when its image request never responds", async () => {
  const sockets = new Set();
  const server = createServer(() => {
    // Deliberately leave the image response pending.
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const dir = mkdtempSync(join(tmpdir(), "html-slides-timeout-test-"));
  const path = join(dir, "pending-image.html");
  writeFileSync(path, `<img src="http://127.0.0.1:${address.port}/never.png">`, "utf8");
  const chrome = await ChromeSession.launch();

  try {
    const finished = await Promise.race([
      chrome.loadFile(path, { assetTimeoutMs: 20 }).then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 1000)),
    ]);
    assert.equal(finished, true, "a pending image must not hold Page.loadEventFired open");
  } finally {
    await chrome.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

// Headless Chrome driven over the DevTools Protocol, with no npm dependency.
//
// The pipeline needs to run script INSIDE the rendered page and read a value
// back, which --print-to-pdf and --dump-dom cannot do, so this opens a real CDP
// websocket. Node 22+ ships a global WebSocket, so a raw CDP client is ~100
// lines and keeps the eventual worker sidecar dependency-free.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

function locateChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("Chrome not found. Set CHROME_PATH.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A slow third-party image must not freeze the complete deck. This is kept as
 * a page expression so Chrome can wait for DOM image events without holding a
 * CDP request open forever. */
export const ASSET_READY_TIMEOUT_MS = 12000;

export function imageReadinessScript(timeoutMs = ASSET_READY_TIMEOUT_MS) {
  const timeout = Number.isInteger(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : ASSET_READY_TIMEOUT_MS;
  return `
    (async () => {
      const settleWithin = (promise) => new Promise((resolve) => {
        let settled = false;
        const finish = (ready) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(ready);
        };
        const timer = setTimeout(() => finish(false), ${timeout});
        Promise.resolve(promise).then(() => finish(true), () => finish(true));
      });
      const images = [...document.images].map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.addEventListener("load", resolve, { once: true });
              img.addEventListener("error", resolve, { once: true });
            }),
      );
      const [fontsReady, imagesReady] = await Promise.all([
        settleWithin(document.fonts?.ready ?? Promise.resolve()),
        settleWithin(Promise.all(images)),
      ]);
      return { fontsTimedOut: !fontsReady, imagesTimedOut: !imagesReady };
    })()
  `;
}

async function waitForDevTools(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      // not up yet
    }
    await sleep(120);
  }
  throw new Error(`Chrome DevTools did not come up on port ${port}`);
}

export class ChromeSession {
  constructor(proc, ws, userDataDir) {
    this.proc = proc;
    this.ws = ws;
    this.userDataDir = userDataDir;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (event) => this.#onMessage(event.data));
  }

  static async launch({ width = 1280, height = 720 } = {}) {
    const chrome = locateChrome();
    const userDataDir = mkdtempSync(join(tmpdir(), "html-slides-"));
    const port = 9400 + Math.floor(Math.random() * 500);
    const proc = spawn(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        `--window-size=${width},${height}`,
        `--user-data-dir=${userDataDir}`,
        `--remote-debugging-port=${port}`,
        "about:blank",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    await waitForDevTools(port);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("Chrome exposed no page target");

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("CDP websocket failed")), { once: true });
    });

    const session = new ChromeSession(proc, ws, userDataDir);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    return session;
  }

  #onMessage(raw) {
    const message = JSON.parse(raw);
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`CDP ${message.error.message}`));
      else resolve(message.result);
      return;
    }
    const waiters = this.listeners.get(message.method);
    if (waiters) {
      this.listeners.delete(message.method);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(message.params);
      }
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const list = this.listeners.get(method) ?? [];
      const waiter = { resolve, timer: null };
      waiter.timer = setTimeout(() => {
        const pending = this.listeners.get(method) ?? [];
        this.listeners.set(method, pending.filter((entry) => entry !== waiter));
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      list.push(waiter);
      this.listeners.set(method, list);
    });
  }

  async loadFile(path, { assetTimeoutMs = ASSET_READY_TIMEOUT_MS } = {}) {
    const url = "file:///" + path.replace(/\\/g, "/").replace(/^\/+/, "");
    // `Page.loadEventFired` waits for every network image. A third-party image
    // can keep that event pending forever, so start geometry settling as soon
    // as the DOM is available and enforce our own bounded asset wait below.
    const contentLoaded = this.once("Page.domContentEventFired");
    await this.send("Page.navigate", { url });
    await contentLoaded;
    // Geometry should wait for assets when possible, but an external image can
    // leave its network request pending indefinitely. Continue after the
    // bounded wait so this single slide cannot stall every later worker.
    const readiness = await this.evaluate(imageReadinessScript(assetTimeoutMs));
    if (readiness?.fontsTimedOut || readiness?.imagesTimedOut) {
      console.warn(
        `[html-slides] assets timed out after ${assetTimeoutMs}ms ` +
          `(fonts=${Boolean(readiness.fontsTimedOut)}, images=${Boolean(readiness.imagesTimedOut)})`,
      );
    }
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const text =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "unknown";
      throw new Error(`Page script failed: ${text}`);
    }
    return result.result.value;
  }

  async screenshot() {
    const { data } = await this.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: 1280, height: 720, scale: 1 },
      captureBeyondViewport: true,
    });
    return Buffer.from(data, "base64");
  }

  async close() {
    try {
      this.ws.close();
    } catch {
      // already gone
    }
    this.proc.kill();
    await sleep(150);
    try {
      rmSync(this.userDataDir, { recursive: true, force: true });
    } catch {
      // the OS temp dir will get it
    }
  }
}

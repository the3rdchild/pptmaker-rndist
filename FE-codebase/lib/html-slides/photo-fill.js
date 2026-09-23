// Replaces the model's <div class="photo" data-brief="..."> placeholders with
// real <img> tags before the page is rendered.
//
// The model never writes an image URL — same split as the template pipeline,
// where the generator states what a photo slot needs and the server decides
// what fills it. Here that is an Unsplash search; in the worker it would be the
// existing stock-image / DeepInfra path.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

let accessKey = null;
function unsplashKey() {
  if (accessKey !== null) return accessKey;
  // Inside Next the key is already in process.env from .env.local; the file
  // read is only for running this from the CLI.
  accessKey = (process.env.UNSPLASH_ACCESS_KEY ?? "").trim();
  if (!accessKey) {
    const path = join(HERE, "..", "..", ".env.local");
    if (existsSync(path)) {
      const match = readFileSync(path, "utf8").match(/^\s*UNSPLASH_ACCESS_KEY\s*=\s*(.+)$/m);
      accessKey = match ? match[1].trim() : "";
    }
  }
  return accessKey;
}

const cache = new Map();

async function findPhoto(brief) {
  if (cache.has(brief)) return cache.get(brief);
  const key = unsplashKey();
  let url = null;
  if (key) {
    const endpoint = new URL("https://api.unsplash.com/search/photos");
    endpoint.searchParams.set("query", brief);
    endpoint.searchParams.set("per_page", "1");
    endpoint.searchParams.set("orientation", "landscape");
    endpoint.searchParams.set("content_filter", "high");
    try {
      const response = await fetch(endpoint, {
        headers: { Authorization: `Client-ID ${key}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        const data = await response.json();
        url = data?.results?.[0]?.urls?.regular ?? null;
      }
    } catch {
      url = null;
    }
  }
  cache.set(brief, url);
  return url;
}

function attributes(tag) {
  const out = {};
  for (const match of tag.matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) {
    out[match[1]] = match[2];
  }
  return out;
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** Makes a generated full-bleed photo deterministic. The model is invited to
 * provide this slot, but missing it must not downgrade an image-led theme to a
 * plain card layout. */
export function ensureThemeBackgroundPlaceholder(sectionHtml, brief) {
  if (/\btheme-background\b[^>]*\bdata-theme-background\b|\bdata-theme-background\b[^>]*\btheme-background\b/i.test(sectionHtml)) {
    return sectionHtml;
  }
  const safeBrief = String(brief || "cinematic documentary background").replace(/"/g, "&quot;");
  return sectionHtml.replace(
    /^(<section(?=[^>]*\bclass\s*=\s*(?:"[^"]*\bslide\b[^"]*"|'[^']*\bslide\b[^']*'))[^>]*>)/i,
    `$1<div class="photo theme-background" data-theme-background="true" data-theme-overlay="0.42" data-brief="${safeBrief}"></div>`,
  );
}

/**
 * @param {string} sectionHtml
 * @param {object} [options]
 * @param {Record<string, string|{url: string, extra?: object}>} [options.reusePhotos]
 *   Photos already resolved on the previous slide, by `data-morph` id. A
 *   placeholder carrying one of those ids takes that exact photo instead of a
 *   new search — a morph between two different pictures reads as a glitch.
 */
export async function fillPhotos(sectionHtml, { resolvePhoto = findPhoto, photoContext, reusePhotos = {} } = {}) {
  const placeholder = /<div([^>]*\bclass\s*=\s*"[^"]*\bphoto\b[^"]*"[^>]*)>\s*<\/div>/gi;
  const slots = [];
  for (const match of sectionHtml.matchAll(placeholder)) {
    const parsed = attributes(match[1]);
    slots.push({ brief: parsed["data-brief"] || "abstract background texture", morph: parsed["data-morph"] || "" });
  }
  const resolvedPhotos = await Promise.all(
    slots.map(({ brief, morph }) => (morph && reusePhotos[morph]) || resolvePhoto(brief, photoContext)),
  );
  const unresolved = slots
    .filter((_slot, slotIndex) => !resolvedPhotos[slotIndex])
    .map((slot) => slot.brief);
  /** Resolved photos by morph id, for the next slide in a morph chain. */
  const morphPhotos = {};
  slots.forEach(({ morph }, slotIndex) => {
    if (morph && resolvedPhotos[slotIndex]) morphPhotos[morph] = resolvedPhotos[slotIndex];
  });

  let index = 0;
  const filled = sectionHtml.replace(placeholder, (full, attrs) => {
    const parsed = attributes(attrs);
    const brief = parsed["data-brief"] || "abstract background texture";
    const resolved = resolvedPhotos[index++];
    if (!resolved) return full;
    const url = typeof resolved === "string" ? resolved : resolved.url;
    const extra = typeof resolved === "string" ? null : resolved.extra;
    if (!url) return full;
    const style = parsed.style ? ` style="${parsed.style}"` : "";
    const className = parsed.class || "photo";
    const themeBackground = /\bdata-theme-background(?:\s|=|>)/i.test(attrs) ? " data-theme-background" : "";
    const themeOverlay = parsed["data-theme-overlay"] ? ` data-theme-overlay="${parsed["data-theme-overlay"]}"` : "";
    const morph = parsed["data-morph"] ? ` data-morph="${escapeAttribute(parsed["data-morph"])}"` : "";
    const attribution = [
      extra?.credit ? ` data-credit="${escapeAttribute(extra.credit)}"` : "",
      extra?.credit_url ? ` data-credit-url="${escapeAttribute(extra.credit_url)}"` : "",
      extra?.source_url ? ` data-source-url="${escapeAttribute(extra.source_url)}"` : "",
    ].join("");
    return `<img class="${className}" data-brief="${escapeAttribute(brief)}"${themeBackground}${themeOverlay}${morph}${attribution}${style} src="${escapeAttribute(url)}" alt="">`;
  });

  return { html: filled, count: slots.length - unresolved.length, unresolved, morphPhotos };
}

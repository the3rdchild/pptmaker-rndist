// Replaces the model's <div class="photo" data-brief="..."> placeholders with
// real <img> tags before the page is rendered.
//
// The model never writes an image URL — same split as the template pipeline,
// where the generator states what a photo slot needs and the server decides
// what fills it. Here that is an Unsplash search; in the worker it would be the
// existing stock-image / DeepInfra path.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

let accessKey = null;
function unsplashKey() {
  if (accessKey !== null) return accessKey;
  const text = readFileSync(join(HERE, "..", "FE-codebase", ".env.local"), "utf8");
  const match = text.match(/^\s*UNSPLASH_ACCESS_KEY\s*=\s*(.+)$/m);
  accessKey = match ? match[1].trim() : "";
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
      const response = await fetch(endpoint, { headers: { Authorization: `Client-ID ${key}` } });
      if (response.ok) {
        const data = await response.json();
        url = data?.results?.[0]?.urls?.regular ?? null;
      }
    } catch {
      url = null;
    }
  }
  if (!url) {
    const seed = encodeURIComponent(brief.slice(0, 40));
    url = `https://picsum.photos/seed/${seed}/1200/800`;
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

export async function fillPhotos(sectionHtml) {
  const placeholder = /<div([^>]*\bclass\s*=\s*"[^"]*\bphoto\b[^"]*"[^>]*)>\s*<\/div>/gi;
  const briefs = [];
  for (const match of sectionHtml.matchAll(placeholder)) {
    briefs.push(attributes(match[1])["data-brief"] || "abstract background texture");
  }
  const urls = await Promise.all(briefs.map(findPhoto));

  let index = 0;
  const filled = sectionHtml.replace(placeholder, (_full, attrs) => {
    const parsed = attributes(attrs);
    const brief = parsed["data-brief"] || "abstract background texture";
    const style = parsed.style ? ` style="${parsed.style}"` : "";
    const className = parsed.class || "photo";
    return `<img class="${className}" data-brief="${brief}"${style} src="${urls[index++]}" alt="">`;
  });

  return { html: filled, count: briefs.length };
}

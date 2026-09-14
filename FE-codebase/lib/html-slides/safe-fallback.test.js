import assert from "node:assert/strict";
import test from "node:test";

import { buildSafeFallbackFragment } from "./safe-fallback.js";

test("builds a compact bounded fallback slide for a long heading", () => {
  const fragment = buildSafeFallbackFragment({
    slide: {
      heading: "Mengenal Program Studi Teknik Elektro Universitas Padjadjaran",
      brief: "Mahasiswa mempelajari sistem tenaga, elektronika, dan teknologi digital. Lulusan mampu merancang solusi teknik yang aman dan relevan.",
    },
    index: 0,
    total: 5,
  });

  assert.match(fragment.sectionHtml, /<section class="slide">/);
  assert.match(fragment.sectionHtml, /01\s*\/\s*05/);
  assert.match(fragment.styleBlock, /max-height:\s*592px/);
  assert.doesNotMatch(fragment.sectionHtml, /<img/i);
});

import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
const moduleUnderTest = await import("./photo-resolver.ts").catch(() => ({}));
const createPhotoResolver = (moduleUnderTest as {
  createPhotoResolver?: (options: Record<string, unknown>) => (brief: string, context?: Record<string, unknown>) => Promise<{
    url: string;
    extra?: { credit?: string; credit_url?: string | null; source_url?: string };
  } | null>;
}).createPhotoResolver;
const simplifyPhotoSearchQuery = (moduleUnderTest as {
  simplifyPhotoSearchQuery?: (brief: string, subject?: string) => string;
}).simplifyPhotoSearchQuery;

test("keeps billiards subject words instead of leading visual-style boilerplate", () => {
  assert.equal(typeof simplifyPhotoSearchQuery, "function");
  const query = simplifyPhotoSearchQuery!(
    "Wide cinematic documentary photograph inside a refined billiards club showing pool, snooker, and carom tables",
  );

  assert.match(query, /\bbilliards\b/i);
  assert.match(query, /\bpool\b/i);
  assert.doesNotMatch(query, /\b(?:wide|cinematic|documentary|photograph|refined)\b/i);
});

test("keeps a domain term near the end of a long approved visual", () => {
  assert.equal(typeof simplifyPhotoSearchQuery, "function");
  const query = simplifyPhotoSearchQuery!(
    "generic composition guidance",
    "Dua atlet profesional sedang berkonsentrasi sambil mempersiapkan pertandingan biliar internasional",
  );

  assert.match(query, /\bbiliar\b/i);
  assert.doesNotMatch(query, /\bgeneric\b/i);
});

test("AI image resolution keeps the page brief and selected model", async () => {
  assert.equal(typeof createPhotoResolver, "function");
  let received: Record<string, unknown> | undefined;
  const resolvePhoto = createPhotoResolver!({
    imageSource: "ai",
    sessionToken: "session-123",
    imageModel: "runware-premium",
    generateAi: async (token: string, prompt: string, options: Record<string, unknown>) => {
      received = { token, prompt, options };
      return "data:image/png;base64,abc";
    },
    searchStock: async () => ({ results: [] }),
  });

  assert.deepEqual(await resolvePhoto("A solar technician on a Jakarta rooftop"), {
    url: "data:image/png;base64,abc",
  });
  assert.deepEqual(received, {
    token: "session-123",
    prompt: "A solar technician on a Jakarta rooftop. editorial photograph, cinematic natural lighting, cohesive color grading, no text, no watermark, no logo",
    options: { model: "runware-premium", size: "1344x768" },
  });
});

test("AI image resolution treats the approved slide visual as authoritative", async () => {
  assert.equal(typeof createPhotoResolver, "function");
  let prompt = "";
  const resolvePhoto = createPhotoResolver!({
    imageSource: "ai",
    sessionToken: "session-123",
    generateAi: async (_token: string, receivedPrompt: string) => {
      prompt = receivedPrompt;
      return "data:image/png;base64,abc";
    },
    searchStock: async () => ({ results: [] }),
  });

  await resolvePhoto(
    "Wide cinematic sports photograph",
    {
      slideNumber: 1,
      heading: "Apa Itu Biliar?",
      subject: "Dua pemain membidik bola di meja biliar hijau.",
    },
  );

  assert.match(prompt, /^Dua pemain membidik bola di meja biliar hijau\./);
  assert.match(prompt, /Composition guidance: Wide cinematic sports photograph/);
});

test("stock resolution searches concise content keywords instead of a full instruction", async () => {
  assert.equal(typeof createPhotoResolver, "function");
  let query = "";
  const tracked: string[] = [];
  const resolvePhoto = createPhotoResolver!({
    imageSource: "stock",
    sessionToken: "",
    generateAi: async () => null,
    searchStock: async (_preferred: null, receivedQuery: string) => {
      query = receivedQuery;
      return { results: [{
        url: "https://example.test/coffee.jpg",
        provider: "unsplash",
        credit: "Ayu Photo",
        creditUrl: "https://unsplash.test/ayu",
        sourceUrl: "https://unsplash.test/photo/1",
        downloadLocation: "https://api.unsplash.com/photos/1/download",
      }] };
    },
    trackStockDownload: async (url: string) => { tracked.push(url); },
  });

  assert.deepEqual(
    await resolvePhoto("A friendly editorial photograph of a barista pouring coffee in a modern cafe, landscape orientation"),
    {
      url: "https://example.test/coffee.jpg",
      extra: {
        credit: "Ayu Photo",
        credit_url: "https://unsplash.test/ayu",
        source_url: "https://unsplash.test/photo/1",
      },
    },
  );
  assert.equal(query, "friendly barista pouring coffee modern cafe");
  assert.deepEqual(tracked, ["https://api.unsplash.com/photos/1/download"]);
});

test("stock resolution ranks a billiards candidate above an unrelated first result", async () => {
  assert.equal(typeof createPhotoResolver, "function");
  const resolvePhoto = createPhotoResolver!({
    imageSource: "stock",
    sessionToken: "",
    generateAi: async () => null,
    searchStock: async () => ({
      results: [
        {
          id: "basketball",
          url: "https://example.test/basketball.jpg",
          provider: "unsplash",
          description: "Two athletes playing basketball on an outdoor court",
          tags: ["basketball", "sport"],
        },
        {
          id: "billiards",
          url: "https://example.test/billiards.jpg",
          provider: "unsplash",
          description: "Two players aiming cue sticks over a green billiards table",
          tags: ["billiards", "pool", "cue"],
        },
      ],
    }),
  });

  assert.deepEqual(
    await resolvePhoto(
      "Wide cinematic documentary photograph inside a billiards club showing a pool table",
      { subject: "Dua pemain bermain biliar di meja hijau" },
    ),
    { url: "https://example.test/billiards.jpg" },
  );
});

test("approved billiards visual outranks contradictory basketball slot guidance", async () => {
  assert.equal(typeof createPhotoResolver, "function");
  let query = "";
  const resolvePhoto = createPhotoResolver!({
    imageSource: "stock",
    sessionToken: "",
    generateAi: async () => null,
    searchStock: async (_preferred: null, receivedQuery: string) => {
      query = receivedQuery;
      return {
        results: [
          {
            id: "basketball",
            url: "https://example.test/basketball.jpg",
            provider: "unsplash",
            description: "Basketball players on a green outdoor court",
            tags: ["basketball", "sport"],
          },
          {
            id: "billiards",
            url: "https://example.test/billiards.jpg",
            provider: "unsplash",
            description: "A player aiming at balls on a billiards table",
            tags: ["billiards", "pool", "cue"],
          },
        ],
      };
    },
  });

  assert.deepEqual(
    await resolvePhoto(
      "Wide sports photograph of basketball players on a green court",
      { subject: "Dua pemain membidik bola di meja biliar hijau" },
    ),
    { url: "https://example.test/billiards.jpg" },
  );
  assert.match(query, /\bbiliar\b/i);
  assert.doesNotMatch(query, /\bbasketball\b/i);
});

test("rejects basketball even when generic setting words match a billiards visual", async () => {
  assert.equal(typeof createPhotoResolver, "function");
  const resolvePhoto = createPhotoResolver!({
    imageSource: "stock",
    sessionToken: "",
    generateAi: async () => null,
    searchStock: async () => ({
      results: [{
        id: "basketball",
        url: "https://example.test/basketball.jpg",
        description: "International basketball tournament inside a modern sports club",
        tags: ["basketball", "tournament", "club"],
      }],
    }),
  });

  assert.equal(
    await resolvePhoto("indoor sports composition", {
      subject: "International billiards tournament in a modern club",
    }),
    null,
  );
});

test("recognizes Indonesian basketball as a required domain", async () => {
  assert.equal(typeof createPhotoResolver, "function");
  const resolvePhoto = createPhotoResolver!({
    imageSource: "stock",
    sessionToken: "",
    generateAi: async () => null,
    searchStock: async () => ({
      results: [{
        id: "billiards",
        url: "https://example.test/billiards.jpg",
        description: "A billiards player aiming at a pool table",
      }],
    }),
  });

  assert.equal(
    await resolvePhoto("indoor sports composition", {
      subject: "Pemain bola basket melakukan lemparan di lapangan indoor",
    }),
    null,
  );
});

test("requires every explicitly requested domain in a multi-sport visual", async () => {
  assert.equal(typeof createPhotoResolver, "function");
  const resolvePhoto = createPhotoResolver!({
    imageSource: "stock",
    sessionToken: "",
    generateAi: async () => null,
    searchStock: async () => ({
      results: [{
        id: "basketball-only",
        url: "https://example.test/basketball.jpg",
        description: "Basketball players competing on an indoor court",
      }],
    }),
  });

  assert.equal(
    await resolvePhoto("split-screen sports comparison", {
      subject: "Perbandingan olahraga biliar dan bola basket",
    }),
    null,
  );
});

test("keeps a provider-ranked bilingual result when no domain can be compared locally", async () => {
  assert.equal(typeof createPhotoResolver, "function");
  const resolvePhoto = createPhotoResolver!({
    imageSource: "stock",
    sessionToken: "",
    generateAi: async () => null,
    searchStock: async () => ({
      results: [{
        id: "container-ship",
        url: "https://example.test/container-ship.jpg",
        description: "Container ship docked at a port at sunset",
      }],
    }),
  });

  assert.deepEqual(
    await resolvePhoto("wide harbor composition", {
      subject: "Kapal kontainer berlabuh di pelabuhan saat senja",
    }),
    { url: "https://example.test/container-ship.jpg" },
  );
});

test("tracks Unsplash when provider is supplied on the production response shape", async () => {
  assert.equal(typeof createPhotoResolver, "function");
  const tracked: string[] = [];
  const resolvePhoto = createPhotoResolver!({
    imageSource: "stock",
    sessionToken: "",
    generateAi: async () => null,
    searchStock: async () => ({
      provider: "unsplash",
      results: [{
        id: "billiards",
        url: "https://example.test/billiards.jpg",
        description: "A pool table with cue balls",
        downloadLocation: "https://api.unsplash.com/photos/billiards/download",
      }],
    }),
    trackStockDownload: async (url: string) => { tracked.push(url); },
  });

  await resolvePhoto("pool table", { subject: "Meja biliar dengan bola dan cue" });
  assert.deepEqual(tracked, ["https://api.unsplash.com/photos/billiards/download"]);
});

test("stock resolution leaves the slot unresolved when no result matches the slide subject", async () => {
  assert.equal(typeof createPhotoResolver, "function");
  const resolvePhoto = createPhotoResolver!({
    imageSource: "stock",
    sessionToken: "",
    generateAi: async () => null,
    searchStock: async () => ({
      results: [{
        id: "basketball",
        url: "https://example.test/basketball.jpg",
        provider: "unsplash",
        description: "Two athletes playing basketball on an outdoor court",
        tags: ["basketball", "sport"],
      }],
    }),
  });

  assert.equal(
    await resolvePhoto(
      "Wide documentary photograph of billiards players around a pool table",
      { subject: "Dua pemain biliar membidik bola di meja hijau" },
    ),
    null,
  );
});

test("returns null when the selected provider cannot produce a relevant image", async () => {
  assert.equal(typeof createPhotoResolver, "function");
  const resolvePhoto = createPhotoResolver!({
    imageSource: "stock",
    sessionToken: "",
    generateAi: async () => null,
    searchStock: async () => ({ results: [] }),
  });

  assert.equal(await resolvePhoto("mangrove restoration fieldwork"), null);
});

test("logs structured context when stock search throws", async () => {
  assert.equal(typeof createPhotoResolver, "function");
  const entries: string[] = [];
  const previousInfo = console.info;
  console.info = (...args: unknown[]) => { entries.push(args.map(String).join(" ")); };
  try {
    const resolvePhoto = createPhotoResolver!({
      imageSource: "stock",
      sessionToken: "",
      generateAi: async () => null,
      searchStock: async () => { throw new Error("provider timeout"); },
    });

    assert.equal(await resolvePhoto("pool table", {
      slideNumber: 4,
      heading: "Teknik Dasar",
      subject: "Pemain biliar melakukan bridge tangan terbuka",
    }), null);
  } finally {
    console.info = previousInfo;
  }

  assert.equal(entries.length, 1);
  assert.match(entries[0], /"slide":4/);
  assert.match(entries[0], /"approvedVisual":"Pemain biliar melakukan bridge tangan terbuka"/);
  assert.match(entries[0], /"outcome":"search-error"/);
  assert.match(entries[0], /provider timeout/);
});

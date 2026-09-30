import assert from "node:assert/strict";
import test from "node:test";
import { buildDeckSaveBody, readGenerationLog, readGenerationMetrics } from "./deck-payload.ts";

test("an existing generation log is visible and survives editing the deck", () => {
  const log = {
    costUsd: 0.01233901,
    durationSeconds: 631.97,
    provider: "openrouter-deepseek-flash",
    generationId: "existing-test-deck",
  };
  const saved = readGenerationLog({ generationLog: log });
  assert.deepEqual(readGenerationMetrics(saved), {
    costUsd: 0.01233901,
    durationMs: 631970,
  });

  const edited = buildDeckSaveBody(
    { id: "deck-1", title: "Renamed deck", slides: [{ ui: { elements: [] } }] },
    null,
    saved,
  );
  assert.equal(edited.title, "Renamed deck");
  assert.deepEqual(edited.payload.generationLog, log);
});

test("new summaries persist and blank decks have no metrics", () => {
  const log = { costUsd: 0.0012, durationMs: 92_000, completedAt: "2026-09-30T08:00:00Z" };
  const body = buildDeckSaveBody(
    { id: "deck-2", title: "New deck", slides: [] },
    "paper-editorial",
    log,
  );
  assert.deepEqual(readGenerationMetrics(body.payload.generationLog), {
    costUsd: 0.0012,
    durationMs: 92_000,
  });
  assert.equal(body.payload.deckThemeId, "paper-editorial");
  assert.equal(readGenerationMetrics(readGenerationLog({ slides: [] })), null);
});

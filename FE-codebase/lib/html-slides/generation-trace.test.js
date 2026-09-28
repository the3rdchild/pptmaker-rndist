import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createGenerationTrace, recordGenerationDiagnostic, withGenerationStage } from "./generation-trace.js";

test("the client event preserves protocol fields independently of diagnostic filtering", () => {
  const trace = createGenerationTrace({ generationId: `test-wire-${randomUUID()}`, deckId: "wire-deck", secrets: ["private-session-token"] });
  const event = { type: "slide", index: 1, transition: "morph", ui: { elements: [] }, futureProtocolField: { label: "keep me" }, message: "private-session-token" };
  const wire = trace.eventForClient?.(event);
  assert.deepEqual(wire, { ...event, message: "[REDACTED]", generationId: trace.record({}).generationId, deckId: "wire-deck" });
  assert.equal(trace.record(event).futureProtocolField, undefined, "the log still uses its smaller diagnostic schema");
});

test("retains separate concurrent stage attempts and redacts credentials from raw replies", async () => {
  const generationId = `test-trace-${randomUUID()}`;
  const trace = createGenerationTrace({ generationId, deckId: "saved-deck-42", secrets: ["private-provider-key", "private-session-token"] });
  await trace.run(async () => {
    assert.equal(trace.record({ type: "slide", transition: "morph" }).transition, "morph", "sanitized stream metadata must retain the planned transition");
    await Promise.all([1, 2].map((slide) => withGenerationStage({ stage: "slide-layout", slide, attempt: 2 }, async () => {
      await new Promise((resolve) => setImmediate(resolve));
      recordGenerationDiagnostic({ type: "provider", phase: "complete", finishReason: "length", usage: { completion_tokens: 4000, completion_tokens_details: { reasoning_tokens: 2500 } }, rawOutput: `<section>Slide ${slide} private-provider-key private-session-token`, apiKey: "private-provider-key", sessionToken: "private-session-token" });
    })));
  });
  const eventsPath = join(trace.directory, "events.ndjson");
  assert.ok(existsSync(eventsPath), "a run must retain events on disk");
  const text = readFileSync(eventsPath, "utf8");
  const events = text.trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(events.every((event) => event.generationId === generationId && event.deckId === "saved-deck-42"));
  const replies = events.filter((event) => event.type === "provider");
  assert.deepEqual(replies.map((event) => [event.slide, event.attempt]), [[1, 2], [2, 2]]);
  for (const event of replies) {
    assert.equal(event.finishReason, "length");
    assert.equal(event.usage.completion_tokens_details.reasoning_tokens, 2500);
    const raw = readFileSync(join(trace.directory, event.rawOutputFile), "utf8");
    assert.match(raw, new RegExp(`<section>Slide ${event.slide}`));
    assert.doesNotMatch(raw + text, /private-provider-key|private-session-token/);
  }
  assert.equal(events.at(-1).phase, "complete");
  assert.ok(events.at(-1).durationMs >= 0);
});

test("persists the final cancellation after an in-flight operation aborts", async () => {
  const abort = new AbortController();
  const trace = createGenerationTrace({ generationId: `test-cancel-${randomUUID()}`, signal: abort.signal });
  await assert.rejects(trace.run(async () => {
    abort.abort();
    abort.signal.throwIfAborted();
  }), { name: "AbortError" });
  assert.ok(existsSync(join(trace.directory, "events.ndjson")), "cancellation must be retained even with no stream reader");
  const events = readFileSync(join(trace.directory, "events.ndjson"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(events.at(-1).phase, "cancelled");
  assert.match(events.at(-1).error, /abort/i);
});

test("retains final errors and accepted deck snapshots without request credentials", async () => {
  const trace = createGenerationTrace({ generationId: `test-error-${randomUUID()}` });
  await assert.rejects(trace.run(async () => {
    trace.writeArtifact("deck.json", JSON.stringify({ title: "Retained test deck", slides: [] }));
    throw new Error("Provider failed: authorization: Bearer secret-value");
  }), /Provider failed/);
  assert.ok(existsSync(join(trace.directory, "deck.json")), "accepted snapshots must remain available");
  const events = readFileSync(join(trace.directory, "events.ndjson"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(events.at(-1).phase, "error");
  assert.doesNotMatch(events.at(-1).error, /secret-value/);
  assert.equal(JSON.parse(readFileSync(join(trace.directory, "deck.json"), "utf8")).title, "Retained test deck");
});

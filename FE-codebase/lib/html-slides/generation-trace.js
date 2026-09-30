import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Async context keeps parallel slide chains associated with their own attempt.
// No request body, headers, prompt, or complete provider response is logged.
const context = new AsyncLocalStorage();
// Next runs from the FE project root. A relative new URL(import.meta.url)
// makes Turbopack try to bundle this writable directory as a static asset.
const TRACE_ROOT = join(process.cwd(), ".generation-traces");
const FIELDS = new Set("type phase stage slide attempt provider model durationMs maxTokens nextMaxTokens finishReason usage costUsd outputChars rawOutputFile error message feedback ok checks issues screenshot source reason name description title slides count index heading elementCount summary fromApprovedOutline completedSlides slideCount theme imageSource transition transitions withReview".split(" "));
const SECRET_KEY = /api[_-]?key|session[_-]?token|authorization|secret|password|cookie/i;

/** @param {{generationId?: string, deckId?: string|null, signal?: AbortSignal, secrets?: string[]}} options */
export function createGenerationTrace({ generationId = randomUUID(), deckId = null, signal, secrets = [] } = {}) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(generationId)) throw new Error("Invalid generation trace id");
  const directory = join(TRACE_ROOT, generationId);
  const startedAt = Date.now();
  const privateValues = new Set([...secrets, ...Object.entries(process.env).filter(([key]) => SECRET_KEY.test(key)).map(([, value]) => value)].filter((value) => typeof value === "string" && value.length >= 4));
  let available = true;
  let sequence = 0;
  const write = (operation) => {
    if (!available) return;
    try { operation(); } catch (error) {
      available = false;
      console.warn("[html-slides][trace] Persistence unavailable", { generationId, code: error?.code ?? "WRITE_FAILED" });
    }
  };
  const redact = (value) => {
    if (typeof value === "string") {
      let result = value;
      for (const secret of privateValues) result = result.split(secret).join("[REDACTED]");
      return result.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]");
    }
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, SECRET_KEY.test(key) ? "[REDACTED]" : redact(entry)]));
    return value;
  };
  write(() => mkdirSync(directory, { recursive: true }));
  const trace = {
    get directory() { return available ? directory : null; },
    sanitizeText: (value) => redact(value),
    eventForClient: (event) => redact({ ...event, generationId, deckId }),
    writeArtifact(name, content) {
      if (!/^[A-Za-z0-9_.-]+$/.test(name) || name === "." || name === "..") throw new Error("Invalid trace artifact name");
      write(() => writeFileSync(join(directory, name), redact(content), "utf8"));
      return available ? name : null;
    },
    record(event, extraSecrets = []) {
      for (const secret of extraSecrets) if (typeof secret === "string" && secret.length >= 4) privateValues.add(secret);
      const selected = Object.fromEntries(Object.entries(event).filter(([key]) => FIELDS.has(key)));
      if (typeof event.rawOutput === "string") {
        selected.rawOutputFile = trace.writeArtifact(`reply-${++sequence}.txt`, event.rawOutput);
        selected.outputChars = event.rawOutput.length;
      }
      const safe = redact({ ...selected, generationId, deckId, timestamp: new Date().toISOString(), elapsedMs: Date.now() - startedAt });
      write(() => appendFileSync(join(directory, "events.ndjson"), `${JSON.stringify(safe)}\n`, "utf8"));
      return safe;
    },
    async run(operation) {
      return context.run({ trace, stage: "generation" }, async () => {
        trace.record({ type: "run", stage: "generation", phase: "start" });
        try {
          signal?.throwIfAborted();
          const result = await operation();
          signal?.throwIfAborted();
          trace.record({ type: "run", stage: "generation", phase: "complete", durationMs: Date.now() - startedAt });
          return result;
        } catch (error) {
          trace.record({ type: "run", stage: "generation", phase: signal?.aborted || error?.name === "AbortError" ? "cancelled" : "error", durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      });
    },
  };
  return trace;
}

export async function withGenerationStage(stage, operation) {
  const parent = context.getStore();
  if (!parent) return operation();
  return context.run({ ...parent, ...stage }, async () => {
    const startedAt = Date.now();
    recordGenerationDiagnostic({ type: "stage", phase: "start" });
    try {
      const result = await operation();
      recordGenerationDiagnostic({ type: "stage", phase: "complete", durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      recordGenerationDiagnostic({ type: "stage", phase: error?.name === "AbortError" ? "cancelled" : "error", durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  });
}

export function recordGenerationDiagnostic(event, secrets = []) {
  const active = context.getStore();
  if (!active) return;
  const { trace, ...stage } = active;
  return trace.record({ ...stage, ...event }, secrets);
}

/** Sanitize before Chrome reads the document, so retained HTML and PNGs obey
 * the same credential policy as provider replies and event metadata. */
export function redactGenerationText(text) {
  return context.getStore()?.trace.sanitizeText(text) ?? text;
}

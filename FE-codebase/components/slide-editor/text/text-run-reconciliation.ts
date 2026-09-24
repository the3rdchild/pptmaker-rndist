// The contentEditable run-reconciliation engine: reconciles the DOM's
// (possibly markdown-rendered) TextRun[] back against the source-of-truth
// stored text/runs, and normalizes run boundaries so adjacent differently-
// styled runs don't visually fuse two words together.

import type { TextRun } from "@/components/slide-editor/types";
import { textRunsContent } from "@/components/slide-editor/text/text-runs";

export function splitTextRunsOnNewlines(runs: TextRun[]): TextRun[][] {
  const lines: TextRun[][] = [[]];

  for (const run of runs) {
    const parts = (run.text || "").split(/\r?\n/);
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (!part) return;
      lines[lines.length - 1].push({
        ...run,
        text: part,
        font: run.font ? { ...run.font } : undefined,
      });
    });
  }

  return lines;
}

function appendRunText(
  runs: TextRun[],
  text: string,
  font: TextRun["font"],
) {
  if (!text) return;
  const previous = runs[runs.length - 1];
  if (previous) {
    previous.text += text;
    return;
  }
  runs.push(font ? { text, font: { ...font } } : { text });
}

export function reconcileTextRunsWithStoredText(
  runs: TextRun[],
  storedText: string,
): TextRun[] {
  if (!storedText || runs.length === 0) return runs;
  if (containsMarkdownSyntax(storedText)) return runs;
  if (textRunsContent(runs) === storedText) return runs;

  const reconciled: TextRun[] = [];
  let cursor = 0;

  for (const run of runs) {
    const runText = run.text ?? "";
    if (!runText) continue;
    const index = storedText.indexOf(runText, cursor);
    if (index < 0) return runs;

    const gap = storedText.slice(cursor, index);
    appendRunText(reconciled, gap, run.font);
    reconciled.push(cloneTextRun(run));
    cursor = index + runText.length;
  }

  appendRunText(
    reconciled,
    storedText.slice(cursor),
    runs[runs.length - 1]?.font,
  );
  return textRunsContent(reconciled) === storedText ? reconciled : runs;
}

export function normalizeStyledSourceRunBoundaries(runs: TextRun[]): TextRun[] {
  if (runs.length < 2) return runs;

  const normalized: TextRun[] = [];
  for (const run of runs) {
    const previous = normalized[normalized.length - 1];
    if (previous && shouldPreserveStyledRunBoundarySpace(previous, run)) {
      appendRunText(normalized, " ", previous.font);
    }
    normalized.push(cloneTextRun(run));
  }

  return sameTextRuns(normalized, runs) ? runs : normalized;
}

function shouldPreserveStyledRunBoundarySpace(left: TextRun, right: TextRun) {
  if (!hasInlineStyleBoundary(left.font, right.font)) return false;
  if (!left.text || !right.text) return false;
  if (/\s$/.test(left.text) || /^\s/.test(right.text)) return false;

  const leftCharacter = left.text.match(/\S(?=\s*$)/u)?.[0];
  const rightCharacter = right.text.match(/\S/u)?.[0];
  return Boolean(
    leftCharacter &&
    rightCharacter &&
    isWordLikeBoundaryCharacter(leftCharacter) &&
    isWordLikeBoundaryCharacter(rightCharacter),
  );
}

function hasInlineStyleBoundary(
  left: TextRun["font"],
  right: TextRun["font"],
) {
  return (
    Boolean(left?.bold) !== Boolean(right?.bold) ||
    Boolean(left?.italic) !== Boolean(right?.italic) ||
    Boolean(left?.underline) !== Boolean(right?.underline)
  );
}

function isWordLikeBoundaryCharacter(character: string) {
  return /[\p{L}\p{N}%°]/u.test(character);
}

export function cloneTextRun(run: TextRun): TextRun {
  return {
    ...run,
    font: run.font ? { ...run.font } : undefined,
  };
}

export function containsMarkdownSyntax(text: string) {
  return /(\*\*|__|\*|_).+(\*\*|__|\*|_)/.test(text);
}

export function sameTextRuns(left: TextRun[], right: TextRun[]) {
  if (left.length !== right.length) return false;
  return left.every(
    (run, index) =>
      run.text === right[index]?.text &&
      JSON.stringify(run.font ?? null) ===
      JSON.stringify(right[index]?.font ?? null),
  );
}

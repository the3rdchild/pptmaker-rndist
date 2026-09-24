// --------------------------------------------------------------- xml helpers

import { asRecord } from "@/components/slide-editor/model/core";
import { type Rec } from "@/components/slide-editor/importing/pptx-context";

export function readText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  const rec = asRecord(value);
  const text = rec?.["#text"];
  return typeof text === "string" ? text : typeof text === "number" ? String(text) : "";
}

export function readAttrString(rec: Rec | null, attr: string): string | null {
  if (!rec) return null;
  const value = rec[attr];
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
}

export function readAttrNumber(rec: Rec | null, attr: string): number | null {
  const value = readAttrString(rec, attr);
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** OOXML booleans appear as both `1`/`0` and `true`/`false` depending on the
 * exporter — Canva writes `b="true"`, PowerPoint writes `b="1"`. */
export function readAttrBoolean(rec: Rec | null, attr: string): boolean | null {
  const value = readAttrString(rec, attr);
  if (value == null) return null;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Crop fractions need more precision than layout px: at 4 decimals one unit
 * is ~0.5px on a 4000px-wide sprite, below anything visible. */
export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

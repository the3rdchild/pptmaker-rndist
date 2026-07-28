"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Save } from "lucide-react";

import {
  HARMONY_RULES,
  brandColorCount,
  contrastRatio,
  recommendHarmony,
  rotatePalette,
  toPaletteSpec,
  type BrandRole,
  type HarmonyRule,
  type NeutralRole,
  type PaletteSpec,
} from "@/lib/templates/palette-engine";
import type { TemplateTheme } from "@/lib/templates/themes";

const BRAND_FIELDS: { role: BrandRole; label: string; hint: string }[] = [
  { role: "primary", label: "Primary", hint: "The hue the generator rotates from." },
  { role: "secondary", label: "Secondary", hint: "Supporting brand colour." },
  { role: "accent", label: "Accent", hint: "Highlights, CTAs, small emphasis." },
];

const NEUTRAL_FIELDS: { role: NeutralRole; label: string }[] = [
  { role: "background", label: "Background" },
  { role: "surface", label: "Surface" },
  { role: "text", label: "Text" },
  { role: "muted", label: "Muted text" },
  { role: "border", label: "Border" },
];

/** Hues sampled for the preview strip — enough of the wheel to show whether a
 *  palette holds up anywhere the generator might land. */
const PREVIEW_HUES = [0, 60, 120, 180, 240, 300];

export function ThemePaletteEditor({
  theme,
  onSaved,
}: {
  theme: TemplateTheme | null;
  onSaved: () => void;
}) {
  const [spec, setSpec] = useState<PaletteSpec>(() => toPaletteSpec(theme?.palette));
  const [whenToUse, setWhenToUse] = useState(theme?.ai?.when_to_use ?? "");
  const [avoidWhen, setAvoidWhen] = useState(theme?.ai?.avoid_when ?? "");
  const [keywords, setKeywords] = useState((theme?.ai?.keywords ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reseed whenever the selected theme changes, or the form would keep editing
  // the previous theme's colours.
  useEffect(() => {
    setSpec(toPaletteSpec(theme?.palette));
    setWhenToUse(theme?.ai?.when_to_use ?? "");
    setAvoidWhen(theme?.ai?.avoid_when ?? "");
    setKeywords((theme?.ai?.keywords ?? []).join(", "));
    setSaved(false);
    setError(null);
  }, [theme]);

  const count = brandColorCount(spec);
  const recommended = recommendHarmony(count);
  const rule: HarmonyRule = spec.harmony ?? recommended;
  const tint = spec.neutral_tint ?? 0;

  const previews = useMemo(
    () =>
      PREVIEW_HUES.map((hue) => {
        const palette = rotatePalette(spec, { hue, harmony: rule, neutralTint: tint });
        const background = palette.background ?? "#FFFFFF";
        return {
          hue,
          palette,
          textContrast: palette.text
            ? contrastRatio(palette.text, background)
            : null,
        };
      }),
    [rule, spec, tint],
  );

  const worstContrast = previews.reduce(
    (worst, p) => (p.textContrast != null ? Math.min(worst, p.textContrast) : worst),
    Infinity,
  );

  const setBrand = (role: BrandRole, value: string) =>
    setSpec((s) => ({ ...s, brand: { ...s.brand, [role]: value } }));
  const setNeutral = (role: NeutralRole, value: string) =>
    setSpec((s) => ({ ...s, neutral: { ...s.neutral, [role]: value } }));

  const save = useCallback(async () => {
    if (!theme) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/template-engine/themes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeId: theme.id,
          patch: {
            palette: {
              brand: spec.brand,
              neutral: spec.neutral,
              harmony: rule,
              neutral_tint: tint,
            },
            ai: {
              ...(theme.ai ?? {}),
              when_to_use: whenToUse.trim(),
              avoid_when: avoidWhen.trim(),
              keywords: keywords
                .split(",")
                .map((k) => k.trim())
                .filter(Boolean),
            },
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Save failed");
      setSaved(true);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [avoidWhen, keywords, onSaved, rule, spec, theme, tint, whenToUse]);

  if (!theme) return null;

  return (
    <div className="space-y-3">
      <p className="text-[10px] leading-snug text-[var(--text-muted)]">
        The generator only picks a hue — saturation, lightness and these
        relationships come from here, so every deck still looks like this theme.
      </p>

      <div>
        <span className="text-[11px] text-[var(--text-secondary)]">Brand</span>
        <div className="mt-1 space-y-1">
          {BRAND_FIELDS.map((field) => (
            <ColorRow
              key={field.role}
              label={field.label}
              hint={field.hint}
              value={spec.brand[field.role] ?? ""}
              onChange={(value) => setBrand(field.role, value)}
            />
          ))}
        </div>
      </div>

      <div>
        <span className="text-[11px] text-[var(--text-secondary)]">
          Neutral
        </span>
        <p className="text-[10px] leading-snug text-[var(--text-muted)]">
          Lightness is kept as authored; these only pick up a trace of the brand
          hue.
        </p>
        <div className="mt-1 space-y-1">
          {NEUTRAL_FIELDS.map((field) => (
            <ColorRow
              key={field.role}
              label={field.label}
              value={spec.neutral[field.role] ?? ""}
              onChange={(value) => setNeutral(field.role, value)}
            />
          ))}
        </div>
      </div>

      <label className="block space-y-1">
        <span className="text-[11px] text-[var(--text-secondary)]">
          Harmony rule
        </span>
        <select
          value={rule}
          onChange={(event) =>
            setSpec((s) => ({ ...s, harmony: event.target.value as HarmonyRule }))
          }
          className={inputClass}
        >
          {HARMONY_RULES.map((option) => (
            <option key={option.id} value={option.id} title={option.hint}>
              {option.label}
              {option.id === recommended ? " — suggested" : ""}
            </option>
          ))}
        </select>
        <span className="block text-[10px] leading-snug text-[var(--text-muted)]">
          {HARMONY_RULES.find((r) => r.id === rule)?.hint}{" "}
          {count > 0 && `This theme defines ${count} brand colour${count === 1 ? "" : "s"}.`}
        </span>
      </label>

      <label className="block space-y-1">
        <span className="text-[11px] text-[var(--text-secondary)]">
          Neutral tint — {Math.round(tint * 100)}%
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(tint * 100)}
          onChange={(event) =>
            setSpec((s) => ({ ...s, neutral_tint: Number(event.target.value) / 100 }))
          }
          className="w-full accent-[var(--accent)]"
        />
      </label>

      <div>
        <span className="text-[11px] text-[var(--text-secondary)]">
          Preview across the wheel
        </span>
        <div className="mt-1 space-y-1">
          {previews.map((preview) => (
            <div key={preview.hue} className="flex items-center gap-1.5">
              <span className="w-7 shrink-0 text-[9px] tabular-nums text-[var(--text-muted)]">
                {preview.hue}°
              </span>
              <div className="flex flex-1 overflow-hidden rounded">
                {["primary", "secondary", "accent", "surface", "border"].map((role) =>
                  preview.palette[role] ? (
                    <span
                      key={role}
                      title={`${role} ${preview.palette[role]}`}
                      className="h-4 flex-1"
                      style={{ background: preview.palette[role] }}
                    />
                  ) : null,
                )}
              </div>
              <span
                className="flex h-4 w-10 shrink-0 items-center justify-center rounded text-[8px] font-medium"
                style={{
                  background: preview.palette.background,
                  color: preview.palette.text,
                }}
              >
                Abc
              </span>
            </div>
          ))}
        </div>
        {Number.isFinite(worstContrast) && (
          <p
            className={
              worstContrast >= 4.5
                ? "mt-1 text-[10px] text-emerald-400"
                : "mt-1 text-[10px] text-amber-300"
            }
          >
            Worst text contrast across these hues: {worstContrast.toFixed(1)}:1
            {worstContrast >= 4.5 ? " — passes AA" : " — below AA (4.5:1)"}
          </p>
        )}
      </div>

      <label className="block space-y-1">
        <span className="text-[11px] text-[var(--text-secondary)]">
          When to use this theme
        </span>
        <textarea
          value={whenToUse}
          onChange={(event) => setWhenToUse(event.target.value)}
          rows={2}
          placeholder="Product launches, investor pitches…"
          className={inputClass}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] text-[var(--text-secondary)]">
          When to avoid it
        </span>
        <textarea
          value={avoidWhen}
          onChange={(event) => setAvoidWhen(event.target.value)}
          rows={2}
          className={inputClass}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] text-[var(--text-secondary)]">
          Keywords
        </span>
        <input
          value={keywords}
          onChange={(event) => setKeywords(event.target.value)}
          placeholder="pitch deck, startup, launch"
          className={inputClass}
        />
      </label>

      {error && <p className="text-[10px] text-red-300">{error}</p>}
      <button
        onClick={save}
        disabled={saving}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
      >
        {saving ? (
          <Loader2 size={12} className="animate-spin" />
        ) : saved ? (
          <Check size={12} />
        ) : (
          <Save size={12} />
        )}
        {saved ? "Saved" : `Save theme settings`}
      </button>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]";

function ColorRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5" title={hint}>
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        className="h-6 w-7 shrink-0 cursor-pointer rounded border border-[var(--border-strong)] bg-transparent p-0.5"
      />
      <span className="w-[68px] shrink-0 text-[10px] text-[var(--text-muted)]">
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        placeholder="#000000"
        className="min-w-0 flex-1 rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-1.5 py-1 font-mono text-[10px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
      />
    </div>
  );
}

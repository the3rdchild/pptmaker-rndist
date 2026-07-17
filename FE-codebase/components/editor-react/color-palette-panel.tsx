"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { notify } from "@/components/ui/sonner";
import { PanelLabel } from "@/components/editor-react/ui";
import { generateManualPalette, type HueRow } from "@/lib/palette";

const HUE_SCHEME_LABEL: Record<number, string> = {
  1: "Monochromatic",
  2: "Complementary",
  3: "Triadic",
  4: "Tetradic",
  5: "Analogous fan",
  6: "Analogous fan",
};

export interface ColorPalettePanelProps {
  onApplyTheme: (opts: { background?: string; fontColor?: string }) => void;
}

export default function ColorPalettePanel({ onApplyTheme }: ColorPalettePanelProps) {
  const [baseHex, setBaseHex] = useState("#6C5CE7");
  const [hueCount, setHueCount] = useState(3);
  const [toneCount, setToneCount] = useState(5);
  const [analogous, setAnalogous] = useState(false);
  const [angle, setAngle] = useState(30);
  const [copied, setCopied] = useState<string | null>(null);

  const rows: HueRow[] = useMemo(
    () =>
      generateManualPalette({
        baseHex,
        hueCount,
        toneCount,
        analogousAngle: analogous ? angle : undefined,
      }),
    [baseHex, hueCount, toneCount, analogous, angle]
  );

  const copyHex = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(hex);
      notify.success("Copied", hex);
      setTimeout(() => setCopied((c) => (c === hex ? null : c)), 1200);
    } catch {
      notify.error("Copy failed", "Clipboard isn't available.");
    }
  };

  return (
    <div className="w-full pb-2">
      <PanelLabel>Base color</PanelLabel>
      <div className="flex items-center gap-2 px-2.5 py-1">
        <span className="relative inline-flex h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-lg ring-1 ring-[var(--border-strong)]">
          <span className="flex-1" style={{ backgroundColor: baseHex }} />
          <input
            type="color"
            value={baseHex}
            onChange={(e) => setBaseHex(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </span>
        <input
          type="text"
          value={baseHex}
          onChange={(e) => setBaseHex(e.target.value)}
          className="h-8 flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          spellCheck={false}
        />
      </div>

      <PanelLabel>{HUE_SCHEME_LABEL[Math.min(hueCount, 6)] ?? "Custom"}</PanelLabel>
      <div className="flex items-center justify-between gap-2 px-2.5 py-1">
        <span className="text-[11px] text-[var(--text-secondary)]">Hues</span>
        <input
          type="range"
          min={1}
          max={6}
          step={1}
          value={hueCount}
          onChange={(e) => setHueCount(Number(e.target.value))}
          className="flex-1 accent-[var(--accent)]"
        />
        <span className="w-4 text-right text-[11px] text-[var(--text-secondary)]">{hueCount}</span>
      </div>
      <div className="flex items-center justify-between gap-2 px-2.5 py-1">
        <span className="text-[11px] text-[var(--text-secondary)]">Shades</span>
        <input
          type="range"
          min={2}
          max={7}
          step={1}
          value={toneCount}
          onChange={(e) => setToneCount(Number(e.target.value))}
          className="flex-1 accent-[var(--accent)]"
        />
        <span className="w-4 text-right text-[11px] text-[var(--text-secondary)]">{toneCount}</span>
      </div>

      <label className="flex items-center justify-between gap-2 px-2.5 py-1">
        <span className="text-[11px] text-[var(--text-secondary)]">Analogous spread</span>
        <input
          type="checkbox"
          checked={analogous}
          onChange={(e) => setAnalogous(e.target.checked)}
          className="accent-[var(--accent)]"
        />
      </label>
      {analogous && (
        <div className="flex items-center justify-between gap-2 px-2.5 py-1">
          <span className="text-[11px] text-[var(--text-secondary)]">Angle</span>
          <input
            type="range"
            min={10}
            max={90}
            step={5}
            value={angle}
            onChange={(e) => setAngle(Number(e.target.value))}
            className="flex-1 accent-[var(--accent)]"
          />
          <span className="w-8 text-right text-[11px] text-[var(--text-secondary)]">{angle}°</span>
        </div>
      )}

      <PanelLabel>Palette</PanelLabel>
      <div className="flex flex-col gap-1.5 px-2.5 py-1">
        {rows.map((row) => (
          <div key={row.hue} className="flex gap-1">
            {row.swatches.map((hex, i) => (
              <div key={`${hex}-${i}`} className="group relative flex-1">
                <button
                  onClick={() => copyHex(hex)}
                  title={hex}
                  className="h-9 w-full rounded-md ring-1 ring-[var(--border-strong)] transition-transform hover:scale-[1.04]"
                  style={{ backgroundColor: hex }}
                >
                  {copied === hex && (
                    <span className="flex h-full w-full items-center justify-center">
                      <Check size={13} className="text-white drop-shadow" />
                    </span>
                  )}
                </button>
                <div className="pointer-events-none absolute inset-x-0 -bottom-1 z-10 hidden translate-y-full flex-col gap-0.5 rounded-md bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-pop)] group-hover:pointer-events-auto group-hover:flex">
                  <button
                    onClick={() => onApplyTheme({ background: hex })}
                    className="whitespace-nowrap rounded px-1.5 py-0.5 text-left text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                  >
                    Use as background
                  </button>
                  <button
                    onClick={() => onApplyTheme({ fontColor: hex })}
                    className="whitespace-nowrap rounded px-1.5 py-0.5 text-left text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                  >
                    Use as text color
                  </button>
                  <button
                    onClick={() => copyHex(hex)}
                    className={cn(
                      "flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-left text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    <Copy size={10} /> Copy hex
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

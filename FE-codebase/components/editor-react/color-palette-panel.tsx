"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, Copy, Dices } from "lucide-react";
import { cn } from "@/lib/utils";
import { notify } from "@/components/ui/sonner";
import { PanelLabel } from "@/components/editor-react/ui";
import { generateManualPalette, hexToHsl } from "@/lib/palette";

/* ------------------------------ Color math -------------------------------- */

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const sat = s / 100;
  const val = v / 100;
  const c = val * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = val - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s * 100, max * 100];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toByte = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`.toUpperCase();
}

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(clean)) return null;
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

/* ------------------------------ Color naming ------------------------------- */

const HUE_NAMES: [number, string][] = [
  [0, "Red"], [20, "Vermilion"], [35, "Orange"], [50, "Amber"], [60, "Yellow"],
  [80, "Chartreuse"], [100, "Lime"], [120, "Green"], [150, "Emerald"], [165, "Spring green"],
  [180, "Teal"], [195, "Cyan"], [205, "Sky"], [220, "Azure"], [235, "Blue"],
  [250, "Indigo"], [265, "Violet"], [275, "Electric violet"], [285, "Purple"], [300, "Magenta"],
  [315, "Orchid"], [330, "Rose"], [345, "Crimson"],
];

function hueName(h: number): string {
  let best = HUE_NAMES[0][1];
  let bestDiff = 360;
  for (const [deg, name] of HUE_NAMES) {
    const diff = Math.min(Math.abs(h - deg), 360 - Math.abs(h - deg));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = name;
    }
  }
  return best;
}

function colorName(h: number, s: number, l: number): string {
  if (s < 8) return l > 85 ? "White" : l < 15 ? "Black" : "Gray";
  if (l > 88) return `Pale ${hueName(h)}`;
  if (l > 68) return `Light ${hueName(h)}`;
  if (l > 40) return hueName(h);
  if (l > 20) return `Deep ${hueName(h)}`;
  return `Dark ${hueName(h)}`;
}

/* -------------------------------- Color wheel ------------------------------ */

function ColorWheel({
  hue,
  saturation,
  value,
  onChange,
}: {
  hue: number;
  saturation: number;
  value: number;
  onChange: (hue: number, saturation: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const size = 180;
  const radius = size / 2;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - radius + 0.5;
        const dy = y - radius + 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idx = (y * size + x) * 4;
        if (dist > radius) continue;
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        const h = (angle + 360) % 360;
        const s = Math.min(100, (dist / radius) * 100);
        const [r, g, b] = hsvToRgb(h, s, value);
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [value]);

  const setFromPointer = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left - radius;
    const y = clientY - rect.top - radius;
    const dist = Math.min(radius, Math.sqrt(x * x + y * y));
    const angle = (Math.atan2(y, x) * 180) / Math.PI;
    onChange((angle + 360) % 360, (dist / radius) * 100);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setFromPointer(e.clientX, e.clientY);
  };
  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return;
    setFromPointer(e.clientX, e.clientY);
  };
  const stopDragging = () => {
    draggingRef.current = false;
  };

  const rad = (hue * Math.PI) / 180;
  const markerDist = (saturation / 100) * radius;
  const markerX = radius + markerDist * Math.cos(rad);
  const markerY = radius + markerDist * Math.sin(rad);

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="cursor-crosshair rounded-full"
        style={{ touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerLeave={stopDragging}
      />
      <div
        className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
        style={{ left: markerX, top: markerY, boxShadow: "0 0 0 1px rgba(0,0,0,0.45)" }}
      />
    </div>
  );
}

/* --------------------------------- Schemes --------------------------------- */

type Scheme = "complementary" | "triadic" | "tetradic" | "monochrome" | "analogous" | "random";

const SCHEMES: { id: Scheme; label: string }[] = [
  { id: "complementary", label: "Complementary" },
  { id: "triadic", label: "Triadic" },
  { id: "tetradic", label: "Tetradic" },
  { id: "monochrome", label: "Monochrome" },
  { id: "analogous", label: "Analogous" },
  { id: "random", label: "Random" },
];

function generateQuickPalette(hue: number, saturation: number, value: number, scheme: Scheme): string[] {
  if (scheme === "random") {
    return Array.from({ length: 5 }, () =>
      hsvToHex(Math.random() * 360, 55 + Math.random() * 35, 55 + Math.random() * 35)
    );
  }
  const baseHex = hsvToHex(hue, saturation, value);
  if (scheme === "monochrome") {
    const rows = generateManualPalette({ baseHex, hueCount: 1, toneCount: 5 });
    return rows[0]?.swatches ?? [baseHex];
  }
  const hueCount = { complementary: 2, triadic: 3, tetradic: 4, analogous: 5 }[scheme];
  const rows = generateManualPalette({
    baseHex,
    hueCount,
    toneCount: 1,
    analogousAngle: scheme === "analogous" ? 30 : undefined,
  });
  return rows.flatMap((r) => r.swatches);
}

/* ---------------------------------- Panel ----------------------------------- */

export interface ColorPalettePanelProps {
  onApplyColorToSelection: (color: string) => void;
}

export default function ColorPalettePanel({
  onApplyColorToSelection,
}: ColorPalettePanelProps) {
  const [hue, setHue] = useState(272);
  const [saturation, setSaturation] = useState(100);
  const [value, setValue] = useState(100);
  const [scheme, setScheme] = useState<Scheme>("monochrome");
  const [rerollNonce, setRerollNonce] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  const rgb = useMemo(() => hsvToRgb(hue, saturation, value), [hue, saturation, value]);
  const hex = useMemo(() => rgbToHex(...rgb), [rgb]);

  // Live — regenerates as soon as the wheel/value/scheme changes, no button
  // needed. Reroll still bumps a nonce so "Random" can be re-rolled even
  // when the base color didn't change.
  const palette = useMemo(
    () => generateQuickPalette(hue, saturation, value, scheme),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hue, saturation, value, scheme, rerollNonce]
  );

  const handleGenerate = () => setRerollNonce((n) => n + 1);

  const handleHexInput = (raw: string) => {
    const parsed = hexToRgb(raw);
    if (!parsed) return;
    const [h, s, v] = rgbToHsv(...parsed);
    setHue(h);
    setSaturation(s);
    setValue(v);
  };

  const handleRgbInput = (channel: 0 | 1 | 2, raw: string) => {
    const num = Math.max(0, Math.min(255, Number(raw) || 0));
    const next: [number, number, number] = [...rgb];
    next[channel] = num;
    const [h, s, v] = rgbToHsv(...next);
    setHue(h);
    setSaturation(s);
    setValue(v);
  };

  const copyHex = async (color: string) => {
    try {
      await navigator.clipboard.writeText(color);
      setCopied(color);
      notify.success("Copied", color);
      setTimeout(() => setCopied((c) => (c === color ? null : c)), 1200);
    } catch {
      notify.error("Copy failed", "Clipboard isn't available.");
    }
  };

  const copyPalette = async () => {
    try {
      await navigator.clipboard.writeText(palette.join("\n"));
      notify.success("Copied", `${palette.length} colors`);
    } catch {
      notify.error("Copy failed", "Clipboard isn't available.");
    }
  };

  return (
    <div className="w-full pb-2">
      <PanelLabel>Base color</PanelLabel>
      <ColorWheel
        hue={hue}
        saturation={saturation}
        value={value}
        onChange={(h, s) => {
          setHue(h);
          setSaturation(s);
        }}
      />
      <div className="mx-2.5 mt-3 flex items-center gap-2">
        <span className="text-[11px] w-4 text-[var(--text-secondary)]">V</span>
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          className="flex-1 accent-[var(--accent)]"
        />
        <span
          className="h-6 w-6 shrink-0 rounded-md ring-1 ring-[var(--border-strong)]"
          style={{ backgroundColor: hex }}
        />
      </div>

      <div className="mx-2.5 mt-2 space-y-1.5">
        <label className="flex items-center gap-2">
          <span className="w-9 text-[11px] text-[var(--text-secondary)]">HEX</span>
          <input
            type="text"
            defaultValue={hex}
            key={hex}
            onBlur={(e) => handleHexInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleHexInput(e.currentTarget.value)}
            className="h-7 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            spellCheck={false}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-9 text-[11px] text-[var(--text-secondary)]">RGB</span>
          <div className="flex flex-1 gap-1">
            {rgb.map((channelValue, i) => (
              <input
                key={i}
                type="number"
                min={0}
                max={255}
                value={Math.round(channelValue)}
                onChange={(e) => handleRgbInput(i as 0 | 1 | 2, e.target.value)}
                className="h-7 w-full min-w-0 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-1.5 text-center text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            ))}
          </div>
        </label>
        <label className="flex items-center gap-2">
          <span className="w-9 text-[11px] text-[var(--text-secondary)]">HSV</span>
          <div className="flex flex-1 gap-1">
            <input
              type="number"
              min={0}
              max={360}
              value={Math.round(hue)}
              onChange={(e) => setHue(Math.max(0, Math.min(360, Number(e.target.value) || 0)))}
              className="h-7 w-full min-w-0 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-1.5 text-center text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(saturation)}
              onChange={(e) => setSaturation(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              className="h-7 w-full min-w-0 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-1.5 text-center text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(value)}
              onChange={(e) => setValue(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              className="h-7 w-full min-w-0 rounded-md border border-[var(--border-strong)] bg-[var(--bg-surface)] px-1.5 text-center text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        </label>
      </div>

      <button
        onClick={() => {
          const h = Math.random() * 360;
          const s = 55 + Math.random() * 40;
          const v = 55 + Math.random() * 40;
          setHue(h);
          setSaturation(s);
          setValue(v);
        }}
        className="mx-2.5 mt-2.5 flex h-8 w-[calc(100%-20px)] items-center justify-center gap-1.5 rounded-lg bg-[var(--bg-elevated)] text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
      >
        <Dices size={13} /> Random
      </button>

      <PanelLabel>Scheme</PanelLabel>
      <div className="grid grid-cols-2 gap-1.5 px-2.5">
        {SCHEMES.map((s) => (
          <button
            key={s.id}
            onClick={() => setScheme(s.id)}
            className={cn(
              "h-8 rounded-lg text-xs font-medium transition-colors",
              scheme === s.id
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <button
        onClick={handleGenerate}
        className="mx-2.5 mt-2 h-9 w-[calc(100%-20px)] rounded-lg bg-[var(--accent)] text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
      >
        Generate
      </button>

      <PanelLabel>Palette</PanelLabel>
      <p className="mx-2.5 mb-1.5 rounded-md bg-[var(--accent-soft)] px-2 py-1 text-[10px] text-[var(--accent-light)]">
        Click a color to apply it to the current selection (if any) and copy its hex.
      </p>
      <div className="flex flex-col gap-1 px-2.5 py-1">
        {palette.map((color, i) => {
          const { h, s, l } = hexToHsl(color);
          const name = colorName(h, s, l);
          const isLight = l > 60;
          return (
            <button
              key={`${color}-${i}`}
              onClick={() => {
                // Always try both — don't gate on a mirrored "is something
                // selected" flag that can desync from the canvas's own
                // selection state. Applying is a no-op on the canvas side
                // when nothing valid is selected, so this is always safe.
                onApplyColorToSelection(color);
                copyHex(color);
              }}
              title={`Apply ${color} to selection & copy`}
              className="flex h-9 w-full items-center justify-between rounded-md px-2.5 transition-transform hover:scale-[1.01]"
              style={{ backgroundColor: color, color: isLight ? "#111827" : "#F9FAFB" }}
            >
              <span className="text-[11px] font-medium">{color.toUpperCase()}</span>
              <span className="flex items-center gap-1.5 text-[11px]">
                {copied === color && <Check size={12} />}
                {name}
              </span>
            </button>
          );
        })}
      </div>

      <button
        onClick={copyPalette}
        className="mx-2.5 mt-1.5 flex h-8 w-[calc(100%-20px)] items-center justify-center gap-1.5 rounded-lg bg-[var(--bg-elevated)] text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
      >
        <Copy size={12} /> Copy palette
      </button>
    </div>
  );
}

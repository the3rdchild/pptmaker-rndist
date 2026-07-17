"use client";

import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ImagePlus,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { notify } from "@/components/ui/sonner";
import { PanelLabel } from "@/components/editor-react/ui";
import {
  readBackgroundStyle,
  type BackgroundStyle,
} from "@/components/slide-editor/surface/SlideBackground";
import { isBackgroundComponent } from "@/components/slide-editor/model/model";
import type { RawComponent, RawUi } from "@/components/slide-editor/model/core";
import { ImagesApi } from "@/app/(presentation-generator)/services/api/images";
import { resolveBackendAssetSource } from "@/utils/api";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const SWATCHES = [
  "#FFFFFF",
  "#F4F4F5",
  "#E4E4E7",
  "#A1A1AA",
  "#0F0F1E",
  "#18181B",
  "#1E293B",
  "#334155",
  "#6C5CE7",
  "#7C3AED",
  "#2563EB",
  "#0EA5E9",
  "#059669",
  "#12B76A",
  "#DC2626",
  "#EF4444",
  "#EA580C",
  "#F97316",
  "#FACC15",
  "#EAB308",
  "#DB2777",
  "#EC4899",
];

const FILL_TYPES: { id: BackgroundStyle["type"]; label: string }[] = [
  { id: "solid", label: "Solid" },
  { id: "linear", label: "Linear" },
  { id: "radial", label: "Radial" },
  { id: "image", label: "Image" },
];

const DIRECTIONS = [
  { angle: 0, icon: ArrowRight, label: "Left to right" },
  { angle: 90, icon: ArrowDown, label: "Top to bottom" },
  { angle: 45, icon: ArrowDownRight, label: "Diagonal down" },
  { angle: -45, icon: ArrowUpRight, label: "Diagonal up" },
];

const PATTERNS: { id: NonNullable<BackgroundStyle["pattern"]>; label: string }[] = [
  { id: "none", label: "None" },
  { id: "grid", label: "Grid" },
  { id: "dots", label: "Dots" },
];

/**
 * Writes the style onto the slide ui and drops any full-bleed decorative
 * background component so the custom background actually shows through.
 * `ui.background` stays in sync (primary color) for legacy readers
 * (thumbnails, export).
 */
export function applyBackgroundStyle(ui: RawUi, style: BackgroundStyle): RawUi {
  const components = Array.isArray(ui.components) ? ui.components : [];
  const kept = components.filter(
    (component) =>
      typeof component !== "object" ||
      component === null ||
      !isBackgroundComponent(component as RawComponent)
  );
  return {
    ...ui,
    components: kept,
    background: style.from,
    backgroundStyle: { ...style },
  };
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 px-2.5 py-1">
      <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      <span className="relative inline-flex h-6 w-10 cursor-pointer overflow-hidden rounded-md ring-1 ring-[var(--border-strong)]">
        <span className="flex-1" style={{ backgroundColor: value }} />
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </span>
    </label>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="mx-2.5 flex rounded-lg bg-[var(--bg-base)] p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
            value === option.id
              ? "bg-[var(--accent)] text-white"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ImageUploadField({
  imageUrl,
  onUpload,
  onRemove,
}: {
  imageUrl: string | undefined;
  onUpload: (url: string) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const pickFile = () => inputRef.current?.click();

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      notify.warning("Invalid file", "Please upload an image file.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      notify.warning("File too large", "Image files must be smaller than 5MB.");
      return;
    }
    try {
      setUploading(true);
      const uploaded = await ImagesApi.uploadImage(file);
      const url = resolveBackendAssetSource(uploaded);
      if (!url) throw new Error("Upload did not return an image URL.");
      onUpload(url);
    } catch (error) {
      notify.error(
        "Upload failed",
        error instanceof Error ? error.message : "Failed to upload image."
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="px-2.5 py-1.5">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {imageUrl ? (
        <div className="group relative overflow-hidden rounded-lg ring-1 ring-[var(--border-strong)]">
          <img
            src={imageUrl}
            alt="Background"
            className="h-24 w-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/0 opacity-0 transition-all group-hover:bg-black/45 group-hover:opacity-100">
            <button
              onClick={pickFile}
              disabled={uploading}
              className="rounded-md bg-white/90 px-2 py-1 text-[11px] font-medium text-black transition-colors hover:bg-white"
            >
              Replace
            </button>
            <button
              onClick={onRemove}
              disabled={uploading}
              className="flex h-6 w-6 items-center justify-center rounded-md bg-white/90 text-black transition-colors hover:bg-white"
              title="Remove image"
            >
              <X size={12} />
            </button>
          </div>
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <Loader2 size={16} className="animate-spin text-white" />
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={pickFile}
          disabled={uploading}
          className="flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border-strong)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-light)] disabled:opacity-60"
        >
          {uploading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <ImagePlus size={18} />
          )}
          <span className="text-[11px] font-medium">
            {uploading ? "Uploading…" : "Upload image"}
          </span>
        </button>
      )}
    </div>
  );
}

export interface BackgroundPanelProps {
  activeUi: Record<string, unknown>;
  onApply: (ui: Record<string, unknown>) => void;
}

export default function BackgroundPanel({ activeUi, onApply }: BackgroundPanelProps) {
  const style = readBackgroundStyle(activeUi as RawUi);

  const apply = (patch: Partial<BackgroundStyle>) => {
    const next: BackgroundStyle = {
      angle: 90,
      pattern: "none",
      to: style.to ?? style.from,
      ...style,
      ...patch,
    };
    onApply(applyBackgroundStyle(activeUi as RawUi, next));
  };

  return (
    <div className="w-full pb-1.5">
      <PanelLabel>Background</PanelLabel>
      <Segmented options={FILL_TYPES} value={style.type} onChange={(type) => apply({ type })} />

      {style.type === "image" ? (
        <ImageUploadField
          imageUrl={style.imageUrl}
          onUpload={(imageUrl) => apply({ imageUrl })}
          onRemove={() => apply({ imageUrl: undefined })}
        />
      ) : (
        <>
          <div className="mt-1.5">
            <ColorField
              label={style.type === "solid" ? "Color" : "From"}
              value={style.from}
              onChange={(from) => apply({ from })}
            />
            {style.type !== "solid" && (
              <ColorField
                label="To"
                value={style.to ?? style.from}
                onChange={(to) => apply({ to })}
              />
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 px-2.5 py-1.5">
            {SWATCHES.map((color) => (
              <button
                key={color}
                title={color}
                onClick={() => apply({ from: color })}
                className={cn(
                  "h-5 w-5 rounded-md ring-1 transition-transform hover:scale-110",
                  style.from.toUpperCase() === color
                    ? "ring-2 ring-[var(--accent)]"
                    : "ring-[var(--border-strong)]"
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </>
      )}

      {style.type === "linear" && (
        <>
          <PanelLabel>Direction</PanelLabel>
          <div className="flex gap-1 px-2.5">
            {DIRECTIONS.map((direction) => (
              <button
                key={direction.angle}
                title={direction.label}
                onClick={() => apply({ angle: direction.angle })}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
                  (style.angle ?? 90) === direction.angle
                    ? "bg-[var(--accent-soft)] text-[var(--accent-light)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                )}
              >
                <direction.icon size={14} />
              </button>
            ))}
          </div>
        </>
      )}

      <PanelLabel>Pattern</PanelLabel>
      <Segmented
        options={PATTERNS}
        value={style.pattern ?? "none"}
        onChange={(pattern) => apply({ pattern })}
      />
    </div>
  );
}

"use client";

import { Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { OpacitySwatchIcon } from "@/components/slide-editor/toolbar/OpacitySwatchIcon";
import {
  ColorField,
  NumberField,
  Panel,
  SliderField,
} from "@/components/slide-editor/shapes/ShapeToolbar";

type RawRecord = Record<string, unknown>;
type LinePanelId = "line-width" | "line-color" | "line-style" | "line-opacity";

export type TemplateV2LineToolbarElement = RawRecord & {
  type: "line";
  stroke?: RawRecord | null;
};

const LINE_STYLE_OPTIONS: Array<{
  key: "solid" | "dashed" | "dotted";
  label: string;
  dash: number[];
}> = [
  { key: "solid", label: "Solid", dash: [] },
  { key: "dashed", label: "Dashed", dash: [10, 6] },
  { key: "dotted", label: "Dotted", dash: [2, 4] },
];

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : {};
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readColor(value: unknown, fallback: string) {
  const color = typeof value === "string" && value ? value : fallback;
  return color.startsWith("#") ? color : `#${color}`;
}

function lineStyleLabel(dash: unknown) {
  const dashArray = Array.isArray(dash)
    ? dash
        .map((item) => (typeof item === "number" && Number.isFinite(item) ? item : null))
        .filter((item): item is number => item != null && item >= 0)
    : [];
  const matched = LINE_STYLE_OPTIONS.find(
    (option) =>
      option.dash.length === dashArray.length &&
      option.dash.every((value, index) => value === dashArray[index]),
  );
  return matched ?? LINE_STYLE_OPTIONS[0];
}

function LineWidthIcon() {
  return (
    <div className="flex h-4 w-4 flex-col justify-center gap-[1.14px]" aria-hidden>
      <span className="h-[1.71px] w-full bg-[#191919]" />
      <span className="h-[3.43px] w-full bg-[#191919]" />
      <span className="h-[5.71px] w-full bg-[#191919]" />
    </div>
  );
}

export function isTemplateV2LineToolbarElement(
  element: RawRecord | null | undefined,
): element is TemplateV2LineToolbarElement {
  return element?.type === "line";
}

export function TemplateV2LineToolbarControls({
  element,
  onChange,
  onToggle,
  openPanel,
}: {
  element: TemplateV2LineToolbarElement;
  onChange: (changes: RawRecord) => void;
  onToggle: (panel: LinePanelId) => void;
  openPanel: string | null;
}) {
  const stroke = asRecord(element.stroke);
  const strokeColor = readColor(stroke.color, "#191919");
  const strokeOpacity = Math.max(0, Math.min(1, readNumber(stroke.opacity, 1)));
  const strokeWidth = Math.max(0, Math.min(8, readNumber(stroke.width, 1)));
  const currentStyle = lineStyleLabel(stroke.dash);

  const setStroke = (nextStroke: RawRecord) => {
    onChange({ stroke: { ...stroke, ...nextStroke } });
  };

  return (
    <>
      <div className="relative">
        <button
          type="button"
          title="Line width"
          aria-label="Line width"
          aria-expanded={openPanel === "line-width"}
          onClick={() => onToggle("line-width")}
          className={cn(
            "flex items-center p-1 text-[#191919] rounded-[4px] hover:bg-[#F8F8FA]",
            openPanel === "line-width" && "bg-[#F4F1FF] text-[#7C3AED]",
          )}
        >
          <LineWidthIcon />
        </button>
        {openPanel === "line-width" ? (
          <Panel className="w-[220px] rounded-[12px] border border-[#E8E9EE] p-3 shadow-[0_8px_24px_rgba(16,24,40,0.12)]">
            <NumberField
              label="Width"
              value={strokeWidth}
              min={0}
              max={8}
              step={0.25}
              suffix="px"
              onCommit={(width) => setStroke({ width })}
            />
          </Panel>
        ) : null}
      </div>

      <div className="relative">
        <button
          type="button"
          title="Line color"
          aria-label="Line color"
          aria-expanded={openPanel === "line-color"}
          onClick={() => onToggle("line-color")}
          className={cn(
            "grid h-6 w-6 place-items-center rounded-[4px] text-[#191919] hover:bg-[#F8F8FA]",
            openPanel === "line-color" && "bg-[#F4F1FF] text-[#7C3AED]",
          )}
        >
          <Circle size={16} strokeWidth={1.6} />
        </button>
        {openPanel === "line-color" ? (
          <Panel className="flex w-[250px] flex-col gap-[14px] rounded-[12px] border border-[#E8E9EE] p-3 font-manrope text-[12px] font-medium text-[#191919] shadow-[0_8px_24px_rgba(16,24,40,0.12)]">
            <ColorField
              label="Color"
              color={strokeColor}
              onCommit={(color) => setStroke({ color })}
            />
          </Panel>
        ) : null}
      </div>

      <span aria-hidden className="h-[23px] w-px bg-[#EDEEEF]" />

      <div className="relative">
        <button
          type="button"
          title="Line style"
          aria-label="Line style"
          aria-expanded={openPanel === "line-style"}
          onClick={() => onToggle("line-style")}
          className={cn(
            "flex items-center rounded-[4px] p-[6px] font-manrope text-[14px] font-medium leading-4 text-[#191919] hover:bg-[#F8F8FA]",
            openPanel === "line-style" && "bg-[#F4F1FF] text-[#7C3AED]",
          )}
        >
          {currentStyle.label}
        </button>
        {openPanel === "line-style" ? (
          <Panel className="w-[200px] overflow-hidden rounded-[12px] border border-[#E8E9EE] py-2 shadow-[0_8px_24px_rgba(16,24,40,0.12)]">
            {LINE_STYLE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setStroke({ dash: option.dash })}
                className={cn(
                  "flex w-full items-center justify-between px-4 py-2 text-left text-[14px] font-manrope text-[#191919] hover:bg-[#F8F8FA]",
                  currentStyle.key === option.key && "bg-[#F4F1FF] text-[#7C3AED]",
                )}
              >
                <span>{option.label}</span>
                <LinePreview dash={option.dash} />
              </button>
            ))}
          </Panel>
        ) : null}
      </div>

      <div className="relative">
        <button
          type="button"
          title="Line opacity"
          aria-label="Line opacity"
          aria-expanded={openPanel === "line-opacity"}
          onClick={() => onToggle("line-opacity")}
          className={cn(
            "flex items-center rounded-[4px] p-1 text-[#191919] hover:bg-[#F8F8FA]",
            openPanel === "line-opacity" && "bg-[#F4F1FF] text-[#7C3AED]",
          )}
        >
          <OpacitySwatchIcon />
        </button>
        {openPanel === "line-opacity" ? (
          <Panel className="left-auto right-0 w-[220px] translate-x-0 p-3">
            <SliderField
              label="Line opacity"
              value={strokeOpacity}
              min={0}
              max={1}
              step={0.01}
              formatValue={(value) => `${Math.round(value * 100)}%`}
              onCommit={(opacity) => setStroke({ opacity })}
            />
          </Panel>
        ) : null}
      </div>
    </>
  );
}

function LinePreview({ dash }: { dash: number[] }) {
  return (
    <svg aria-hidden="true" className="h-4 w-14" viewBox="0 0 56 16">
      <line
        x1="4"
        y1="8"
        x2="52"
        y2="8"
        stroke="currentColor"
        strokeDasharray={dash.length ? dash.join(" ") : undefined}
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

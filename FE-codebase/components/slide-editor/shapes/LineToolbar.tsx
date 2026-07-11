import { useState } from "react";
import { cn } from "@/lib/utils";
import type { LineSlideElement } from "@/components/slide-editor/state/state";
import {
  FloatingToolbar,
  type FloatingToolbarBox,
} from "@/components/slide-editor/toolbar/FloatingToolbar";
import {
  ComponentActionsMenu,
  ComponentUngroupButton,
  type ComponentActionsMenuActions,
} from "@/components/slide-editor/selection/ComponentActionsMenu";
import { OpacitySwatchIcon } from "@/components/slide-editor/toolbar/OpacitySwatchIcon";
import { withHash } from "@/components/slide-editor/utils/color";
import {
  ColorField,
  Divider,
  Panel,
  ShadowPanel,
  SliderField,
  ToolbarButton,
} from "@/components/slide-editor/shapes/ShapeToolbar";

type LinePanel =
  | "style"
  | "color"
  | "shadow"
  | "opacity"
  | null;

type LineStyleKey = "solid" | "dashed" | "dotted";

const LINE_STYLE_OPTIONS: Array<{
  key: LineStyleKey;
  label: string;
  dash: number[];
}> = [
  { key: "solid", label: "Solid", dash: [] },
  { key: "dashed", label: "Dashed", dash: [10, 6] },
  { key: "dotted", label: "Dotted", dash: [2, 4] },
];

const DEFAULT_LINE_SHADOW = {
  color: "#000000",
  blur: 8,
  opacity: 0.2,
  offset_x: 0.04,
  offset_y: 0.04,
};

export function LineToolbar({
  anchorBox,
  element,
  index,
  scale,
  componentActions,
  onChange,
}: {
  anchorBox?: FloatingToolbarBox | null;
  element: LineSlideElement;
  index: number;
  scale: number;
  componentActions?: ComponentActionsMenuActions | null;
  onChange: (index: number, element: LineSlideElement) => void;
}) {
  const [openPanel, setOpenPanel] = useState<LinePanel>(null);
  const position = element.position ?? { x: 0, y: 0 };
  const size = element.size ?? { width: 1, height: 1 };
  const stroke = element.stroke;
  const shadow = element.shadow ?? DEFAULT_LINE_SHADOW;
  const shadowEnabled = element.shadow != null;
  const currentStyle = lineStyleFromDash(stroke.dash);
  const update = (changes: Partial<LineSlideElement>) => {
    onChange(index, { ...element, ...changes });
  };

  const setStroke = (changes: Partial<LineSlideElement["stroke"]>) => {
    update({ stroke: { ...stroke, ...changes } });
  };

  const togglePanel = (panel: Exclude<LinePanel, null>) => {
    setOpenPanel((current) => (current === panel ? null : panel));
  };
  const toggleShadowPanel = () => {
    if (!shadowEnabled) update({ shadow });
    togglePanel("shadow");
  };

  return (
    <FloatingToolbar
      anchorBox={
        anchorBox ?? {
          x: position.x * scale,
          y: position.y * scale,
          width: size.width * scale,
          height: size.height * scale,
        }
      }
      fallbackWidth={300}
      inlineEditIgnore
      className="inline-flex h-10 items-center gap-3 rounded-[6px] bg-white px-[10px] py-[6px] text-[#191919] shadow-[0_0_4px_rgba(0,0,0,0.15)]"
    >
      <div className="relative">
        <ToolbarButton
          title="Line style"
          pressed={openPanel === "style"}
          onClick={() => togglePanel("style")}
        >
          <LineWidthIcon />
        </ToolbarButton>
        {openPanel === "style" ? (
          <Panel className="w-[222px] space-y-4 p-3">
            <div className="grid grid-cols-3 gap-2">
              {LINE_STYLE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-label={option.label}
                  aria-pressed={currentStyle.key === option.key}
                  title={option.label}
                  onClick={() => setStroke({ dash: option.dash })}
                  className={cn(
                    "grid h-10 place-items-center rounded-md border border-[#EDEEEF] bg-white text-[#191919] hover:bg-[#F8F8FA]",
                    currentStyle.key === option.key &&
                      "border-[#E4D7FF] bg-[#F4F1FF] text-[#7C3AED]",
                  )}
                >
                  <LinePreview dash={option.dash} />
                </button>
              ))}
            </div>
            <SliderField
              label="Line width"
              value={stroke.width}
              min={0}
              max={8}
              step={0.25}
              formatValue={(value) => `${Math.round(value)} pt`}
              onCommit={(width) => setStroke({ width })}
            />
          </Panel>
        ) : null}
      </div>

      <div className="relative">
        <ToolbarButton
          title="Line color"
          pressed={openPanel === "color"}
          onClick={() => togglePanel("color")}
        >
          <span
            aria-hidden="true"
            className="h-4 w-4 rounded-full border border-black/10"
            style={{ backgroundColor: withHash(stroke.color) }}
          />
        </ToolbarButton>
        {openPanel === "color" ? (
          <Panel className="w-[220px] p-3">
            <ColorField
              label="Line color"
              color={stroke.color}
              onCommit={(color) => setStroke({ color })}
            />
          </Panel>
        ) : null}
      </div>

      <Divider />

      <div className="relative">
        <button
          type="button"
          title="Shadow"
          aria-label="Shadow"
          aria-pressed={openPanel === "shadow" || shadowEnabled}
          onClick={toggleShadowPanel}
          className={cn(
            "h-7 rounded-[2px] border-0 bg-transparent px-2 font-syne text-[18px] leading-7 text-[#191919] hover:bg-[#F8F8FA]",
            (openPanel === "shadow" || shadowEnabled) &&
              "bg-[#F4F1FF] text-[#7C3AED]",
          )}
        >
          Shadow
        </button>
        {openPanel === "shadow" ? (
          <ShadowPanel
            fallback={DEFAULT_LINE_SHADOW}
            shadow={shadow}
            onChange={(changes) => update({ shadow: { ...shadow, ...changes } })}
          />
        ) : null}
      </div>

      <div className="relative">
        <ToolbarButton
          title="Line opacity"
          pressed={openPanel === "opacity"}
          onClick={() => togglePanel("opacity")}
        >
          <OpacitySwatchIcon />
        </ToolbarButton>
        {openPanel === "opacity" ? (
          <Panel className="left-auto right-0 w-[220px] translate-x-0 p-3">
            <SliderField
              label="Line opacity"
              value={element.opacity ?? 1}
              min={0}
              max={1}
              step={0.01}
              formatValue={(value) => `${Math.round(value * 100)}%`}
              onCommit={(opacity) => update({ opacity })}
            />
          </Panel>
        ) : null}
      </div>

      {componentActions ? (
        <>
          <Divider />
          <ComponentUngroupButton actions={componentActions} />
          {componentActions.canUngroup ? <Divider /> : null}
          <ComponentActionsMenu actions={componentActions} />
        </>
      ) : null}
    </FloatingToolbar>
  );
}

function lineStyleFromDash(dash: unknown): (typeof LINE_STYLE_OPTIONS)[number] {
  const dashArray = Array.isArray(dash)
    ? dash.filter((item): item is number => typeof item === "number")
    : [];
  return (
    LINE_STYLE_OPTIONS.find(
      (option) =>
        option.dash.length === dashArray.length &&
        option.dash.every((value, index) => value === dashArray[index]),
    ) ?? LINE_STYLE_OPTIONS[0]
  );
}

function LineWidthIcon() {
  return (
    <span className="flex h-4 w-[13.7px] flex-col justify-center gap-[1.14px]" aria-hidden>
      <span className="h-[1.71px] w-full bg-current" />
      <span className="h-[3.43px] w-full bg-current" />
      <span className="h-[5.71px] w-full bg-current" />
    </span>
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

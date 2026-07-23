"use client";

import { useState } from "react";
import { Pencil, Sigma } from "lucide-react";
import type { FormulaSlideElement } from "@/components/slide-editor/state/state";
import {
  FloatingToolbar,
  FloatingToolbarPanel,
  type FloatingToolbarBox,
} from "@/components/slide-editor/toolbar/FloatingToolbar";
import { inlineStyles } from "@/components/slide-editor/toolbar/inlineStyles";

const DEFAULT_FORMULA_TOOLBAR_SIZE = { width: 480, height: 140 };

function normalizeColorInputValue(color?: string | null) {
  if (!color) return "#101323";
  return color.startsWith("#") ? color : `#${color}`;
}

export function FormulaToolbarControls({
  element,
  onChange,
}: {
  element: FormulaSlideElement;
  onChange: (element: FormulaSlideElement) => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);

  return (
    <>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          paddingRight: 8,
          borderRight: "1px solid #E6E6EA",
        }}
      >
        <Sigma size={16} strokeWidth={2} />
      </div>

      <div style={{ position: "relative" }}>
        <button
          type="button"
          aria-expanded={editorOpen}
          aria-label="Edit formula"
          title="Edit formula"
          onClick={() => setEditorOpen((open) => !open)}
          style={{
            ...inlineStyles.iconButton,
            ...(editorOpen ? inlineStyles.iconButtonActive : {}),
          }}
        >
          <Pencil size={16} strokeWidth={2} />
        </button>
        {editorOpen ? (
          <FloatingToolbarPanel
            style={{
              width: 320,
              padding: 10,
              borderRadius: 8,
              border: "1px solid #EDEEEF",
              background: "#FFFFFF",
              boxShadow: "0 12px 34px rgba(16,19,35,0.16)",
            }}
          >
            <label
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 700,
                color: "#475467",
                marginBottom: 6,
              }}
            >
              LaTeX source
            </label>
            <textarea
              autoFocus
              value={element.latex}
              onChange={(event) =>
                onChange({ ...element, latex: event.target.value })
              }
              rows={3}
              style={{
                width: "100%",
                boxSizing: "border-box",
                resize: "vertical",
                borderRadius: 6,
                border: "1px solid #EDEEEF",
                padding: 8,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: 12,
                outline: "none",
              }}
            />
          </FloatingToolbarPanel>
        ) : null}
      </div>

      <input
        aria-label="Formula color"
        title="Formula color"
        type="color"
        value={normalizeColorInputValue(element.color)}
        onChange={(event) =>
          onChange({ ...element, color: event.target.value.replace(/^#/, "") })
        }
        style={inlineStyles.colorInput}
      />
    </>
  );
}

export function FormulaToolbar({
  anchorBox,
  element,
  index,
  scale,
  onChange,
}: {
  anchorBox?: FloatingToolbarBox | null;
  element: FormulaSlideElement;
  index: number;
  scale: number;
  onChange: (index: number, element: FormulaSlideElement) => void;
}) {
  return (
    <FloatingToolbar
      anchorBox={
        anchorBox ?? {
          x: (element.position?.x ?? 0) * scale,
          y: (element.position?.y ?? 0) * scale,
          width:
            (element.size?.width ?? DEFAULT_FORMULA_TOOLBAR_SIZE.width) *
            scale,
          height:
            (element.size?.height ?? DEFAULT_FORMULA_TOOLBAR_SIZE.height) *
            scale,
        }
      }
      fallbackWidth={140}
      inlineEditIgnore
      style={inlineStyles.toolbar}
    >
      <FormulaToolbarControls
        element={element}
        onChange={(next) => onChange(index, next)}
      />
    </FloatingToolbar>
  );
}

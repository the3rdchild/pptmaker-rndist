"use client";

import { useState } from "react";
import { Pencil, Video, Music } from "lucide-react";
import type { MediaSlideElement } from "@/components/slide-editor/state/state";
import {
  FloatingToolbar,
  FloatingToolbarPanel,
  type FloatingToolbarBox,
} from "@/components/slide-editor/toolbar/FloatingToolbar";
import { inlineStyles } from "@/components/slide-editor/toolbar/inlineStyles";

const DEFAULT_MEDIA_TOOLBAR_SIZE = { width: 480, height: 220 };

export function MediaToolbarControls({
  element,
  onChange,
}: {
  element: MediaSlideElement;
  onChange: (element: MediaSlideElement) => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const isVideo = element.media_type !== "audio";

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
        {isVideo ? <Video size={16} strokeWidth={2} /> : <Music size={16} strokeWidth={2} />}
      </div>

      <div style={{ position: "relative" }}>
        <button
          type="button"
          aria-expanded={editorOpen}
          aria-label="Edit media source"
          title="Edit media source"
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
              width: 340,
              padding: 10,
              borderRadius: 8,
              border: "1px solid #EDEEEF",
              background: "#FFFFFF",
              boxShadow: "0 12px 34px rgba(16,19,35,0.16)",
            }}
          >
            <label style={labelStyle}>Type</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {(["video", "audio"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onChange({ ...element, media_type: kind })}
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    borderRadius: 6,
                    border:
                      element.media_type === kind
                        ? "1px solid #4D20C5"
                        : "1px solid #EDEEEF",
                    background:
                      element.media_type === kind ? "#4D20C51A" : "#FFFFFF",
                    color: "#101323",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {kind === "video" ? "Video" : "Audio"}
                </button>
              ))}
            </div>

            <label style={labelStyle}>Source URL</label>
            <input
              value={element.src}
              onChange={(event) => onChange({ ...element, src: event.target.value })}
              placeholder="https://…/clip.mp4"
              style={inputStyle}
            />

            {isVideo ? (
              <>
                <label style={{ ...labelStyle, marginTop: 8 }}>Poster image URL (optional)</label>
                <input
                  value={element.poster ?? ""}
                  onChange={(event) =>
                    onChange({ ...element, poster: event.target.value || null })
                  }
                  placeholder="https://…/poster.jpg"
                  style={inputStyle}
                />
              </>
            ) : null}

            <label style={{ ...labelStyle, marginTop: 8 }}>Caption (optional)</label>
            <input
              value={element.caption ?? ""}
              onChange={(event) =>
                onChange({ ...element, caption: event.target.value || null })
              }
              placeholder="Shown beneath the player"
              style={inputStyle}
            />
          </FloatingToolbarPanel>
        ) : null}
      </div>
    </>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 700,
  color: "#475467",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  borderRadius: 6,
  border: "1px solid #EDEEEF",
  padding: 8,
  fontSize: 12,
  outline: "none",
};

export function MediaToolbar({
  anchorBox,
  element,
  scale,
  onChange,
}: {
  anchorBox?: FloatingToolbarBox | null;
  element: MediaSlideElement;
  scale: number;
  onChange: (element: MediaSlideElement) => void;
}) {
  return (
    <FloatingToolbar
      anchorBox={
        anchorBox ?? {
          x: (element.position?.x ?? 0) * scale,
          y: (element.position?.y ?? 0) * scale,
          width:
            (element.size?.width ?? DEFAULT_MEDIA_TOOLBAR_SIZE.width) * scale,
          height:
            (element.size?.height ?? DEFAULT_MEDIA_TOOLBAR_SIZE.height) * scale,
        }
      }
      fallbackWidth={140}
      inlineEditIgnore
      style={inlineStyles.toolbar}
    >
      <MediaToolbarControls element={element} onChange={onChange} />
    </FloatingToolbar>
  );
}

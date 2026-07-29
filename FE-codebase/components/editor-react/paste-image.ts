// Ctrl+V for images copied from outside the app.
//
// The existing clipboard hook only understands the editor's own element
// payload and bails out on anything else, so an image copied from a browser or
// a screenshot tool simply did nothing. This fills that gap without touching
// element copy/paste: it runs only once the app payload has been ruled out.

import { appendInsertedContent } from "@/components/slide-editor/model/inserted-content";
import type { RawUi } from "@/components/slide-editor/model/core";
import {
  EDITOR_STAGE_HEIGHT,
  EDITOR_STAGE_WIDTH,
  type SlideElement,
} from "@/components/slide-editor/types";

/** Largest box a pasted image is placed into; it keeps its aspect ratio. */
const MAX_WIDTH = 800;
const MAX_HEIGHT = 560;

export type PastedImage = { dataUrl: string; width: number; height: number };

/** True when the caret is somewhere text is being typed, in which case the
 *  paste belongs to that field rather than to the canvas. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  if (element.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

export function imageFileFromClipboard(
  data: DataTransfer | null,
): File | null {
  if (!data) return null;

  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  // Safari surfaces pasted screenshots through `files` without an items entry.
  for (const file of Array.from(data.files ?? [])) {
    if (file.type.startsWith("image/")) return file;
  }
  return null;
}

export function readImageFile(file: File): Promise<PastedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the pasted image"));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      if (!dataUrl) {
        reject(new Error("The pasted image was empty"));
        return;
      }
      const image = new window.Image();
      image.onload = () =>
        resolve({
          dataUrl,
          width: image.naturalWidth || image.width || MAX_WIDTH,
          height: image.naturalHeight || image.height || MAX_HEIGHT,
        });
      image.onerror = () => reject(new Error("The pasted image could not be decoded"));
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function fitWithin(width: number, height: number) {
  const ratio = width / height || 1;
  let w = width;
  let h = height;
  if (w > MAX_WIDTH) {
    w = MAX_WIDTH;
    h = Math.round(w / ratio);
  }
  if (h > MAX_HEIGHT) {
    h = MAX_HEIGHT;
    w = Math.round(h * ratio);
  }
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}

/** Places the image centred on the slide at its own aspect ratio. */
export function withPastedImage(ui: RawUi, image: PastedImage): RawUi {
  const size = fitWithin(image.width, image.height);
  const element = {
    type: "image",
    position: {
      x: Math.round((EDITOR_STAGE_WIDTH - size.width) / 2),
      y: Math.round((EDITOR_STAGE_HEIGHT - size.height) / 2),
    },
    size,
    data: image.dataUrl,
    fit: "contain",
  } as SlideElement;

  return appendInsertedContent(ui, [element as never], [], "Pasted image") as RawUi;
}

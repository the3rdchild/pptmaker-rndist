// Maps AIPPTSlide (abstract worker output) to Presenton ui layouts.
// One pre-baked layout per AIPPT type — text slots get filled with the
// slide's content.

type AIPPTSlide =
  | { type: "cover"; data: { title: string; text: string } }
  | { type: "contents"; data: { items: string[] } }
  | { type: "transition"; data: { title: string; text: string } }
  | { type: "content"; data: { title: string; items: { title: string; text: string }[] } }
  | { type: "end" };

type Ui = Record<string, unknown>;

const HEADER_FONT = { family: "Inter", size: 40, color: "#101323", bold: true, line_height: 1.15 };
const BODY_FONT = { family: "Inter", size: 18, color: "#475467", line_height: 1.4 };

function comp(id: string, x: number, y: number, w: number, h: number, elements: unknown[]): Ui {
  return { id, position: { x, y }, size: { width: w, height: h }, elements };
}

function bgRect(color = "#FFFFFF"): Ui {
  return comp("background_canvas", 0, 0, 1280, 720, [
    { type: "rectangle", position: { x: 0, y: 0 }, size: { width: 1280, height: 720 }, fill: { color, opacity: 1 } },
  ]);
}

function textEl(x: number, y: number, w: number, h: number, text: string, font: Record<string, unknown>): Ui {
  return {
    type: "text",
    position: { x, y },
    size: { width: w, height: h },
    runs: [{ text, font }],
  };
}

function coverSlide(title: string, subtitle: string): Ui {
  return {
    id: "cover",
    components: [
      bgRect("#0F172A"),
      comp("accent_bar", 0, 300, 14, 120, [
        { type: "rectangle", position: { x: 0, y: 0 }, size: { width: 14, height: 120 }, fill: { color: "#6366F1", opacity: 1 } },
      ]),
      comp("title", 88, 250, 900, 120, [
        textEl(0, 0, 900, 80, title, { ...HEADER_FONT, size: 52, color: "#F8FAFC" }),
        textEl(0, 90, 800, 40, subtitle, { ...BODY_FONT, size: 22, color: "#94A3B8" }),
      ]),
    ],
  };
}

function transitionSlide(title: string, text: string): Ui {
  return {
    id: "transition",
    components: [
      bgRect("#1E1B4B"),
      comp("accent", 0, 320, 1280, 4, [
        { type: "rectangle", position: { x: 0, y: 0 }, size: { width: 1280, height: 4 }, fill: { color: "#6366F1", opacity: 1 } },
      ]),
      comp("text", 88, 260, 900, 160, [
        textEl(0, 0, 900, 70, title, { ...HEADER_FONT, size: 44, color: "#F8FAFC" }),
        textEl(0, 80, 800, 60, text, { ...BODY_FONT, size: 20, color: "#C7D2FE" }),
      ]),
    ],
  };
}

function contentSlide(title: string, items: { title: string; text: string }[]): Ui {
  const itemElements: unknown[] = [];
  let yOffset = 0;
  const itemH = Math.min(140, Math.floor(400 / Math.max(items.length, 1)));
  for (const item of items.slice(0, 4)) {
    itemElements.push(textEl(0, yOffset, 540, itemH, item.title, { family: "Inter", size: 22, color: "#101323", bold: true, line_height: 1.2 }));
    itemElements.push(textEl(0, yOffset + 34, 540, itemH - 34, item.text, BODY_FONT));
    yOffset += itemH;
  }

  return {
    id: "content",
    components: [
      bgRect("#FFFFFF"),
      comp("header", 88, 70, 1100, 80, [
        textEl(0, 0, 1100, 60, title, HEADER_FONT),
        { type: "rectangle", position: { x: 0, y: 68 }, size: { width: 60, height: 4 }, fill: { color: "#6366F1", opacity: 1 } },
      ]),
      comp("items", 88, 180, 540, 420, itemElements),
    ],
  };
}

function contentsSlide(items: string[]): Ui {
  const itemElements: unknown[] = items.slice(0, 8).map((item, i) =>
    textEl(0, i * 56, 700, 50, `${i + 1}.  ${item}`, { family: "Inter", size: 20, color: "#334155", line_height: 1.3 })
  );
  return {
    id: "contents",
    components: [
      bgRect("#F8FAFC"),
      comp("title", 88, 70, 800, 70, [
        textEl(0, 0, 800, 60, "Contents", HEADER_FONT),
      ]),
      comp("list", 88, 180, 1100, 480, itemElements),
    ],
  };
}

function endSlide(): Ui {
  return {
    id: "end",
    components: [
      bgRect("#0F172A"),
      comp("text", 390, 300, 500, 120, [
        textEl(0, 0, 500, 70, "Thank You", { ...HEADER_FONT, size: 48, color: "#F8FAFC" }),
      ]),
    ],
  };
}

export function mapAIPPTSlideToUi(slide: AIPPTSlide): Ui | null {
  switch (slide.type) {
    case "cover":
      return coverSlide(slide.data.title, slide.data.text);
    case "transition":
      return transitionSlide(slide.data.title, slide.data.text);
    case "content":
      return contentSlide(slide.data.title, slide.data.items);
    case "contents":
      return contentsSlide(slide.data.items);
    case "end":
      return endSlide();
    default:
      return null;
  }
}

export type { AIPPTSlide };

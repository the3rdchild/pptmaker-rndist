// The browser-side extractor: reads a laid-out slide DOM back as editor
// elements. Shipped as a plain function and injected via Function.toString(),
// so it stays ordinary lint-able JS instead of a quoted blob.
//
// It must be self-contained — it runs inside the page and can close over
// nothing from this module.

export function extractSlide() {
  const STAGE_W = 1280;
  const STAGE_H = 720;
  const MAX_RADIUS = 128;
  const MIN_READABLE_PX = 12;

  const slide = document.querySelector(".slide");
  if (!slide) throw new Error("No .slide element in the document");

  // Transforms move the painted box without moving the layout box, and
  // getBoundingClientRect reports the transformed one. Record the rotation and
  // strip the transform so every later measurement is the layout box, which is
  // what the editor model stores.
  const rotations = new Map();
  for (const el of slide.querySelectorAll("*")) {
    const transform = getComputedStyle(el).transform;
    if (!transform || transform === "none") continue;
    const nums = transform.match(/matrix\(([^)]+)\)/);
    if (nums) {
      const parts = nums[1].split(",").map(Number);
      const deg = Math.round((Math.atan2(parts[1], parts[0]) * 180) / Math.PI);
      if (deg !== 0) rotations.set(el, deg);
    }
    el.style.transform = "none";
  }

  const base = slide.getBoundingClientRect();
  const elements = [];
  const warnings = [];

  const num = (value) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };

  const round = (n) => Math.round(n * 100) / 100;

  function toHex(r, g, b) {
    const part = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return ("#" + part(r) + part(g) + part(b)).toUpperCase();
  }

  function parseColor(value) {
    if (!value || value === "transparent" || value === "none") return null;
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    const alpha = parts.length > 3 ? parts[3] : 1;
    if (!Number.isFinite(parts[0]) || alpha === 0) return null;
    return { color: toHex(parts[0], parts[1], parts[2]), opacity: round(alpha) };
  }

  // A gradient stop keeps its alpha as an rgba() string rather than being
  // flattened to hex. Dropping it turns the scrim over a hero photo — the most
  // common thing a gradient is used for on a slide — into an opaque slab that
  // hides the photo completely.
  function stopColor(parsed) {
    if (parsed.opacity >= 1) return parsed.color;
    const hex = parsed.color.slice(1);
    const channel = (i) => parseInt(hex.slice(i, i + 2), 16);
    return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${parsed.opacity})`;
  }

  function parseGradient(backgroundImage) {
    if (!backgroundImage || backgroundImage === "none") return null;
    const isRadial = backgroundImage.startsWith("radial-gradient");
    if (!isRadial && !backgroundImage.startsWith("linear-gradient")) return null;
    // A fully transparent stop parses to null but still shapes the ramp, so
    // keep it as an explicit transparent colour instead of discarding it.
    const stops = [...backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map(
      (m) => parseColor(m[0]) ?? { color: "#000000", opacity: 0 },
    );
    const solid = stops;
    if (solid.length < 2) return null;
    // CSS 0deg points up and 90deg points right; the editor's 0 points right
    // and 90 points down, so the two scales are 90 degrees apart.
    const angleMatch = backgroundImage.match(/(-?[\d.]+)deg/);
    const cssAngle = angleMatch ? num(angleMatch[1]) : 180;
    return {
      type: "gradient",
      shape: isRadial ? "radial" : "linear",
      from: stopColor(solid[0]),
      to: stopColor(solid[solid.length - 1]),
      angle: isRadial ? null : (((cssAngle - 90) % 360) + 360) % 360,
    };
  }

  function boxOf(el) {
    const r = el.getBoundingClientRect();
    return {
      x: round(r.left - base.left),
      y: round(r.top - base.top),
      width: round(r.width),
      height: round(r.height),
    };
  }

  function contentBoxOf(el, style) {
    const box = boxOf(el);
    const left = num(style.paddingLeft) + num(style.borderLeftWidth);
    const right = num(style.paddingRight) + num(style.borderRightWidth);
    const top = num(style.paddingTop) + num(style.borderTopWidth);
    const bottom = num(style.paddingBottom) + num(style.borderBottomWidth);
    return {
      x: round(box.x + left),
      y: round(box.y + top),
      width: round(Math.max(1, box.width - left - right)),
      height: round(Math.max(1, box.height - top - bottom)),
    };
  }

  function radiusOf(style, box) {
    const read = (value) => {
      const first = String(value || "0").trim().split(/\s+/)[0];
      const px = first.endsWith("%")
        ? (num(first) / 100) * Math.min(box.width, box.height)
        : num(first);
      return Math.min(MAX_RADIUS, Math.max(0, round(px)));
    };
    const radius = {
      tl: read(style.borderTopLeftRadius),
      tr: read(style.borderTopRightRadius),
      bl: read(style.borderBottomLeftRadius),
      br: read(style.borderBottomRightRadius),
    };
    return radius.tl || radius.tr || radius.bl || radius.br ? radius : null;
  }

  function strokeOf(style) {
    const sides = ["Top", "Right", "Bottom", "Left"];
    const widths = sides.map((side) => num(style["border" + side + "Width"]));
    const colors = sides.map((side) => parseColor(style["border" + side + "Color"]));
    const uniform = widths.every((w) => w === widths[0]) && widths[0] > 0 && colors[0];
    if (!uniform) return null;
    return { color: colors[0].color, opacity: colors[0].opacity, width: round(widths[0]) };
  }

  // Borders that are not uniform on all four sides have no equivalent in the
  // model's single `stroke`, so each visible side becomes its own thin
  // rectangle. This covers both the lone accent bar on one edge and the very
  // common "hairline all round plus a thick coloured top" card.
  function edgeBars(style, box) {
    const sides = [
      { name: "Top", w: num(style.borderTopWidth), c: parseColor(style.borderTopColor) },
      { name: "Right", w: num(style.borderRightWidth), c: parseColor(style.borderRightColor) },
      { name: "Bottom", w: num(style.borderBottomWidth), c: parseColor(style.borderBottomColor) },
      { name: "Left", w: num(style.borderLeftWidth), c: parseColor(style.borderLeftColor) },
    ].filter((side) => side.w > 0 && side.c);
    if (sides.length === 0) return [];
    // A uniform border is already carried as a stroke — leave it alone.
    if (sides.length === 4 && sides.every((side) => side.w === sides[0].w)) return [];

    return sides.map((side) => {
      const geometry = {
        Top: { x: box.x, y: box.y, width: box.width, height: side.w },
        Bottom: { x: box.x, y: box.y + box.height - side.w, width: box.width, height: side.w },
        Left: { x: box.x, y: box.y, width: side.w, height: box.height },
        Right: { x: box.x + box.width - side.w, y: box.y, width: side.w, height: box.height },
      }[side.name];
      return {
        type: "rectangle",
        position: { x: round(geometry.x), y: round(geometry.y) },
        size: { width: round(geometry.width), height: round(geometry.height) },
        fill: { type: "solid", color: side.c.color, opacity: side.c.opacity },
      };
    });
  }

  function shadowOf(style) {
    const value = style.boxShadow;
    if (!value || value === "none") return null;
    const color = parseColor(value);
    const lengths = value.replace(/rgba?\([^)]+\)/, "").match(/-?[\d.]+px/g);
    if (!color || !lengths) return null;
    return {
      color: color.color,
      opacity: color.opacity,
      offset_x: round(num(lengths[0])),
      offset_y: round(num(lengths[1])),
      blur: round(num(lengths[2])),
    };
  }

  function fontOf(style) {
    const family = String(style.fontFamily || "")
      .split(",")[0]
      .replace(/["']/g, "")
      .trim();
    const size = num(style.fontSize);
    const lineHeight = style.lineHeight === "normal" ? size * 1.2 : num(style.lineHeight);
    const color = parseColor(style.color);
    const spacing = style.letterSpacing === "normal" ? 0 : num(style.letterSpacing);
    return {
      family: family || null,
      size: round(size),
      color: color ? color.color : "#000000",
      bold: num(style.fontWeight) >= 600 || style.fontWeight === "bold",
      italic: style.fontStyle === "italic",
      underline: String(style.textDecorationLine || "").includes("underline"),
      line_height: size > 0 ? round(lineHeight / size) : 1.2,
      letter_spacing: round(spacing),
    };
  }

  const INLINE = /^inline/;

  function isInlineOnly(el) {
    for (const child of el.children) {
      if (child instanceof SVGElement || child.tagName === "IMG") return false;
      if (!INLINE.test(getComputedStyle(child).display)) return false;
      if (!isInlineOnly(child)) return false;
    }
    return true;
  }

  function hasOwnText(el) {
    return el.textContent.trim().length > 0;
  }

  function runsOf(el, parentFont) {
    const runs = [];
    const push = (text, font) => {
      if (!text) return;
      const last = runs[runs.length - 1];
      if (last && JSON.stringify(last.font) === JSON.stringify(font)) {
        last.text += text;
        return;
      }
      runs.push({ text, font });
    };
    const walkNode = (node, font) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          push(child.nodeValue.replace(/\s+/g, " "), font);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.tagName === "BR") {
            push("\n", font);
            continue;
          }
          walkNode(child, fontOf(getComputedStyle(child)));
        }
      }
    };
    walkNode(el, parentFont);
    if (runs.length === 0) return [{ text: el.textContent.trim(), font: parentFont }];
    runs[0].text = runs[0].text.replace(/^\s+/, "");
    runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, "");
    return runs.filter((run) => run.text.length > 0);
  }

  function alignmentOf(style) {
    const display = style.display;
    if (display === "flex" || display === "inline-flex") {
      const column = String(style.flexDirection).startsWith("column");
      const toH = (v) => (v === "center" ? "center" : v === "flex-end" || v === "end" ? "right" : "left");
      const toV = (v) => (v === "center" ? "middle" : v === "flex-end" || v === "end" ? "bottom" : "top");
      return column
        ? { horizontal: toH(style.alignItems), vertical: toV(style.justifyContent) }
        : { horizontal: toH(style.justifyContent), vertical: toV(style.alignItems) };
    }
    const align = style.textAlign;
    return {
      horizontal: align === "center" ? "center" : align === "right" || align === "end" ? "right" : "left",
      vertical: "top",
    };
  }

  function emit(element, el) {
    if (rotations.has(el)) element.rotation = rotations.get(el);
    elements.push(element);
  }

  function paintOf(el, style, box) {
    const background = parseColor(style.backgroundColor);
    const gradient = parseGradient(style.backgroundImage);
    const stroke = strokeOf(style);
    const shadow = shadowOf(style);
    const radius = radiusOf(style, box);
    if (!background && !gradient && !stroke && !shadow) return null;

    const isCircle =
      radius &&
      Math.abs(box.width - box.height) < 2 &&
      radius.tl >= Math.min(box.width, box.height) / 2 - 1;

    if (isCircle && background && !gradient) {
      const ellipse = {
        type: "ellipse",
        position: { x: box.x, y: box.y },
        size: { width: box.width, height: box.height },
        fill: { color: background.color, opacity: background.opacity },
      };
      if (stroke) ellipse.stroke = stroke;
      if (shadow) ellipse.shadow = shadow;
      return ellipse;
    }

    const rectangle = {
      type: "rectangle",
      position: { x: box.x, y: box.y },
      size: { width: box.width, height: box.height },
      fill: gradient || (background ? { type: "solid", color: background.color, opacity: background.opacity } : null),
    };
    if (stroke) rectangle.stroke = stroke;
    if (shadow) rectangle.shadow = shadow;
    if (radius) rectangle.border_radius = radius;
    return rectangle;
  }

  // The model has an "svg" element type but the Konva surface never renders
  // one, so inline SVG is carried across as an image with a data URI instead —
  // which renders in the editor and survives .pptx export as a picture.
  // Presentation properties reaching an SVG through a CSS rule or a var()
  // reference exist only in the computed style — serialising outerHTML drops
  // both, which is how a three-line chart arrives with two lines missing.
  const SVG_PAINT_PROPS = [
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-dasharray",
    "opacity",
    "font-family",
    "font-size",
    "font-weight",
    "text-anchor",
  ];

  function inlineSvgPaint(original, clone) {
    const sources = [original, ...original.querySelectorAll("*")];
    const targets = [clone, ...clone.querySelectorAll("*")];
    for (let i = 0; i < sources.length && i < targets.length; i += 1) {
      const computed = getComputedStyle(sources[i]);
      for (const property of SVG_PAINT_PROPS) {
        const value = computed.getPropertyValue(property);
        if (value && value !== "normal" && value !== "auto") {
          targets[i].setAttribute(property, value.trim());
        }
      }
      targets[i].removeAttribute("class");
      targets[i].removeAttribute("style");
    }
  }

  function svgElementFor(el, box) {
    const clone = el.cloneNode(true);
    inlineSvgPaint(el, clone);
    const color = parseColor(getComputedStyle(el).color);
    if (!clone.getAttribute("viewBox")) {
      clone.setAttribute("viewBox", "0 0 " + Math.round(box.width) + " " + Math.round(box.height));
    }
    // Inline SVG inherits the namespace from the HTML parser; a data URI is
    // parsed as a standalone document and renders nothing without it.
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(Math.round(box.width)));
    clone.setAttribute("height", String(Math.round(box.height)));
    const markup = clone.outerHTML.replace(/currentColor/g, color ? color.color : "#000000");
    return {
      type: "image",
      position: { x: box.x, y: box.y },
      size: { width: box.width, height: box.height },
      data: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup),
      fit: "contain",
      is_icon: true,
    };
  }

  function imageElementFor(el, style, box) {
    const parent = el.parentElement;
    const parentStyle = parent ? getComputedStyle(parent) : null;
    const clipsChild =
      parentStyle &&
      parentStyle.overflow === "hidden" &&
      Math.abs(parent.getBoundingClientRect().width - box.width) < 3;
    const radius = radiusOf(style, box) || (clipsChild ? radiusOf(parentStyle, box) : null);
    const fit =
      style.objectFit === "contain" ? "contain" : style.objectFit === "fill" ? "fill" : "cover";
    const image = {
      type: "image",
      position: { x: box.x, y: box.y },
      size: { width: box.width, height: box.height },
      data: el.currentSrc || el.src,
      fit,
      is_frame: true,
    };
    if (el.dataset.brief) image.prompt = el.dataset.brief;
    if (radius) image.border_radius = radius;
    return image;
  }

  // A bare text node sitting next to block siblings has no element of its own
  // to measure, so its painted box comes from a Range over the node. Without
  // this the text is laid out, painted, and then silently dropped.
  function looseTextElementFor(node, parentStyle) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    const font = fontOf(parentStyle);
    return {
      type: "text",
      position: { x: round(r.left - base.left), y: round(r.top - base.top) },
      size: { width: round(r.width), height: round(r.height) },
      font,
      alignment: { horizontal: "left", vertical: "top" },
      runs: [{ text: node.nodeValue.replace(/\s+/g, " ").trim(), font }],
    };
  }

  // The browser and the canvas text shaper do not agree to the pixel, so a box
  // measured exactly tight re-wraps in the editor: a line that just fits here
  // spills to two lines there. Widening every text box by a hair costs nothing
  // visually and removes the whole class of spurious re-wraps.
  function withMetricSlack(box, font, alignment) {
    const slack = Math.max(6, font.size * 0.2);
    const shift =
      alignment.horizontal === "center" ? slack / 2 : alignment.horizontal === "right" ? slack : 0;
    return {
      x: round(box.x - shift),
      y: box.y,
      width: round(box.width + slack),
      height: round(box.height + Math.max(2, font.size * 0.08)),
    };
  }

  function textElementFor(el, style) {
    const box = contentBoxOf(el, style);
    const font = fontOf(style);
    const label = el.textContent.trim().slice(0, 32);
    if (font.size < MIN_READABLE_PX) {
      warnings.push('text "' + label + '" is ' + font.size + "px — below readable minimum");
    }
    if (el.scrollHeight > el.clientHeight + 2 && style.overflow !== "visible") {
      warnings.push('text "' + label + '" is clipped by ' + Math.round(el.scrollHeight - el.clientHeight) + "px");
    }
    const alignment = alignmentOf(style);
    const padded = withMetricSlack(box, font, alignment);
    return {
      type: "text",
      position: { x: padded.x, y: padded.y },
      size: { width: padded.width, height: padded.height },
      font,
      alignment,
      runs: runsOf(el, font),
    };
  }

  function walk(el) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;
    const opacity = num(style.opacity);
    if (opacity === 0) return;

    const box = boxOf(el);
    if (box.width < 1 || box.height < 1) return;
    if (box.x > STAGE_W || box.y > STAGE_H || box.x + box.width < 0 || box.y + box.height < 0) return;

    const applyOpacity = (element) => {
      if (opacity < 1) element.opacity = round(opacity);
      return element;
    };

    if (el instanceof SVGSVGElement) {
      emit(applyOpacity(svgElementFor(el, box)), el);
      return;
    }
    if (el.tagName === "IMG") {
      emit(applyOpacity(imageElementFor(el, style, box)), el);
      return;
    }

    const paint = paintOf(el, style, box);
    if (paint) emit(applyOpacity(paint), el);
    for (const bar of edgeBars(style, box)) emit(bar, el);

    if (hasOwnText(el) && isInlineOnly(el)) {
      emit(applyOpacity(textElementFor(el, style)), el);
      return;
    }

    // Walk childNodes rather than children so bare text interleaved with block
    // elements keeps its paint order instead of being skipped.
    for (const node of el.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        walk(node);
      } else if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) {
        const loose = looseTextElementFor(node, style);
        if (loose) emit(applyOpacity(loose), el);
      }
    }
  }

  for (const child of slide.children) walk(child);

  for (const element of elements) {
    if (element.type !== "text") continue;
    const right = element.position.x + element.size.width;
    const bottom = element.position.y + element.size.height;
    if (right > STAGE_W + 2 || bottom > STAGE_H + 2 || element.position.x < -2 || element.position.y < -2) {
      const first = element.runs[0] ? element.runs[0].text.slice(0, 32) : "";
      warnings.push('text "' + first + '" overflows the slide');
    }
  }

  const slideStyle = getComputedStyle(slide);
  const backgroundColor = parseColor(slideStyle.backgroundColor);
  const backgroundGradient = parseGradient(slideStyle.backgroundImage);

  // `ui.background` is read with readString — an object silently falls back to
  // white, which is how a dark deck ends up rendering on a white slide.
  return {
    background: backgroundColor ? backgroundColor.color : null,
    backgroundStyle: backgroundGradient
      ? {
          type: backgroundGradient.shape,
          from: backgroundGradient.from,
          to: backgroundGradient.to,
          angle: backgroundGradient.angle ?? 90,
        }
      : null,
    elements,
    warnings,
  };
}

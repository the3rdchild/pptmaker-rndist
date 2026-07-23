"use client";

import { useEffect, useMemo, useState } from "react";
import { Group, Image as KonvaImage, Rect } from "react-konva";
import {
  latexToSvg,
  sizedColoredSvg,
} from "@/components/slide-editor/formula/latex-to-svg";
import {
  loadKonvaImage,
  svgToDataUri,
} from "@/components/slide-editor/surface/exportAssets";
import {
  clamp,
  readString,
  withHash,
  type RawElement,
} from "@/components/slide-editor/model/core";

// Formulas keep their intrinsic aspect ratio and letterbox inside the
// element's box (same idea as an image with fit: "contain") — stretching a
// fraction bar or a radical sign non-uniformly reads as broken, unlike a
// chart or table which have no "natural" shape to preserve.
function containBox(
  boxWidth: number,
  boxHeight: number,
  contentWidth: number,
  contentHeight: number,
) {
  const contentAspect = contentWidth / contentHeight || 1;
  const boxAspect = boxWidth / boxHeight || 1;
  const width = boxAspect > contentAspect ? boxHeight * contentAspect : boxWidth;
  const height = boxAspect > contentAspect ? boxHeight : boxWidth / contentAspect;
  return {
    width,
    height,
    x: (boxWidth - width) / 2,
    y: (boxHeight - height) / 2,
  };
}

export function TemplateV2FormulaElement({
  element,
  width,
  height,
  interactive,
}: {
  element: RawElement;
  width: number;
  height: number;
  interactive: boolean;
}) {
  const latex = readString(element.latex) ?? "";
  const color = withHash(readString(element.color)) ?? "#101323";
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const pixelRatio =
    typeof window === "undefined"
      ? 1
      : clamp(window.devicePixelRatio || 1, 1, interactive ? 2 : 3);

  const parsed = useMemo(() => latexToSvg(latex), [latex]);
  const fitted = useMemo(
    () =>
      parsed
        ? containBox(width, height, parsed.width, parsed.height)
        : null,
    [parsed, width, height],
  );

  const dataUri = useMemo(() => {
    if (!parsed || !fitted) return null;
    const svg = sizedColoredSvg(
      parsed.svg,
      fitted.width * pixelRatio,
      fitted.height * pixelRatio,
      color,
    );
    return svgToDataUri(svg);
  }, [color, fitted, parsed, pixelRatio]);

  useEffect(() => {
    let cancelled = false;
    if (!dataUri) {
      setImage(null);
      return;
    }
    void loadKonvaImage(dataUri).then((loaded) => {
      if (!cancelled) setImage(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [dataUri]);

  return (
    <Group listening={interactive}>
      <Rect width={width} height={height} fill="rgba(0,0,0,0)" />
      {image && fitted ? (
        <KonvaImage
          image={image}
          x={fitted.x}
          y={fitted.y}
          width={fitted.width}
          height={fitted.height}
          listening={false}
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
        />
      ) : null}
    </Group>
  );
}

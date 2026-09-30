"use client";

import { useEffect, useRef } from "react";
import { contourPathAt, type ShapeMorphPlan } from "@/components/editor-react/morph-shape";
import type { FlightRect } from "@/components/editor-react/stage-raster";

const DURATION = 600;
const CURVE = "cubic-bezier(0.77, 0, 0.175, 1)";

// Match the same CSS curve used for the flight's position and dimensions.
function eased(time: number) {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 14; i += 1) {
    const t = (low + high) / 2;
    const x = 3 * (1 - t) ** 2 * t * .77 + 3 * (1 - t) * t ** 2 * .175 + t ** 3;
    if (x < time) low = t; else high = t;
  }
  const t = (low + high) / 2;
  return t * t * (3 - 2 * t);
}

export function MorphShapeFlight({
  plan, from, to, atStart, outlineOnly = false,
}: {
  plan: ShapeMorphPlan;
  from: FlightRect;
  to: FlightRect;
  atStart: boolean;
  outlineOnly?: boolean;
}) {
  const sourcePath = useRef<SVGPathElement>(null);
  const targetPath = useRef<SVGPathElement>(null);
  useEffect(() => {
    const update = (progress: number) => {
      const d = contourPathAt(plan.from, plan.to, progress);
      sourcePath.current?.setAttribute("d", d);
      targetPath.current?.setAttribute("d", d);
    };
    if (atStart) { update(0); return; }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { update(1); return; }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / DURATION);
      update(eased(progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [atStart, plan]);

  return (
    <div
      className={outlineOnly ? "morph-shape-outline pointer-events-none absolute" : "morph-flight morph-shape-flight pointer-events-none absolute"}
      style={{
        zIndex: outlineOnly ? 5 : 4,
        left: atStart ? from.x : to.x,
        top: atStart ? from.y : to.y,
        width: atStart ? from.width : to.width,
        height: atStart ? from.height : to.height,
        transition: `left ${DURATION}ms ${CURVE}, top ${DURATION}ms ${CURVE}, width ${DURATION}ms ${CURVE}, height ${DURATION}ms ${CURVE}`,
        willChange: "left, top, width, height",
      }}
    >
      <svg width="100%" height="100%" viewBox="0 0 1000 1000" preserveAspectRatio="none" overflow="visible">
        <path
          ref={sourcePath}
          d={contourPathAt(plan.from, plan.to, 0)}
          fill={outlineOnly ? "none" : plan.fromPaint.fill}
          stroke={plan.fromPaint.stroke}
          strokeWidth={plan.fromPaint.strokeWidth}
          vectorEffect="non-scaling-stroke"
          style={{ opacity: atStart ? 1 : 0, transition: `opacity ${DURATION}ms ${CURVE}` }}
        />
        <path
          ref={targetPath}
          d={contourPathAt(plan.from, plan.to, 0)}
          fill={outlineOnly ? "none" : plan.toPaint.fill}
          stroke={plan.toPaint.stroke}
          strokeWidth={plan.toPaint.strokeWidth}
          vectorEffect="non-scaling-stroke"
          style={{ opacity: atStart ? 0 : 1, transition: `opacity ${DURATION}ms ${CURVE}` }}
        />
      </svg>
    </div>
  );
}

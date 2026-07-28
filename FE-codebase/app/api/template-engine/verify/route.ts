// Round-trip check for the template exporter.
//
// Every shipped layout is run through export and then back through the render
// adapter. If the exported layout adapts to the same slide as the original,
// the exporter is faithful. This exists because the exporter's whole job is to
// not quietly lose an element, a run of text, or a slot label — and 49 shipped
// layouts are a far better corpus for proving that than any fixture I'd write.

import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { adaptTemplateV2LayoutToSlide } from "@/components/slide-editor/importing/template-v2-import";
import { exportSlideAsLayout } from "@/components/slide-editor/templates/template-v2-export";
import { listThemeIds, templatesRoot } from "@/lib/templates/server/store";
import type { Slide, SlideElement } from "@/components/slide-editor/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Summary = {
  elements: number;
  texts: string[];
  names: string[];
  slots: number;
};

function summarize(slide: Slide): Summary {
  const texts: string[] = [];
  const names: string[] = [];
  let elements = 0;
  let slots = 0;

  const visit = (element: SlideElement) => {
    elements += 1;
    if (element.name) names.push(element.name);
    if (element.slot) slots += 1;
    if (element.type === "text") {
      texts.push(element.runs.map((run) => run.text).join(""));
    }
    if (element.type === "text-list") {
      for (const item of element.items) {
        texts.push(item.map((run) => run.text).join(""));
      }
    }
    if ("children" in element && Array.isArray(element.children)) {
      element.children.forEach(visit);
    }
    if ("child" in element && element.child) visit(element.child);
  };

  slide.elements.forEach(visit);
  return { elements, texts, names, slots };
}

function diff(before: Summary, after: Summary): string[] {
  const problems: string[] = [];
  if (before.elements !== after.elements) {
    problems.push(`element count ${before.elements} -> ${after.elements}`);
  }
  if (before.slots !== after.slots) {
    problems.push(`slot metadata count ${before.slots} -> ${after.slots}`);
  }
  if (before.names.join("|") !== after.names.join("|")) {
    problems.push(
      `slot names changed (${before.names.length} -> ${after.names.length})`,
    );
  }
  if (before.texts.join("|") !== after.texts.join("|")) {
    problems.push(`text content changed`);
  }
  return problems;
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Development only" }, { status: 403 });
  }

  const themes = await listThemeIds();
  const results: Record<string, unknown>[] = [];
  let checked = 0;
  let failed = 0;

  for (const themeId of themes) {
    const bundlePath = path.join(templatesRoot(), themeId, "template.json");
    let bundle: { layouts?: Record<string, unknown>[] };
    try {
      bundle = JSON.parse(await fs.readFile(bundlePath, "utf8"));
    } catch {
      continue;
    }

    for (const layout of bundle.layouts ?? []) {
      checked += 1;
      const layoutId = String(layout.id ?? "(unnamed)");
      try {
        const before = summarize(adaptTemplateV2LayoutToSlide(layout));
        const { layout: exported, warnings } = exportSlideAsLayout(layout, {
          theme: themeId,
          id: layoutId,
          name: layoutId,
          description: String(layout.description ?? ""),
          meta: (layout.meta ?? null) as never,
        });
        const after = summarize(adaptTemplateV2LayoutToSlide(exported));
        const problems = diff(before, after);
        if (problems.length > 0) {
          failed += 1;
          results.push({ theme: themeId, layout: layoutId, problems });
        }
        void warnings;
      } catch (error) {
        failed += 1;
        results.push({
          theme: themeId,
          layout: layoutId,
          problems: [error instanceof Error ? error.message : "threw"],
        });
      }
    }
  }

  return NextResponse.json({
    checked,
    failed,
    ok: failed === 0,
    failures: results,
  });
}

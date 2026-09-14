import { NextResponse } from "next/server";

/** HTML themes share the template engine's single-trusted-author model. */
export function htmlThemeWritesBlocked(action = "written"): NextResponse | null {
  if (process.env.NODE_ENV !== "production" || process.env.TEMPLATE_ENGINE_WRITES === "true") return null;
  return NextResponse.json(
    { error: `HTML themes can only be ${action} in development. Set TEMPLATE_ENGINE_WRITES=true to enable authoring here.` },
    { status: 403 },
  );
}

// Write guard for the template engine's API routes.
//
// These routes used to be refused outside development because they wrote into
// the repo working tree. That reason is gone — writes go to object storage
// now — but the routes still have no authentication in front of them, so
// opening them up by default would let anyone who can reach a deployed
// instance create, edit and delete themes.
//
// So the guard stays, and becomes deliberate rather than incidental: set
// TEMPLATE_ENGINE_WRITES=true to enable authoring on a deployed environment.
// Replace this with a real auth check before the engine is exposed to more
// than the single trusted author it is built for.

import { NextResponse } from "next/server";

export function templateWritesBlocked(action = "written"): NextResponse | null {
  if (process.env.NODE_ENV !== "production") return null;
  if (process.env.TEMPLATE_ENGINE_WRITES === "true") return null;

  return NextResponse.json(
    {
      error:
        `Templates can only be ${action} in development. ` +
        "Set TEMPLATE_ENGINE_WRITES=true to enable authoring here.",
    },
    { status: 403 },
  );
}

import assert from "node:assert/strict";
import test from "node:test";

import { templateListKind } from "./template-list-mode.js";

test("selects the HTML library only for the explicit html query value", () => {
  assert.equal(templateListKind("html"), "html");
  assert.equal(templateListKind(null), "manual");
  assert.equal(templateListKind("manual"), "manual");
  assert.equal(templateListKind("stale-value"), "manual");
});

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import test from "node:test";

// The application resolves @/ through Next; the native test runner needs the
// same single dependency resolved explicitly without mocking its behavior.
registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "@/lib/ai-providers" ? new URL("./ai-providers.ts", import.meta.url).href : specifier, context);
} });
const { reviewSlideVisual } = await import("./ai-visual-review.ts");

for (const reply of ["not JSON", '{}', '{"issues":"invalid"}', '{"issues":[{}]}', '{"issues":[null]}', '{"issues":[]}']) {
  test(`visual review treats ${reply} as ${reply === '{"issues":[]}' ? "a valid pass" : "a failed review"}`, async () => {
    const server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: reply }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const previous = { key: process.env.CODEBUDDY_API_KEY, base: process.env.CODEBUDDY_BASE_URL };
    process.env.CODEBUDDY_API_KEY = "local-regression-test";
    process.env.CODEBUDDY_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    try {
      const result = reviewSlideVisual({ image: "data:image/png;base64,test", topic: "Test", language: "Indonesian", slots: [], fills: [], providerId: "codebuddy" });
      if (reply === '{"issues":[]}') assert.deepEqual(await result, []);
      else await assert.rejects(result, /issues array/i);
    } finally {
      for (const [name, value] of [["CODEBUDDY_API_KEY", previous.key], ["CODEBUDDY_BASE_URL", previous.base]]) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      await new Promise((resolve) => server.close(resolve));
    }
  });
}

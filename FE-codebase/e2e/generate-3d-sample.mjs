// Manual live check for the 3D image path. Keeps the generated PNG next to
// the preserved E2E deck; never changes or deletes a saved presentation.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createPhotoResolver } from "../lib/html-slides/photo-resolver.ts";

const outputDir = resolve(process.argv[2] ?? "../artifacts");
const api = "http://localhost:8081/api/v1";
const token = `live-3d-${randomUUID()}`;
const session = await fetch(`${api}/session`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }),
});
assert.equal(session.status, 200, "Docker API created an anonymous image session");

const generateAi = async (_token, prompt, { model, size }) => {
  const request = await fetch(`${api}/tools/image`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-token": token },
    body: JSON.stringify({ prompt, model, size }),
  });
  assert.ok(request.ok, `image job was accepted (${request.status})`);
  const { data } = await request.json();
  const jobId = data?.jobId;
  assert.ok(jobId, "image job id was returned");
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${api}/status/${jobId}`, { headers: { "x-session-token": token } });
    assert.ok(response.ok, `image status is readable (${response.status})`);
    const status = (await response.json()).data;
    if (status?.status === "completed") return status.result?.data_url ?? null;
    if (status?.status === "failed") throw new Error("Runware image job failed");
    await new Promise((done) => setTimeout(done, 1200));
  }
  throw new Error("Runware image job timed out");
};

const brief = "3D render of a public service desk with a staff member, citizen, computer, blank documents, and blank digital form cards moving from the citizen to the computer screen and then to the staff member, with no readable text, logos, numbers, or symbols";
const resolveImage = createPhotoResolver({
  imageSource: "ai", sessionToken: token, imageModel: "runware-mid", generateAi,
  searchStock: async () => ({ results: [] }),
});
const image = await resolveImage(brief, { slideNumber: 4, heading: "Render Model Layanan Digital", subject: brief });
assert.ok(image?.url?.startsWith("data:image/"), "3D route returned an embedded image");
const [, mime, base64] = /^data:(image\/[^;]+);base64,(.+)$/s.exec(image.url) ?? [];
assert.ok(base64, "image URL contains base64 data");
const extension = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
const imagePath = join(outputDir, `refined-3d.${extension}`);
writeFileSync(imagePath, Buffer.from(base64, "base64"));
console.log(`3D sample preserved: ${imagePath}`);

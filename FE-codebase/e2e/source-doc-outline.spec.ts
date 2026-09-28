import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { writeFile } from "node:fs/promises";

test.use({ channel: "msedge" });

test("starts the outline after an attached document is restored in Strict Mode", async ({
  page,
}, testInfo) => {
  await page.route("http://localhost:8081/api/v1/tools/aippt_outline", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: [
        "# Presentasi Dokumen",
        "## Slide dari dokumen",
        "Ringkasan dokumen yang berhasil dipulihkan.",
        "- Fakta pertama",
        "- Fakta kedua",
      ].join("\n"),
    });
  });

  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>Strict Mode Document</w:t></w:r></w:p>
          <w:p><w:r><w:t>Fakta pertama dan fakta kedua.</w:t></w:r></w:p>
        </w:body>
      </w:document>`,
  );
  const docxPath = testInfo.outputPath("strict-mode.docx");
  await writeFile(docxPath, await zip.generateAsync({ type: "nodebuffer" }));

  await page.goto("http://localhost:3000/");
  await page.locator('input[type="file"][accept=".docx"]').setInputFiles(docxPath);
  await expect(page.getByText("strict-mode.docx", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Mode HTML" }).click();
  await page.getByRole("button", { name: "Generate", exact: true }).click();

  await expect(page.getByText("Slide dari dokumen", { exact: true })).toBeVisible();
});

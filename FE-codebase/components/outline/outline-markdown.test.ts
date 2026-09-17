import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { parseOutline, parseSlideRevisionBlock, serializeOutline } from "./outline-markdown.ts";

test("keeps a page image brief separate from visible slide copy", () => {
  const parsed = parseOutline(`# Kopi Nusantara

## Dari Kebun ke Cangkir
Perjalanan biji kopi dari petani hingga pelanggan.
Visual: Petani kopi memetik buah merah matang di lereng pegunungan saat pagi.
- Panen selektif menjaga kualitas
- Rantai pasok melibatkan banyak pelaku`);

  assert.deepEqual(parsed.pages[0], {
    id: "page-0",
    heading: "Dari Kebun ke Cangkir",
    description: "Perjalanan biji kopi dari petani hingga pelanggan.",
    imageBrief: "Petani kopi memetik buah merah matang di lereng pegunungan saat pagi.",
    bullets: [
      "Panen selektif menjaga kualitas",
      "Rantai pasok melibatkan banyak pelaku",
    ],
  });
});

test("serializes an editable image brief with a stable Visual marker", () => {
  const markdown = serializeOutline({
    title: "Energi Bersih",
    pages: [{
      id: "page-0",
      heading: "Tenaga Surya Perkotaan",
      description: "Panel surya membantu gedung mengurangi ketergantungan pada listrik fosil.",
      imageBrief: "Teknisi memasang panel surya di atap gedung tinggi dengan skyline Jakarta.",
      bullets: ["Biaya panel terus menurun"],
    }],
  });

  assert.equal(markdown, `# Energi Bersih

## Tenaga Surya Perkotaan
Panel surya membantu gedung mengurangi ketergantungan pada listrik fosil.
Visual: Teknisi memasang panel surya di atap gedung tinggi dengan skyline Jakarta.
- Biaya panel terus menurun`);
});

test("normalizes a multiline image brief without leaking it into visible slide copy", () => {
  const markdown = serializeOutline({
    title: "Kopi",
    pages: [{
      id: "page-0",
      heading: "Panen",
      description: "Buah matang dipilih dengan teliti.",
      imageBrief: "Petani memetik buah kopi merah\ndi lereng saat matahari terbit.",
      bullets: [],
    }],
  });

  assert.match(markdown, /Visual: Petani memetik buah kopi merah di lereng saat matahari terbit\./);
  const reparsed = parseOutline(markdown);
  assert.equal(reparsed.pages[0]?.description, "Buah matang dipilih dengan teliti.");
  assert.equal(
    reparsed.pages[0]?.imageBrief,
    "Petani memetik buah kopi merah di lereng saat matahari terbit.",
  );
});

test("keeps old outlines compatible when no Visual marker exists", () => {
  const parsed = parseOutline(`# Lama
## Halaman Lama
Deskripsi lama.
- Poin lama`);

  assert.equal(parsed.pages[0]?.imageBrief, "");
  assert.equal(parsed.pages[0]?.description, "Deskripsi lama.");
});

test("parses image brief from an outline-chat slide revision", () => {
  const revision = parseSlideRevisionBlock(`Saya perbarui arahan visualnya.

\`\`\`slide
Kota Ramah Pejalan Kaki
Ruang publik yang aman mendorong mobilitas aktif.
Visual: Keluarga menyeberang di zebra cross lebar dengan pepohonan dan jalur sepeda.
- Trotoar yang terhubung
- Persimpangan yang aman
\`\`\``);

  assert.equal(
    revision?.imageBrief,
    "Keluarga menyeberang di zebra cross lebar dengan pepohonan dan jalur sepeda.",
  );
  assert.equal(revision?.description, "Ruang publik yang aman mendorong mobilitas aktif.");
});

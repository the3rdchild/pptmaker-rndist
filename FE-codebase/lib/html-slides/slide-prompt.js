// Prompt builders for the HTML generation mode.
//
// Two calls: one outline for the whole deck (so five slides argue one line of
// thought), then one call per slide. Per-slide calls keep each response short,
// which is what lets a cheap model hold the layout rules in mind.

import { compileThemePrompt } from "./theme-prompt.js";
import { STAGE_HEIGHT, STAGE_WIDTH } from "./slide-document.js";

export function buildOutlinePrompt(topic, slideCount) {
  return `Kamu perancang presentasi. Buat outline untuk deck ${slideCount} slide tentang: "${topic}".

Balas HANYA JSON (tanpa fence, tanpa komentar):
{"title":"<judul deck>","slides":[{"role":"<cover|content|stat|comparison|quote|closing>","heading":"<judul slide>","brief":"<2-3 kalimat: poin konkret yang harus muncul, termasuk angka/nama nyata bila relevan>","visual":"<saran perlakuan visual, mis. 'foto full-bleed', 'tiga kartu', 'satu angka raksasa'>"}]}

Aturan:
- Tepat ${slideCount} slide. Slide pertama role "cover", terakhir "closing".
- Variasikan role dan visual antar slide — jangan lima slide bentuk yang sama.
- Bahasa Indonesia. Konkret, bukan generik.`;
}

const BANNED = [
  "backdrop-filter, filter, mix-blend-mode, mask, clip-path",
  "animation, transition, @keyframes",
  "position: fixed, position: sticky",
  "@import, @media, @font-face",
  "font-family selain var(--font-heading) / var(--font-body)",
  "warna literal (#hex, rgb(), nama warna) — SEMUA warna wajib var(--color-*)",
  "ukuran font literal — SEMUA font-size wajib var(--fs-*)",
];

export function buildSlidePrompt({ theme, recipe, deckTitle, slide, index, total, repairFeedback = "" }) {
  return `Kamu desainer presentasi. Hasilkan SATU slide sebagai fragmen HTML.

DECK: "${deckTitle}"
SLIDE ${index + 1} dari ${total} — role: ${slide.role}
JUDUL: ${slide.heading}
ISI: ${slide.brief}
ARAHAN VISUAL: ${slide.visual}

DESIGN SYSTEM TERKUNCI — pakai HANYA variabel ini dan patuhi recipe:
${compileThemePrompt(theme, recipe)}

OUTPUT (wajib, persis):
  <style> ...css... </style>
  <section class="slide"> ...markup... </section>
Tanpa \`\`\`, tanpa <!doctype>/<html>/<head>/<body>, tanpa teks penjelasan.

GEOMETRI:
- Slide berukuran TETAP ${STAGE_WIDTH}x${STAGE_HEIGHT} px. Tidak boleh scroll, tidak boleh melebihi.
- Susun dengan flex / grid / position:absolute di dalam .slide. Semua ukuran dalam px atau %.
- Sisakan margin aman 64px dari tiap tepi, KECUALI elemen yang memang sengaja full-bleed.
- Isi slide sampai penuh dan seimbang. Ruang kosong besar di satu sisi tanpa alasan = slide gagal.

DILARANG (melanggar = slide rusak saat dikonversi):
${BANNED.map((b) => `- ${b}`).join("\n")}

BOLEH dan didorong:
- flex, grid, absolute, gradient linear/radial, border-radius, box-shadow, border, opacity, transform: rotate(), object-fit
- <svg> inline untuk ikon / bentuk dekoratif (pakai currentColor atau var(--color-*))

TEKS:
- Tiap potongan teks tinggal di elemen daunnya sendiri (<h1>, <p>, <span>, <li>). JANGAN campur teks langsung dengan elemen blok di satu induk.
- JANGAN pecah satu kalimat menjadi banyak <span> terpisah. Satu kalimat = satu elemen <p> atau <span>. Hanya gunakan <span> di dalam kalimat bila memang perlu warna/gaya berbeda untuk sebagian teks.
- Teks singkat dan padat — ini slide, bukan dokumen. Judul <= 9 kata, paragraf <= 28 kata.

FOTO:
- JANGAN pakai <img> dan JANGAN karang URL. Untuk tiap foto, tulis:
  <div class="photo" data-brief="deskripsi visual spesifik dalam bahasa Inggris"></div>
- Beri elemen itu ukuran nyata lewat CSS (width/height atau flex + aspect-ratio). Server yang mengisi gambarnya.

${repairFeedback ? `PERBAIKAN WAJIB DARI RENDER SEBELUMNYA:
${repairFeedback}
Jangan menambah konten. Ringkas teks, kecilkan tipe, atau ubah grid sampai seluruh elemen terlihat di dalam kanvas.` : ""}

Bahasa konten: Indonesia.`;
}

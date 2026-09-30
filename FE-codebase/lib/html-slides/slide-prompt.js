// Prompt builders for the HTML generation mode.
//
// Two calls: one outline for the whole deck (so five slides argue one line of
// thought), then one call per slide. Per-slide calls keep each response short,
// which is what lets a cheap model hold the layout rules in mind.

import { compileThemePrompt } from "./theme-prompt.js";
import { STAGE_HEIGHT, STAGE_WIDTH } from "./slide-document.js";

export function buildOutlinePrompt(topic, slideCount, { transitions = false } = {}) {
  const transitionFields = transitions
    ? ',"transition":"<morph|fade-black|fade-white|slide-left|slide-right|none>","transitionNote":"<untuk morph: semua elemen yang berlanjut dari slide sebelumnya dan bagaimana posisi/ukurannya berubah; untuk transisi lain: alasan singkat>"'
    : "";
  const transitionRules = transitions
    ? `
- "transition" = cara masuk KE slide itu. Slide pertama "none". Pilih setiap transisi dari hubungan visual dan ritme cerita antar slide, tanpa pola urutan atau kuota jenis transisi. Morph bila elemen yang sama benar-benar berlanjut; fade-black/fade-white untuk pergantian suasana, slide-left/slide-right untuk gerak yang punya arah, none untuk potongan langsung yang disengaja. Slide penutup juga bebas memakai morph atau transisi lain bila sesuai ceritanya. Jangan otomatis mengakhiri deck dengan fade.
- Untuk morph, rencanakan semua elemen yang memang berlanjut (teks yang tetap sama, foto, bentuk, kartu, diagram), bukan hanya satu jangkar. Satu elemen visual juga boleh berubah bentuk, misalnya panel membulat jadi lingkaran atau bidang warna menjadi foto. Sebutkan perubahan bentuk, posisi, dan ukurannya di transitionNote. Tidak ada batas jumlah bila komposisinya tetap jelas. Jangan memasangkan benda yang tidak punya kesinambungan visual.`
    : "";
  return `Kamu perancang presentasi. Buat outline untuk deck ${slideCount} slide tentang: "${topic}".

Balas HANYA JSON (tanpa fence, tanpa komentar):
{"title":"<judul deck>","slides":[{"role":"<cover|content|stat|comparison|process|quote|visual|closing>","heading":"<judul slide>","brief":"<2-3 kalimat: poin konkret yang harus muncul, termasuk angka/nama nyata bila relevan>","visual":"<isi visual konkret: subjek, aktivitas, dan latar yang terlihat>"${transitionFields}}]}

Aturan:
- Tepat ${slideCount} slide. Slide pertama role "cover", terakhir "closing".
- Satu gagasan utama per slide. Judul menyatakan kesimpulan spesifik, bukan label topik yang generik.
- Judul maksimal 9 kata. Pilih tindakan atau akibat yang bisa dibayangkan pembaca; hindari judul meta seperti "empat keputusan", "unsur utama", atau "perjalanan menuju" ketika bisa menyebut hal konkretnya.
- Role "stat" hanya bila ada angka nyata di input. "comparison" hanya untuk dua hal yang memang dibandingkan. "process" hanya untuk langkah berurutan. "quote" hanya bila ada kutipan dan narasumber nyata. Jangan mengarang angka, kutipan, nama, atau sumber.
- Setiap visual harus konkret: foto yang relevan, diagram dari data yang tersedia, atau render 3D untuk objek/geografi yang memang membantu penjelasan. Hindari logo, watermark, dan instruksi generik seperti "buat menarik".
- Variasikan role dan komposisi antar slide — jangan lima slide bentuk yang sama.
- Tulis dalam bahasa Indonesia yang alami untuk orang yang akan mendengar presentasi ini. Pakai kata kerja dan kalimat yang biasa dipakai orang, dengan ritme yang tidak seragam. Tiap kalimat harus menambah informasi nyata.
- Baca ulang setiap judul dan brief seperti akan diucapkan kepada teman. Ganti frasa kabur seperti "saling cocok" atau "membantu menelusuri" dengan tindakan yang jelas, tanpa mengubah fakta.
- Hindari frasa klise seperti "di era modern", "tak sekadar X, melainkan Y", "menjadi kunci", "menandai langkah penting", atau penutup kosong. Jangan memaksakan tiga poin sejajar bila materinya tidak menuntut itu.
- Pertahankan nama, angka, tanggal, kutipan, dan hubungan sebab-akibat dari input; perjelas kalimat tanpa menambah fakta. Jangan mengarang sumber.${transitionRules}`;
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

function describeAnchor(anchor) {
  const what = anchor.kind === "text" ? `teks "${anchor.text}"` : anchor.kind === "photo" ? "foto" : "bentuk";
  const { x, y, width, height } = anchor.box;
  return `- data-morph="${anchor.id}" — ${what}, x=${x} y=${y} lebar=${width} tinggi=${height}`;
}

/**
 * The morph part of a slide prompt. `from` is set when this slide morphs in
 * from the previous one (its anchors are what that slide actually rendered);
 * `toNext` when the next slide will morph from this one.
 * @param {{ from?: { note: string, anchors: object[] }, toNext?: { note: string } } | undefined} morph
 */
export function buildMorphSection(morph) {
  const parts = [];
  if (morph?.from) {
    parts.push(`TRANSISI MORPH DARI SLIDE SEBELUMNYA:
Rencana: ${morph.from.note || "elemen utama slide sebelumnya berlanjut dan berpindah posisi"}
Elemen slide sebelumnya yang bisa dilanjutkan:
${morph.from.anchors.map(describeAnchor).join("\n") || "- (tidak ada)"}
Aturan morph:
- Pakai ULANG atribut data-morph yang sama pada semua elemen yang merupakan kelanjutan visual di slide ini, termasuk shape yang berubah kontur atau frame yang berubah menjadi foto. Gunakan sebanyak yang mendukung komposisi, tanpa batas jumlah; setiap id harus unik pada satu slide. Jangan pasangkan benda yang tidak punya kesinambungan visual.
- Ubah posisi dan/atau ukurannya sesuai rencana — itulah yang membuat morph terasa. Jangan taruh di koordinat yang persis sama.
- Foto dengan data-morph yang sama otomatis memakai gambar yang sama; tetap tulis data-brief-nya.
- Isi teks yang dipakai ulang harus identik persis agar player memasangkannya; posisi, ukuran, dan gaya visualnya boleh berubah. Jika isi teks berubah, tampilkan sebagai elemen baru.`);
  }
  if (morph?.toNext) {
    parts.push(`SLIDE BERIKUTNYA AKAN MORPH DARI SLIDE INI:
Rencana: ${morph.toNext.note || "elemen utama berlanjut ke slide berikutnya"}
Tandai semua elemen yang akan berlanjut dengan atribut data-morph="<id-pendek>" yang unik (huruf kecil, mis. title, hero, stat, accent). Tanpa batas jumlah: judul, foto, angka, bentuk, atau bagian diagram boleh morph bersama. Rencanakan juga perubahan kontur shape dan perubahan bidang warna menjadi foto bila membantu cerita. Untuk bentuk bebas seperti segitiga, gunakan satu <svg data-morph="id"><path .../></svg> dengan satu path agar kontur tetap vektor. Pasang id pada elemen daunnya, termasuk <div class="photo">; jangan pada pembungkus. Pertahankan isi teks persis sama pada slide berikutnya.`);
  }
  return parts.join("\n\n");
}

export function buildSlidePrompt({ theme, recipe, deckTitle, slide, index, total, repairFeedback = "", morph }) {
  const morphSection = buildMorphSection(morph);
  return `Kamu desainer presentasi. Hasilkan SATU slide sebagai fragmen HTML.

DECK: "${deckTitle}"
SLIDE ${index + 1} dari ${total} — role: ${slide.role}
JUDUL: ${slide.heading}
ISI: ${slide.brief}
ISI GAMBAR: ${slide.visual}

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

CERITA DAN HIERARKI:
- Satu gagasan utama. Satu elemen dominan (judul, visual, atau angka nyata) dan maksimal tiga kelompok pendukung.
- Ikuti komposisi recipe secara jelas. Bila tidak ada visual samping, pusatkan judul dan blok isi sebagai satu susunan.
- Gunakan hanya fakta pada JUDUL, ISI, dan ISI GAMBAR. Jangan menciptakan angka, perbandingan, kutipan, atau sumber untuk mengisi layout.

DILARANG (melanggar = slide rusak saat dikonversi):
${BANNED.map((b) => `- ${b}`).join("\n")}

BOLEH dan didorong:
- flex, grid, absolute, gradient linear/radial, border-radius, box-shadow, border, opacity, transform: rotate(), object-fit
- <svg> inline untuk ikon / bentuk dekoratif (pakai currentColor atau var(--color-*))

TEKS:
- Tiap potongan teks tinggal di elemen daunnya sendiri (<h1>, <p>, <span>, <li>). JANGAN campur teks langsung dengan elemen blok di satu induk.
- JANGAN pecah satu kalimat menjadi banyak <span> terpisah. Satu kalimat = satu elemen <p> atau <span>. Hanya gunakan <span> di dalam kalimat bila memang perlu warna/gaya berbeda untuk sebagian teks.
- Teks singkat dan padat — ini slide, bukan dokumen. Judul <= 9 kata, paragraf <= 28 kata.
- Tulis ulang frasa kaku di ISI menjadi bahasa lisan yang alami, tanpa menambah fakta atau mengubah angka/nama. Hindari slogan, frasa "tak sekadar X, melainkan Y", penutup kosong, dan tiga poin yang dipaksakan. JUDUL yang sudah diberikan tetap dipertahankan.
- Jika font yang dipakai Public Sans, letter-spacing wajib 0 pada semua teks, termasuk label kecil, judul, dan teks yang memakai var(--font-body)/var(--font-heading).

VISUAL:
- JANGAN pakai <img> dan JANGAN karang URL. Untuk tiap foto, tulis:
  <div class="photo" data-brief="deskripsi visual spesifik dalam bahasa Inggris"></div>
- data-brief WAJIB mempertahankan subjek pada ISI GAMBAR. Theme/recipe hanya menentukan komposisi dan tidak boleh mengganti subjeknya.
- Bila ISI GAMBAR secara eksplisit meminta render 3D, tulis "3D render of ..." pada data-brief. Untuk topik lain gunakan foto atau diagram yang sesuai; jangan menambahkan globe/dekorasi 3D tanpa alasan cerita.
- Beri elemen itu ukuran nyata lewat CSS (width/height atau flex + aspect-ratio). Server yang mengisi gambarnya.

${morphSection ? `${morphSection}\n\n` : ""}${repairFeedback ? `PERBAIKAN WAJIB DARI RENDER SEBELUMNYA:
${repairFeedback}
Jangan menambah konten. Ringkas teks, kecilkan tipe, atau ubah grid sampai seluruh elemen terlihat di dalam kanvas.` : ""}

Bahasa konten: Indonesia.`;
}

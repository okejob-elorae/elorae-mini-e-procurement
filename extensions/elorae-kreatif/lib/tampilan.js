// Pengaturan tampilan panel Elorae di halaman TikTok — murni, dipakai konten.js dan popup.js,
// diuji node --test. Disimpan di chrome.storage.local["tampilanPanel"].

export const KUNCI_TAMPILAN = "tampilanPanel";

export const TEMA = ["otomatis", "terang", "gelap"];
export const UKURAN = ["lengkap", "ringkas"];
export const POSISI = ["kanan", "kiri"];
export const PERIODE_HARI = [7, 30, 90];

/** Warna aksen siap pakai. "mono" mengikuti tema: terang di panel gelap, gelap di panel terang. */
export const AKSEN = {
  lilac: { nama: "Lilac", hex: "#c9b8ff" },
  mint: { nama: "Mint", hex: "#7fe3b4" },
  coral: { nama: "Coral", hex: "#ff8a73" },
  kuning: { nama: "Kuning", hex: "#ffd75e" },
  biru: { nama: "Biru", hex: "#7cb7ff" },
  mono: { nama: "Monokrom", hex: null },
};

/** Asumsi harga per 1.000 views (rupiah) bila pemilik belum mengubahnya — ASUMSI, bukan data pasar. */
export const CPM_BAWAAN = Object.freeze({ min: 30_000, maks: 60_000 });

export const TAMPILAN_BAWAAN = Object.freeze({
  tema: "otomatis",
  aksen: "lilac",
  ukuran: "lengkap",
  posisi: "kanan",
  periode: 30,
  cpmMin: CPM_BAWAAN.min,
  cpmMaks: CPM_BAWAAN.maks,
});

const HEX = /^#[0-9a-f]{6}$/i;

function cpm(n, cadangan) {
  const x = typeof n === "string" ? Number(n.replace(/[^\d]/g, "")) : n;
  return Number.isFinite(x) && x >= 1_000 && x <= 10_000_000 ? Math.round(x) : cadangan;
}

/** Setelan apa pun → setelan sah; nilai rusak diganti bawaan, CPM ditukar bila terbalik. */
export function bersihkanTampilan(x) {
  const s = x && typeof x === "object" ? x : {};
  const aksen = typeof s.aksen === "string" && (s.aksen in AKSEN || HEX.test(s.aksen)) ? s.aksen.toLowerCase() : TAMPILAN_BAWAAN.aksen;
  let cpmMin = cpm(s.cpmMin, TAMPILAN_BAWAAN.cpmMin);
  let cpmMaks = cpm(s.cpmMaks, TAMPILAN_BAWAAN.cpmMaks);
  if (cpmMin > cpmMaks) [cpmMin, cpmMaks] = [cpmMaks, cpmMin];
  return {
    tema: TEMA.includes(s.tema) ? s.tema : TAMPILAN_BAWAAN.tema,
    aksen,
    ukuran: UKURAN.includes(s.ukuran) ? s.ukuran : TAMPILAN_BAWAAN.ukuran,
    posisi: POSISI.includes(s.posisi) ? s.posisi : TAMPILAN_BAWAAN.posisi,
    periode: PERIODE_HARI.includes(Number(s.periode)) ? Number(s.periode) : TAMPILAN_BAWAAN.periode,
    cpmMin,
    cpmMaks,
  };
}

/** "rgb(18, 18, 18)" / "rgba(…)" → [r, g, b] atau null bila transparan/tak terbaca. */
export function bacaRgb(teks) {
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(String(teks ?? "").trim());
  if (!m) return null;
  if (m[4] !== undefined) {
    const a = m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
    if (!(a > 0.5)) return null;
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function hexKeRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Luminans relatif WCAG 0..1. */
export function luminans([r, g, b]) {
  const k = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b);
}

export function kontras(a, b) {
  const [l1, l2] = [luminans(a), luminans(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * Tema yang dipakai. "otomatis" mengikuti latar halaman TikTok (TikTok punya mode terang dan
 * gelapnya sendiri, tidak selalu sama dengan sistem); latar tak terbaca → ikut sistem.
 */
export function temaEfektif(tema, latarHalaman, sistemGelap) {
  if (tema === "terang" || tema === "gelap") return tema;
  const rgb = Array.isArray(latarHalaman) ? latarHalaman : bacaRgb(latarHalaman);
  if (rgb) return luminans(rgb) < 0.35 ? "gelap" : "terang";
  return sistemGelap ? "gelap" : "terang";
}

const TINTA_GELAP = "#16121f";
const TINTA_TERANG = "#ffffff";

/** Warna aksen untuk tema itu + warna teks di atasnya (dipilih yang kontrasnya paling tinggi). */
export function warnaAksen(aksen, tema) {
  const hex = aksen in AKSEN ? (AKSEN[aksen].hex ?? (tema === "gelap" ? "#f5f3fb" : "#17151d")) : HEX.test(aksen) ? aksen.toLowerCase() : AKSEN.lilac.hex;
  const rgb = hexKeRgb(hex);
  const teks = kontras(rgb, hexKeRgb(TINTA_GELAP)) >= kontras(rgb, hexKeRgb(TINTA_TERANG)) ? TINTA_GELAP : TINTA_TERANG;
  return { aksen: hex, teks };
}

/** Warna dasar panel per tema. `naik`/`turun` = warna perubahan periode (bukan warna aksen). */
export const PALET = Object.freeze({
  gelap: Object.freeze({
    ink: "#0e0d13",
    kartu: "#18161f",
    kartu2: "#221f2b",
    garis: "rgba(255, 255, 255, 0.09)",
    teks: "#f5f3fb",
    redup: "#a19cb2",
    naik: "#7fe3b4",
    turun: "#ff98a6",
    bayangan: "0 18px 48px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.25)",
  }),
  terang: Object.freeze({
    ink: "#ffffff",
    kartu: "#f5f4f8",
    kartu2: "#ebe9f1",
    garis: "rgba(23, 21, 29, 0.10)",
    teks: "#17151d",
    redup: "#5f5b6d",
    naik: "#08683f",
    turun: "#c0283f",
    bayangan: "0 18px 48px rgba(23, 21, 29, 0.16), 0 2px 8px rgba(23, 21, 29, 0.10)",
  }),
});

/** Variabel CSS lengkap untuk panel: palet tema + aksen yang dipilih. */
export function variabelCss(tema, aksen) {
  const p = PALET[tema] ?? PALET.gelap;
  const a = warnaAksen(aksen, tema);
  return {
    "--ink": p.ink,
    "--kartu": p.kartu,
    "--kartu-2": p.kartu2,
    "--garis": p.garis,
    "--teks": p.teks,
    "--redup": p.redup,
    "--naik": p.naik,
    "--turun": p.turun,
    "--bayangan": p.bayangan,
    "--aksen": a.aksen,
    "--aksen-teks": a.teks,
  };
}

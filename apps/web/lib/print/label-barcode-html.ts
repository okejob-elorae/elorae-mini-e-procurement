import { jumlahModulCode128, periksaCode128, svgCode128 } from "@/lib/barcode/code128";
import { esc } from "@/lib/print/print-theme";

/**
 * Label barcode barang — satu dokumen HTML utuh untuk dicetak atau disimpan
 * PDF. Fungsi murni: tanpa I/O, tanpa `@elorae/db`, aman di klien (layar
 * label membangun pratinjaunya sendiri dari isian yang sedang diubah).
 *
 * Dua gaya isi:
 * - `ELORAE` (bawaan) meniru label yang sudah dipakai pemilik (2026-10-03):
 *   "STKCOD : <artikel>", batang Code 128, teks kode di bawah batang dengan
 *   "size" + ukuran dalam kotak hitam di kanannya, lalu merek "Eloraé".
 *   Tanpa harga — pemilik: "harga tidak di cetak di label".
 * - `RINCI`: nama barang, ukuran/warna, harga eceran (bisa disembunyikan),
 *   SKU (hanya bila berbeda dari kodenya), batang, dan teks kode.
 * Teks kode selalu ada di bawah batang supaya SPG tetap bisa mengetik kodenya
 * bila labelnya rusak.
 *
 * Dua tata letak:
 * - `A4`: lembar stiker A4, kisi label berukuran tetap dengan jarak 2 mm,
 *   ditengahkan di halaman. `lewati` mengosongkan sejumlah kotak di awal
 *   halaman pertama, untuk lembar stiker yang sebagian sudah terpakai.
 * - `GULUNGAN`: printer label gulungan — satu label per halaman, `@page`
 *   berukuran label itu sendiri, tanpa tepi.
 *
 * Semua teks dari data di-escape. Batang yang sama dibangun sekali per kode.
 * Bahasa dokumen selalu Indonesia: label ditempel di barang yang dijual di
 * toko di Indonesia.
 */

export const UKURAN_LABEL = {
  "50x30": { lebarMm: 50, tinggiMm: 30, kecil: false },
  "40x30": { lebarMm: 40, tinggiMm: 30, kecil: false },
  "33x15": { lebarMm: 33, tinggiMm: 15, kecil: true },
} as const;

export type UkuranLabel = keyof typeof UKURAN_LABEL;
export const DAFTAR_UKURAN_LABEL = Object.keys(UKURAN_LABEL) as UkuranLabel[];
export const UKURAN_LABEL_BAWAAN: UkuranLabel = "50x30";

export type TataLetakLabel = "A4" | "GULUNGAN";
export const DAFTAR_TATA_LETAK_LABEL: readonly TataLetakLabel[] = ["A4", "GULUNGAN"];

export type GayaLabel = "ELORAE" | "RINCI";
export const DAFTAR_GAYA_LABEL: readonly GayaLabel[] = ["ELORAE", "RINCI"];

/** Merek yang dicetak di bawah label gaya ELORAE. */
export const MEREK_LABEL = "Eloraé";

export type IsiLabel = {
  /** Kode yang disandikan menjadi batang. */
  kode: string;
  nama: string;
  /** "XL · Hitam"; null untuk barang tanpa varian. */
  varian: string | null;
  /** SKU yang ditulis kecil; tidak ditulis bila sama dengan kodenya. */
  sku: string | null;
  /** Kode artikel (SKU barang induk) — baris "STKCOD" gaya ELORAE. */
  artikel: string;
  /** Ukuran saja ("S"), untuk kotak "size" gaya ELORAE; null bila tidak diketahui. */
  ukuran: string | null;
  /** Harga eceran; null = belum diset (labelnya tanpa harga). */
  harga: number | null;
};

export type BarisCetakLabel = IsiLabel & { jumlah: number };

export type OpsiCetakLabel = {
  gaya: GayaLabel;
  ukuran: UkuranLabel;
  tataLetak: TataLetakLabel;
  tampilHarga: boolean;
  tampilNama: boolean;
  /** A4 saja: kotak kosong di awal halaman pertama (lembar bekas). */
  lewati?: number;
};

const A4_LEBAR_MM = 210;
const A4_TINGGI_MM = 297;
/** Tepi halaman minimum pada lembar A4 — kebanyakan printer tidak mencetak sampai pinggir. */
const TEPI_A4_MM = 8;
/** Jarak antar stiker pada lembar A4. */
export const JARAK_LABEL_MM = 2;
/** Tepi kiri-kanan di dalam label. Zona tenang batang ada DI DALAM lebar batang. */
const TEPI_DALAM_MM = 1;

/**
 * Di bawah lebar modul ini kamera HP mulai sulit membaca batangnya (pemindai
 * laser masih bisa). Layar memperingatkan; dokumennya tetap dibuat.
 */
export const LEBAR_MODUL_MIN_MM = 0.2;

export type TataLembar = {
  kolom: number;
  baris: number;
  perHalaman: number;
  kiriMm: number;
  atasMm: number;
};

/** Kisi label pada A4: sebanyak yang muat di dalam tepi 8 mm, ditengahkan. */
export function tataLembarA4(ukuran: UkuranLabel): TataLembar {
  const { lebarMm, tinggiMm } = UKURAN_LABEL[ukuran];
  const kolom = Math.max(1, Math.floor((A4_LEBAR_MM - 2 * TEPI_A4_MM + JARAK_LABEL_MM) / (lebarMm + JARAK_LABEL_MM)));
  const baris = Math.max(1, Math.floor((A4_TINGGI_MM - 2 * TEPI_A4_MM + JARAK_LABEL_MM) / (tinggiMm + JARAK_LABEL_MM)));
  const bulat = (n: number) => Math.round(n * 100) / 100;
  return {
    kolom,
    baris,
    perHalaman: kolom * baris,
    kiriMm: bulat((A4_LEBAR_MM - (kolom * lebarMm + (kolom - 1) * JARAK_LABEL_MM)) / 2),
    atasMm: bulat((A4_TINGGI_MM - (baris * tinggiMm + (baris - 1) * JARAK_LABEL_MM)) / 2),
  };
}

/** Lebar satu modul batang (mm) untuk kode ini pada ukuran label ini; null bila kodenya tidak bisa disandikan. */
export function lebarModulMm(kode: string, ukuran: UkuranLabel): number | null {
  const modul = jumlahModulCode128(kode);
  if (modul === null) return null;
  return (UKURAN_LABEL[ukuran].lebarMm - 2 * TEPI_DALAM_MM) / modul;
}

/** Jumlah label yang benar-benar dicetak (bilangan bulat ≥ 0 per baris). */
export function totalLabel(baris: readonly { jumlah: number }[]): number {
  return baris.reduce((n, b) => n + jumlahAman(b.jumlah), 0);
}

const jumlahAman = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

const formatAngka = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function formatHargaLabel(n: number): string {
  return `Rp ${formatAngka.format(n)}`;
}

function cssDokumen(opsi: OpsiCetakLabel): string {
  const u = UKURAN_LABEL[opsi.ukuran];
  const huruf = u.kecil
    ? { nama: "5.5pt", info: "5.5pt", sku: "5pt", kode: "5.5pt", tepiAtas: "0.7mm", batangMin: "4mm" }
    : { nama: "7pt", info: "7pt", sku: "6pt", kode: "7pt", tepiAtas: "1.2mm", batangMin: "7mm" };
  const lembar = tataLembarA4(opsi.ukuran);
  const halaman =
    opsi.tataLetak === "A4"
      ? `@page { size: A4; margin: 0; }`
      : `@page { size: ${u.lebarMm}mm ${u.tinggiMm}mm; margin: 0; }`;
  return `
    ${halaman}
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    /* Sedikit lebih pendek dari kertasnya: isi yang PERSIS setinggi halaman
       membuat sebagian peramban menambah halaman kosong di belakangnya. */
    .lembar {
      position: relative;
      width: ${A4_LEBAR_MM}mm;
      height: ${A4_TINGGI_MM - 1}mm;
      overflow: hidden;
      break-after: page;
      page-break-after: always;
    }
    .lembar:last-of-type { break-after: auto; page-break-after: auto; }
    .kisi {
      position: absolute;
      left: ${lembar.kiriMm}mm;
      top: ${lembar.atasMm}mm;
      display: grid;
      grid-template-columns: repeat(${lembar.kolom}, ${u.lebarMm}mm);
      grid-auto-rows: ${u.tinggiMm}mm;
      gap: ${JARAK_LABEL_MM}mm;
    }
    .gulung {
      width: ${u.lebarMm}mm;
      height: ${u.tinggiMm - 0.4}mm;
      overflow: hidden;
      break-after: page;
      page-break-after: always;
    }
    .gulung:last-of-type { break-after: auto; page-break-after: auto; }
    .gulung .label { height: 100%; }
    .label {
      width: ${u.lebarMm}mm;
      height: ${u.tinggiMm}mm;
      padding: ${huruf.tepiAtas} ${TEPI_DALAM_MM}mm;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      gap: 0.3mm;
    }
    /* Teks memakai tinggi alaminya; batang mengisi sisanya. */
    .label p { margin: 0; flex: none; }
    .nama {
      font-size: ${huruf.nama};
      font-weight: 700;
      line-height: 1.15;
      overflow: hidden;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: ${u.kecil ? 1 : 2};
      word-break: break-word;
    }
    .info {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 1mm;
      font-size: ${huruf.info};
      line-height: 1.15;
    }
    .varian { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .harga { margin-left: auto; font-weight: 700; white-space: nowrap; }
    .sku {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: ${huruf.sku};
      line-height: 1.1;
      white-space: nowrap;
      overflow: hidden;
    }
    .batang { flex: 1 1 auto; min-height: ${huruf.batangMin}; }
    .batang svg { display: block; width: 100%; height: 100%; }
    .batang-gagal {
      display: flex;
      align-items: center;
      justify-content: center;
      border: 0.3mm dashed #000;
      font-size: ${huruf.sku};
      text-align: center;
    }
    .kode {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: ${huruf.kode};
      line-height: 1.1;
      text-align: center;
      letter-spacing: 0.03em;
      white-space: nowrap;
      overflow: hidden;
    }
    /* Gaya ELORAE — meniru label pemilik. */
    .elorae { gap: 0.2mm; }
    .stk {
      font-size: ${u.kecil ? "5pt" : "7.5pt"};
      line-height: 1.1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .bawah {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1mm;
      flex: none;
    }
    .bawah .kode { text-align: left; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-size: ${u.kecil ? "5.5pt" : "8pt"}; letter-spacing: 0.02em; min-width: 0; text-overflow: ellipsis; }
    .size { display: flex; align-items: center; gap: 0.8mm; font-size: ${u.kecil ? "5pt" : "7pt"}; white-space: nowrap; flex: none; }
    .size b {
      display: inline-block;
      min-width: ${u.kecil ? "4mm" : "7mm"};
      padding: 0.3mm ${u.kecil ? "0.8mm" : "1.5mm"};
      background: #000;
      color: #fff;
      font-size: ${u.kecil ? "6pt" : "9.5pt"};
      font-weight: 700;
      line-height: 1.1;
      text-align: center;
    }
    .merek { text-align: center; font-size: 11pt; font-weight: 700; line-height: 1.1; letter-spacing: 0.01em; }
    .kosong-dokumen { padding: 24px; font-size: 14px; color: #4b5563; }
    @media screen {
      body { background: #e5e7eb; padding: 16px; }
      .lembar { background: #fff; margin: 0 auto 16px; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15); }
      .gulungan-layar { display: flex; flex-wrap: wrap; gap: 8px; }
      .gulung { background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2); }
      .label { outline: 1px dashed #cbd5e1; }
      .label.kosong { outline-color: #e5e7eb; background: repeating-linear-gradient(45deg, #fff, #fff 4px, #f3f4f6 4px, #f3f4f6 8px); }
    }
  `;
}

/**
 * Label gaya ELORAE. Label kecil 33×15 hanya memuat batang, kode, dan kotak
 * ukuran — "STKCOD" dan merek tidak muat tanpa membuat batangnya tak terbaca.
 */
function htmlLabelElorae(isi: IsiLabel, opsi: OpsiCetakLabel, svg: (kode: string) => string | null): string {
  const kecil = UKURAN_LABEL[opsi.ukuran].kecil;
  const bagian: string[] = [];
  const artikel = isi.artikel.trim();
  if (!kecil && artikel) bagian.push(`<p class="stk">STKCOD&nbsp;: ${esc(artikel)}</p>`);
  const batang = svg(isi.kode);
  bagian.push(
    batang ? `<div class="batang">${batang}</div>` : `<div class="batang batang-gagal">Kode tidak bisa dibuat batang</div>`,
  );
  const ukuran = isi.ukuran?.trim() ?? "";
  const size = ukuran ? `<span class="size">size <b>${esc(ukuran)}</b></span>` : "";
  bagian.push(`<div class="bawah"><p class="kode">${esc(isi.kode)}</p>${size}</div>`);
  if (!kecil) bagian.push(`<p class="merek">${esc(MEREK_LABEL)}</p>`);
  return `<div class="label elorae">${bagian.join("")}</div>`;
}

function htmlLabel(isi: IsiLabel, opsi: OpsiCetakLabel, svg: (kode: string) => string | null): string {
  if (opsi.gaya === "ELORAE") return htmlLabelElorae(isi, opsi, svg);
  const kecil = UKURAN_LABEL[opsi.ukuran].kecil;
  const bagian: string[] = [];
  if (opsi.tampilNama && isi.nama.trim()) bagian.push(`<p class="nama">${esc(isi.nama.trim())}</p>`);
  const varian = isi.varian?.trim() ? `<span class="varian">${esc(isi.varian.trim())}</span>` : "";
  const harga = opsi.tampilHarga && isi.harga !== null ? `<span class="harga">${esc(formatHargaLabel(isi.harga))}</span>` : "";
  if (varian || harga) bagian.push(`<p class="info">${varian}${harga}</p>`);
  const sku = isi.sku?.trim() ?? "";
  if (!kecil && sku && sku.toUpperCase() !== isi.kode.trim().toUpperCase()) bagian.push(`<p class="sku">${esc(sku)}</p>`);
  const batang = svg(isi.kode);
  bagian.push(
    batang
      ? `<div class="batang">${batang}</div>`
      : `<div class="batang batang-gagal">Kode tidak bisa dibuat batang</div>`,
  );
  bagian.push(`<p class="kode">${esc(isi.kode)}</p>`);
  return `<div class="label">${bagian.join("")}</div>`;
}

/** Dokumen HTML lengkap berisi semua label (`jumlah` kali per baris). */
export function buildLabelBarcodeHtml(baris: readonly BarisCetakLabel[], opsi: OpsiCetakLabel): string {
  const cache = new Map<string, string | null>();
  const svg = (kode: string) => {
    if (!cache.has(kode)) cache.set(kode, periksaCode128(kode) === null ? svgCode128(kode) : null);
    return cache.get(kode) ?? null;
  };

  const label: string[] = [];
  for (const b of baris) {
    const n = jumlahAman(b.jumlah);
    if (n === 0) continue;
    const satu = htmlLabel(b, opsi, svg);
    for (let i = 0; i < n; i++) label.push(satu);
  }

  let isi: string;
  if (label.length === 0) {
    isi = `<p class="kosong-dokumen">Belum ada label untuk dicetak.</p>`;
  } else if (opsi.tataLetak === "A4") {
    const { perHalaman } = tataLembarA4(opsi.ukuran);
    const lewati = Math.min(Math.max(0, Math.floor(opsi.lewati ?? 0)), perHalaman - 1);
    const kotak = [...Array.from({ length: lewati }, () => `<div class="label kosong"></div>`), ...label];
    const halaman: string[] = [];
    for (let i = 0; i < kotak.length; i += perHalaman) {
      halaman.push(`<section class="lembar"><div class="kisi">${kotak.slice(i, i + perHalaman).join("")}</div></section>`);
    }
    isi = halaman.join("\n");
  } else {
    isi = `<div class="gulungan-layar">${label.map((l) => `<section class="gulung">${l}</section>`).join("\n")}</div>`;
  }

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(`Label barcode — ${label.length} label`)}</title>
<style>${cssDokumen(opsi)}</style>
</head>
<body>
${isi}
</body>
</html>`;
}

/**
 * Versi cetak rekap KOL — HTML utuh, murni (tanpa I/O, tanpa `@elorae/db`).
 *
 * Bentuknya meniru KOL Manager: kepala bernama brand (kapital, renggang, abu),
 * judul "Rekap KOL", periode; setiap blok rekap berjudul kapital menjadi
 * `<h2>` kecil bergaris tipis, isinya `<pre>` monospace. Warna dikunci terang
 * (`color-scheme: light`) — kertasnya putih apa pun tema layarnya. Tombol
 * "Cetak / Simpan PDF" hanya tampil di layar; halaman membuka jendela cetak
 * sendiri kecuali alamatnya membawa `?pratinjau=1`.
 *
 * Semua teks dari data di-escape; satu-satunya nilai yang masuk skrip adalah
 * boolean.
 */

import { esc } from "@/lib/print/print-theme";
import { GARIS_REKAP, tanggalPanjang } from "./rekap";

export type OpsiCetakRekap = {
  /** Isi `susunRekap(...)`. */
  teks: string;
  brand: string;
  /** "Rabu, 7 Oktober 2026" atau "1 Oktober – 7 Oktober 2026 (7 hari)". */
  periode: string;
  kembaliHref: string;
  cetakOtomatis: boolean;
};

type Blok = { judul: string | null; isi: string };

/** Judul blok: baris pertama yang diawali kata kapital ("RINGKASAN", "KOL BARU (3)", "PERUBAHAN TAHAP: 5 kali"). */
const POLA_JUDUL = /^[A-Z][A-Z0-9]*(?: [A-Z0-9]+)*(?=$|[\s(:])/;

/** Pecah teks rekap menjadi blok berjudul; blok kepala (judul + garis) dibuang, kaki dipisah. */
export function pecahRekap(teks: string): { blok: Blok[]; kaki: string | null } {
  const mentah = teks.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  const blok: Blok[] = [];
  let kaki: string | null = null;
  for (const b of mentah) {
    const baris = b.split("\n");
    if (baris.includes(GARIS_REKAP)) continue;
    if (/^-{10,}$/.test(baris[0] ?? "")) {
      kaki = baris.slice(1).join("\n").trim() || null;
      continue;
    }
    if (POLA_JUDUL.test(baris[0] ?? "")) blok.push({ judul: baris[0], isi: baris.slice(1).join("\n") });
    else blok.push({ judul: null, isi: b });
  }
  return { blok, kaki };
}

const CSS = `
  :root { color-scheme: light; --tinta: #111827; --abu: #6b7280; --garis: #e5e7eb; }
  * { box-sizing: border-box; }
  html, body { background: #fff; color: var(--tinta); }
  body { margin: 0 auto; max-width: 800px; padding: 32px 24px 48px; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .alat { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 16px; }
  .alat a, .alat button { display: inline-flex; align-items: center; min-height: 40px; padding: 0 16px; border-radius: 8px; font: 600 14px system-ui, sans-serif; cursor: pointer; text-decoration: none; }
  .alat a { color: var(--tinta); border: 1px solid var(--garis); background: #fff; }
  .alat button { color: #fff; background: #111; border: 1px solid #111; }
  .merek { margin: 0; font-size: 12px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--abu); }
  h1 { margin: 6px 0 2px; font-size: 24px; }
  .periode { margin: 0 0 20px; color: var(--abu); }
  h2 { margin: 22px 0 6px; padding-bottom: 4px; border-bottom: 1px solid var(--garis); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #374151; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .kaki { margin-top: 28px; padding-top: 8px; border-top: 1px solid var(--garis); font-size: 12px; color: var(--abu); }
  @media screen and (max-width: 640px) { body { padding: 20px 16px 32px; } .alat button { flex: 1 1 auto; justify-content: center; } }
  @media print {
    @page { margin: 18mm 16mm; }
    body { padding: 0; max-width: none; }
    .alat { display: none; }
    h2 { break-after: avoid; page-break-after: avoid; }
  }
`;

export function htmlCetakRekap(o: OpsiCetakRekap): string {
  const { blok, kaki } = pecahRekap(o.teks);
  const isi = blok
    .map((b) => `${b.judul ? `<h2>${esc(b.judul)}</h2>` : ""}${b.isi.trim() ? `<pre>${esc(b.isi)}</pre>` : ""}`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex">
<title>${esc(`Rekap KOL — ${o.periode}`)}</title>
<style>${CSS}</style></head>
<body>
<div class="alat" role="toolbar" aria-label="Rekap">
  <a id="rk-kembali" href="${esc(o.kembaliHref)}">← Kembali</a>
  <button id="rk-cetak" type="button">Cetak / Simpan PDF</button>
</div>
<header>
  <p class="merek">${esc(o.brand)}</p>
  <h1>Rekap KOL</h1>
  <p class="periode">${esc(o.periode)}</p>
</header>
<main>
${isi}
</main>
${kaki ? `<p class="kaki">${esc(kaki)}</p>` : ""}
<script>
  (function () {
    var cetak = document.getElementById("rk-cetak");
    if (cetak) cetak.addEventListener("click", function () { window.print(); });
    var kembali = document.getElementById("rk-kembali");
    if (kembali) kembali.addEventListener("click", function (e) {
      if (window.history.length > 1) { e.preventDefault(); window.history.back(); }
    });
    var otomatis = ${o.cetakOtomatis ? "true" : "false"};
    var pratinjau = new URLSearchParams(window.location.search).get("pratinjau") === "1";
    if (otomatis && !pratinjau) window.setTimeout(function () { window.print(); }, 400);
  })();
</script>
</body></html>`;
}

/** "Rabu, 7 Oktober 2026" atau "Kamis, 1 Oktober 2026 – Rabu, 7 Oktober 2026 (7 hari)". */
export function labelPeriodeRekap(r: { dari: string; sampai: string }): string {
  if (r.dari === r.sampai) return tanggalPanjang(r.dari);
  const hari = Math.round((Date.parse(`${r.sampai}T00:00:00Z`) - Date.parse(`${r.dari}T00:00:00Z`)) / 86_400_000) + 1;
  return `${tanggalPanjang(r.dari)} – ${tanggalPanjang(r.sampai)} (${hari} hari)`;
}

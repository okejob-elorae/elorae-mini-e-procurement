import { esc, fmtDocDate, printCssBase, printPagePortrait } from "@/lib/print/print-theme";

/**
 * Surat Tukar Barang — satu lembar yang dibawa ke toko dan ditandatangani tiga
 * pihak (toko, salesman, gudang). Dua tabel terpisah dengan arah yang tertulis
 * jelas, karena kertas ini yang dicocokkan gudang dengan barang di tangannya.
 *
 * Teks label dikirim dari klien (bahasa layar); tanggal dipatok WIB oleh
 * `fmtDocDate`, jadi dokumen yang dicetak dari laptop di luar WIB tetap benar.
 */

export type BarisSuratTukar = { nama: string; qty: number };

export interface OpsiSuratTukar {
  docNo: string;
  dibuatIso: string;
  selesaiIso: string | null;
  status: string;
  toko: { nama: string; kode: string; alamat: string };
  salesman: string;
  catatan: string | null;
  masuk: BarisSuratTukar[];
  keluar: BarisSuratTukar[];
  /** Ringkasan nilai yang sudah diformat, mis. "Rp 170.000 = Rp 170.000". Null = tidak dicetak. */
  ringkasNilai: string | null;
  penerbit?: string;
  label: {
    judul: string;
    terbit: string;
    nomor: string;
    tanggal: string;
    selesai: string;
    status: string;
    toko: string;
    salesman: string;
    catatan: string;
    masuk: string;
    keluar: string;
    no: string;
    barang: string;
    qty: string;
    total: string;
    netral: string;
    nilai: string;
    ttdToko: string;
    ttdSalesman: string;
    ttdGudang: string;
  };
}

function tabel(baris: BarisSuratTukar[], o: OpsiSuratTukar): string {
  const isi = baris
    .map(
      (b, i) => `<tr>
      <td class="uom">${i + 1}</td>
      <td class="col-desc"><div class="line-name">${esc(b.nama)}</div></td>
      <td class="right">${Number(b.qty).toLocaleString("id-ID")}</td>
    </tr>`,
    )
    .join("");
  const total = baris.reduce((s, b) => s + b.qty, 0);
  return `<table class="lines"><thead><tr>
    <th>${esc(o.label.no)}</th><th>${esc(o.label.barang)}</th><th class="col-num-head">${esc(o.label.qty)}</th>
  </tr></thead><tbody>${isi}
    <tr><td></td><td class="right"><strong>${esc(o.label.total)}</strong></td><td class="right"><strong>${total.toLocaleString("id-ID")}</strong></td></tr>
  </tbody></table>`;
}

export function buatSuratTukarHtml(o: OpsiSuratTukar): string {
  const { label: l } = o;
  const penerbit = o.penerbit ?? "Elorae";
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><title>${esc(l.judul)} — ${esc(o.docNo)}</title>
<style>${printCssBase}${printPagePortrait}
  .arah { margin: 22px 0 8px; font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
  .nilai { margin-top: 16px; font-size: 10pt; }
  .sign-row { display:flex; justify-content:space-between; gap:32px; margin-top:56px; }
  .sign-box { flex:1; text-align:center; }
  .sign-line { margin-top:56px; border-top:1px solid var(--border); padding-top:6px; font-size:9pt; color:#374151; }
</style></head>
<body>
  <div class="doc-top">
    <div><h1 class="doc-title">${esc(l.judul)}</h1><p class="doc-sub">${esc(l.terbit)} ${esc(penerbit)}</p></div>
    <div class="doc-ref"><span class="lbl">${esc(l.nomor)}</span><span class="val">${esc(o.docNo)}</span>
      <span class="lbl">${esc(l.tanggal)}</span><span class="val">${esc(fmtDocDate(o.dibuatIso))}</span>
      ${o.selesaiIso ? `<span class="lbl">${esc(l.selesai)}</span><span class="val">${esc(fmtDocDate(o.selesaiIso))}</span>` : ""}
      <span class="lbl">${esc(l.status)}</span><span class="val">${esc(o.status)}</span></div>
  </div>
  <div class="two-col">
    <div><p class="block-label">${esc(l.toko)}</p><p class="payee-name">${esc(o.toko.nama)}</p>
      <p class="section-desc">${esc(o.toko.kode)}${o.toko.alamat ? ` · ${esc(o.toko.alamat)}` : ""}</p></div>
    <div><p class="block-label">${esc(l.salesman)}</p><p class="payee-name">${esc(o.salesman)}</p></div>
  </div>
  ${o.catatan ? `<p class="section-desc"><strong>${esc(l.catatan)}:</strong> ${esc(o.catatan)}</p>` : ""}
  <p class="arah">${esc(l.masuk)}</p>
  ${tabel(o.masuk, o)}
  <p class="arah">${esc(l.keluar)}</p>
  ${tabel(o.keluar, o)}
  <p class="nilai">${o.ringkasNilai ? `<strong>${esc(l.nilai)}:</strong> ${esc(o.ringkasNilai)} · ` : ""}${esc(l.netral)}</p>
  <div class="sign-row">
    <div class="sign-box"><div class="sign-line">${esc(l.ttdToko)}</div></div>
    <div class="sign-box"><div class="sign-line">${esc(l.ttdSalesman)}</div></div>
    <div class="sign-box"><div class="sign-line">${esc(l.ttdGudang)}</div></div>
  </div>
</body></html>`;
}

import { esc, fmtDocDateTime, printCssBase } from "@/lib/print/print-theme";
import {
  keadaanSuratJalan,
  LABEL_STATUS_SURAT_JALAN,
  totalPotong,
  type DataSuratJalan,
  type TokoSuratJalan,
} from "@/lib/spg/surat-jalan";

/**
 * Surat jalan satu mutasi antar toko (`StoreTransfer`) — A4 potret, satu
 * dokumen HTML utuh. Fungsi murni: tanpa I/O, tanpa `@elorae/db`.
 *
 * Selalu bahasa Indonesia: kertasnya dibawa kurir dan ditandatangani di toko,
 * dan isi yang sama keluar dari HP SPG maupun dari kantor.
 *
 * - Tanpa harga dan tanpa nilai rupiah apa pun — hanya jumlah potong.
 * - Belum dikirim → cap "DRAF" besar di setiap halaman + pita peringatan.
 * - DITOLAK/DIBATALKAN/DIKEMBALIKAN → `null` (tidak bisa dicetak).
 * - Semua teks dari data di-escape; tidak ada data yang masuk ke skrip.
 * - Tanggal dipatok WIB, karena dokumen ini dibangun di server (prod berjalan
 *   UTC), dan berbahasa Indonesia seperti seluruh isinya ("3 Okt 2026") —
 *   bukan `fmtDocDate`, yang memakai gaya Inggris dokumen PO/kanvas.
 *
 * `layar` menambah bilah alat yang hanya tampil di layar (tersembunyi saat
 * dicetak): Kembali, tombol "Cetak / simpan PDF", dan petunjuk memilih
 * "Simpan sebagai PDF". `cetakOtomatis` membuka jendela cetak begitu halaman
 * terpasang, kecuali alamatnya membawa `?pratinjau=1` (pola `useCetakOtomatis`).
 */

export type OpsiSuratJalan = {
  /** Waktu cetak, ditulis di kaki dokumen. */
  dicetakPada?: Date | string | null;
  layar?: { kembaliHref: string; cetakOtomatis: boolean };
};

const PENERBIT = "Elorae";

function blokToko(judul: string, t: TokoSuratJalan): string {
  const baris = [
    `<p class="payee-name">${esc(t.nama)}</p>`,
    t.kode ? `<p class="code-line">Kode ${esc(t.kode)}</p>` : "",
    `<p class="payee-addr">${esc(t.alamat?.trim() ? t.alamat : "—")}</p>`,
    `<p class="code-line">Telp. ${esc(t.telepon?.trim() ? t.telepon : "—")}${t.kontak?.trim() ? ` · ${esc(t.kontak)}` : ""}</p>`,
  ];
  return `<div class="toko"><p class="block-label">${esc(judul)}</p>${baris.join("")}</div>`;
}

/** "3 Okt 2026" — tanggal kalender WIB, sama bahasanya dengan isi surat jalan. */
export function tanggalSuratJalan(d: Date | string | null | undefined): string {
  if (d == null) return "—";
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return "—";
  return x.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" });
}

function kotakTtd(peran: string, keterangan: string, nama: string | null, tanggal: string | null): string {
  const namaTeks = nama ? esc(nama) : "&nbsp;";
  return `<div class="ttd">
      <p class="ttd-peran">${esc(peran)}</p>
      <p class="ttd-ket">${esc(keterangan)}</p>
      <div class="ttd-ruang"></div>
      <p class="ttd-nama">(${nama ? ` ${namaTeks} ` : '<span class="titik"></span>'})</p>
      <p class="ttd-tgl">Tanggal: ${tanggal ? esc(tanggal) : '<span class="titik pendek"></span>'}</p>
    </div>`;
}

const CSS_SURAT_JALAN = `
    .kop {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 16px;
      padding-bottom: 10px;
      margin-bottom: 24px;
      border-bottom: 2px solid var(--ink);
    }
    .kop-merek { margin: 0; font-family: var(--serif); font-size: 18pt; font-weight: 700; letter-spacing: 0.18em; }
    .kop-sub { margin: 0; font-size: 8.5pt; letter-spacing: 0.12em; text-transform: uppercase; color: #6b7280; }
    .doc-top { margin-bottom: 24px; }
    .doc-title { letter-spacing: 0.04em; }
    .pita-draf {
      margin: 0 0 20px;
      padding: 10px 14px;
      border: 2px dashed #b91c1c;
      color: #991b1b;
      font-weight: 700;
      font-size: 10pt;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .cap-draf {
      position: fixed;
      top: 42%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-28deg);
      font-family: var(--sans);
      font-size: 120pt;
      font-weight: 800;
      letter-spacing: 0.12em;
      color: rgba(185, 28, 28, 0.13);
      border: 10px solid rgba(185, 28, 28, 0.13);
      padding: 0 36px;
      pointer-events: none;
      z-index: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .isi { position: relative; z-index: 1; }
    .toko .payee-name { margin-bottom: 4px; }
    .toko .code-line { margin-top: 4px; }
    .toko .payee-addr { margin-top: 6px; }
    table.data td.no { width: 32px; color: #6b7280; }
    table.data td.sku, table.data td.varian { font-family: var(--mono); font-size: 9pt; }
    table.data td.ket { width: 18%; }
    table.data tfoot td {
      padding: 10px 10px 0 0;
      font-weight: 700;
      border-top: 1px solid var(--ink);
    }
    table.data tfoot td.right { text-align: right; font-family: var(--mono); padding-left: 8px; }
    .catatan { margin: 0 0 8px; font-size: 9.5pt; white-space: pre-wrap; }
    .catatan .ck { font-weight: 600; color: #374151; }
    .tanpa-nilai { margin: 14px 0 0; font-size: 8.5pt; color: #6b7280; }
    .ttd-baris {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 24px;
      margin-top: 36px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .ttd { text-align: center; font-size: 9.5pt; }
    .ttd-peran { margin: 0; font-weight: 700; }
    .ttd-ket { margin: 2px 0 0; font-size: 8.5pt; color: #6b7280; }
    .ttd-ruang { height: 64px; }
    .ttd-nama { margin: 0; padding-top: 6px; border-top: 1px solid var(--ink); }
    .ttd-tgl { margin: 6px 0 0; font-size: 8.5pt; color: #374151; }
    .titik { display: inline-block; min-width: 120px; border-bottom: 1px dotted #6b7280; vertical-align: bottom; }
    .titik.pendek { min-width: 80px; }
    .kaki { margin-top: 28px; font-size: 8pt; color: var(--muted); display: flex; justify-content: space-between; gap: 12px; }
    .tabel-gulir { overflow-x: auto; }

    .alat { display: none; }
    @media screen {
      html { background: #f3f4f6; }
      body { max-width: 210mm; margin: 0 auto; min-height: 100vh; box-shadow: 0 0 0 1px var(--border); }
      .alat {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 12px;
        position: sticky;
        top: 0;
        z-index: 2;
        margin: -32px -40px 24px;
        padding: 10px 16px;
        background: #fff;
        border-bottom: 1px solid var(--border);
      }
      .alat a, .alat button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 16px;
        border-radius: 8px;
        font: 600 11pt var(--sans);
        cursor: pointer;
        text-decoration: none;
      }
      .alat a { color: var(--ink); border: 1px solid var(--border); background: #fff; }
      .alat button { color: #fff; background: var(--ink); border: 1px solid var(--ink); }
      .alat .petunjuk { flex-basis: 100%; margin: 0; font-size: 9pt; color: #4b5563; }
    }
    @media screen and (max-width: 720px) {
      body { padding: 20px 16px 32px; box-shadow: none; }
      .alat { margin: -20px -16px 20px; }
      .alat button { flex: 1 1 auto; }
      .doc-top { flex-direction: column; gap: 12px; }
      .doc-ref { text-align: left; }
      .doc-title { font-size: 22pt; }
      .two-col { grid-template-columns: 1fr; gap: 20px; }
      .ttd-baris { gap: 10px; }
      .cap-draf { font-size: 64pt; border-width: 6px; padding: 0 16px; }
    }
    @media print {
      @page { size: A4; margin: 12mm 14mm 14mm; }
      html, body { background: #fff; }
      body { padding: 0; max-width: none; box-shadow: none; }
      table.data thead { display: table-header-group; }
      table.data tbody tr { page-break-inside: avoid; break-inside: avoid; }
      table.data tbody tr:nth-child(even) { background: transparent; }
      .tabel-gulir { overflow: visible; }
    }
`;

/** Bilah alat layar. Satu-satunya nilai yang masuk ke skrip adalah boolean. */
function bilahAlat(layar: NonNullable<OpsiSuratJalan["layar"]>): string {
  return `<div class="alat" role="toolbar" aria-label="Surat jalan">
    <a id="sj-kembali" href="${esc(layar.kembaliHref)}">← Kembali</a>
    <button id="sj-cetak" type="button">Cetak / simpan PDF</button>
    <p class="petunjuk">Di jendela cetak, pilih printer — atau pilih "Simpan sebagai PDF" untuk menyimpannya.</p>
  </div>
  <script>
    (function () {
      var cetak = document.getElementById("sj-cetak");
      if (cetak) cetak.addEventListener("click", function () { window.print(); });
      var kembali = document.getElementById("sj-kembali");
      if (kembali) kembali.addEventListener("click", function (e) {
        if (window.history.length > 1) { e.preventDefault(); window.history.back(); }
      });
      var otomatis = ${layar.cetakOtomatis ? "true" : "false"};
      var pratinjau = new URLSearchParams(window.location.search).get("pratinjau") === "1";
      if (otomatis && !pratinjau) window.setTimeout(function () { window.print(); }, 400);
    })();
  </script>`;
}

/**
 * Dokumen surat jalan, atau `null` bila mutasinya tidak bisa dicetak
 * (DITOLAK/DIBATALKAN/DIKEMBALIKAN).
 */
export function buildSuratJalanMutasiHtml(data: DataSuratJalan, opsi: OpsiSuratJalan = {}): string | null {
  const keadaan = keadaanSuratJalan(data.status);
  if (keadaan === "TIDAK_BISA") return null;
  const draf = keadaan === "DRAF";
  const statusLabel = LABEL_STATUS_SURAT_JALAN[data.status] ?? data.status;
  const pcs = totalPotong(data.baris);

  const baris = data.baris
    .map(
      (b, i) => `<tr>
        <td class="no">${i + 1}</td>
        <td class="sku">${esc(b.sku || "—")}</td>
        <td class="col-desc"><div class="line-name">${esc(b.nama)}</div></td>
        <td class="varian">${esc(b.varian || "—")}</td>
        <td class="right">${Number(b.qty).toLocaleString("id-ID")}</td>
        <td class="ket"></td>
      </tr>`,
    )
    .join("");

  const catatan = [
    data.alasan?.trim() ? `<p class="catatan"><span class="ck">Alasan mutasi:</span> ${esc(data.alasan.trim())}</p>` : "",
    data.catatanKantor?.trim() ? `<p class="catatan"><span class="ck">Catatan kantor:</span> ${esc(data.catatanKantor.trim())}</p>` : "",
  ].join("");

  const dikirim = data.dikirimIso ? tanggalSuratJalan(data.dikirimIso) : "Belum dikirim";
  const disetujui = data.disetujuiIso ? tanggalSuratJalan(data.disetujuiIso) : "Belum disetujui";
  const dicetak = opsi.dicetakPada ? fmtDocDateTime(opsi.dicetakPada) : "";
  const judulTab = `${draf ? "DRAF " : ""}Surat jalan ${data.docNo}`;

  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8">
${opsi.layar ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : ""}
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex">
<title>${esc(judulTab)}</title>
<style>${printCssBase}${CSS_SURAT_JALAN}</style></head>
<body>
  ${opsi.layar ? bilahAlat(opsi.layar) : ""}
  ${draf ? '<div class="cap-draf" aria-hidden="true">DRAF</div>' : ""}
  <div class="isi">
  <header class="kop">
    <p class="kop-merek">ELORAE</p>
    <p class="kop-sub">Mutasi barang antar toko</p>
  </header>
  ${draf ? `<p class="pita-draf" role="note">DRAF — barang belum dikirim (status: ${esc(statusLabel)}). Surat jalan ini belum berlaku sampai mutasi ditandai dikirim.</p>` : ""}
  <div class="doc-top">
    <div><h1 class="doc-title">SURAT JALAN</h1><p class="doc-sub">Diterbitkan oleh ${esc(PENERBIT)}</p></div>
    <div class="doc-ref">
      <span class="lbl">No. mutasi</span><span class="val">${esc(data.docNo)}</span>
      <span class="lbl">Tanggal disetujui</span><span class="val">${esc(disetujui)}</span>
      <span class="lbl">Tanggal dikirim</span><span class="val">${esc(dikirim)}</span>
      <span class="lbl">Status</span><span class="val">${esc(statusLabel)}</span>
    </div>
  </div>
  <div class="two-col">
    ${blokToko("Dari — toko asal", data.asal)}
    ${blokToko("Kepada — toko tujuan", data.tujuan)}
  </div>
  <p class="section-title">Daftar barang</p>
  <div class="tabel-gulir">
  <table class="data"><thead><tr>
    <th>No</th><th>SKU</th><th>Nama barang</th><th>Varian / ukuran</th><th class="right">Jumlah</th><th>Keterangan</th>
  </tr></thead>
  <tbody>${baris}</tbody>
  <tfoot><tr><td colspan="4">Total potong</td><td class="right">${pcs.toLocaleString("id-ID")}</td><td></td></tr></tfoot>
  </table>
  </div>
  ${catatan}
  <p class="tanpa-nilai">Dokumen ini hanya mencatat jumlah barang yang dipindahkan antar toko — bukan faktur dan bukan tagihan.</p>
  <div class="ttd-baris">
    ${kotakTtd("Dikirim oleh", "SPG toko asal", data.pengirim, data.dikirimIso ? tanggalSuratJalan(data.dikirimIso) : null)}
    ${kotakTtd("Dibawa oleh", "Kurir / sales", null, null)}
    ${kotakTtd("Diterima oleh", "Toko tujuan", data.penerima, data.diterimaIso ? tanggalSuratJalan(data.diterimaIso) : null)}
  </div>
  <div class="kaki"><span>${esc(data.docNo)} · ${esc(statusLabel)}</span><span>${dicetak ? `Dicetak ${esc(dicetak)} WIB` : ""}</span></div>
  </div>
</body></html>`;
}

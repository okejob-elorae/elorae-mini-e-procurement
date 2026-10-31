import { describe, expect, it } from "vitest";
import type { StatusMutasi } from "@/lib/spg/mutasi-aturan";
import type { DataSuratJalan } from "@/lib/spg/surat-jalan";
import { buildSuratJalanMutasiHtml } from "./surat-jalan-mutasi-html";

const dasar = (ubah: Partial<DataSuratJalan> = {}): DataSuratJalan => ({
  id: "trf1",
  docNo: "MTS/2026/00012",
  status: "DIKIRIM",
  asal: { id: "s1", kode: "TK-A", nama: "Toko Asal Jaya", alamat: "Jl. Merdeka 1, Bandung", telepon: "0812-1111-2222", kontak: "Bu Ani" },
  tujuan: { id: "s2", kode: "TK-B", nama: "Toko Tujuan Makmur", alamat: "Jl. Sudirman 9, Jakarta", telepon: null, kontak: null },
  diajukanIso: "2026-10-01T03:00:00.000Z",
  disetujuiIso: "2026-10-01T09:00:00.000Z",
  // 2 Okt 18.30 UTC = 3 Okt 01.30 WIB — tanggal di kertas harus 3 Okt.
  dikirimIso: "2026-10-02T18:30:00.000Z",
  diterimaIso: null,
  pengirim: "Sari SPG",
  penerima: null,
  alasan: "Toko tujuan kehabisan ukuran M",
  catatanKantor: null,
  baris: [
    { sku: "KAOS-HTM-M", nama: "Kaos Polos", varian: "HTM · M", qty: 5 },
    { sku: "KMJ-01", nama: "Kemeja Linen", varian: null, qty: 7 },
  ],
  ...ubah,
});

const bangun = (ubah: Partial<DataSuratJalan> = {}) => {
  const html = buildSuratJalanMutasiHtml(dasar(ubah), { dicetakPada: "2026-10-03T07:15:00.000Z" });
  if (html === null) throw new Error("tidak tercetak");
  return html;
};

describe("buildSuratJalanMutasiHtml", () => {
  it("memuat kop, judul, nomor, toko asal → tujuan, barang, total potong, dan tiga kotak tanda tangan", () => {
    const html = bangun();
    expect(html).toContain("ELORAE");
    expect(html).toContain("SURAT JALAN");
    expect(html).toContain("MTS/2026/00012");
    expect(html).toContain("Toko Asal Jaya");
    expect(html).toContain("Jl. Merdeka 1, Bandung");
    expect(html).toContain("0812-1111-2222");
    expect(html).toContain("Toko Tujuan Makmur");
    expect(html).toContain("Jl. Sudirman 9, Jakarta");
    expect(html).toContain("KAOS-HTM-M");
    expect(html).toContain("HTM · M");
    expect(html).toContain("Kemeja Linen");
    expect(html).toMatch(/Total potong<\/td><td class="right">12</);
    expect(html).toContain("Toko tujuan kehabisan ukuran M");
    for (const peran of ["Dikirim oleh", "Dibawa oleh", "Diterima oleh", "SPG toko asal", "Kurir / sales", "Toko tujuan"]) {
      expect(html).toContain(peran);
    }
    // Nama pengirim terisi; kotak kurir selalu kosong untuk ditulis tangan.
    expect(html).toContain("( Sari SPG )");
    expect(html).toContain("Status</span><span class=\"val\">Dikirim");
  });

  it("menulis tanggal kalender WIB, bukan UTC", () => {
    const html = bangun();
    // Tanggal dalam bahasa Indonesia, seperti seluruh isi surat jalan — bukan "OCT 3, 2026".
    expect(html).toContain('Tanggal dikirim</span><span class="val">3 Okt 2026<');
    expect(html).not.toContain("2 Okt 2026");
    expect(html).toContain('Tanggal disetujui</span><span class="val">1 Okt 2026<');
    expect(html).not.toMatch(/OCT \d/);
    expect(html).toContain("Dicetak 03 Okt 2026");
  });

  it("tidak memuat harga atau nilai rupiah apa pun", () => {
    for (const status of ["DIAJUKAN", "DISETUJUI", "DIKIRIM", "DITERIMA"] as StatusMutasi[]) {
      const html = bangun({ status });
      expect(html).not.toMatch(/\bRp\b/);
      expect(html).not.toMatch(/rupiah|harga|IDR/i);
    }
  });

  it("belum dikirim → cap DRAF dan pita peringatan; sudah dikirim/diterima → tanpa cap", () => {
    for (const status of ["DIAJUKAN", "DISETUJUI"] as StatusMutasi[]) {
      const html = bangun({ status, dikirimIso: null, pengirim: null, disetujuiIso: status === "DIAJUKAN" ? null : "2026-10-01T09:00:00.000Z" });
      expect(html).toContain('class="cap-draf"');
      expect(html).toContain("DRAF — barang belum dikirim");
      expect(html).toContain("<title>DRAF Surat jalan");
      expect(html).toContain("Belum dikirim");
    }
    for (const status of ["DIKIRIM", "DITERIMA"] as StatusMutasi[]) {
      const html = bangun({ status });
      expect(html).not.toContain('class="cap-draf"');
      expect(html).not.toContain("DRAF");
    }
  });

  it("DITOLAK, DIBATALKAN, dan DIKEMBALIKAN tidak bisa dicetak", () => {
    for (const status of ["DITOLAK", "DIBATALKAN", "DIKEMBALIKAN"] as StatusMutasi[]) {
      expect(buildSuratJalanMutasiHtml(dasar({ status }))).toBeNull();
    }
  });

  it("diterima → nama dan tanggal penerima terisi", () => {
    const html = bangun({ status: "DITERIMA", penerima: "Rina SPG", diterimaIso: "2026-10-04T02:00:00.000Z" });
    expect(html).toContain("( Rina SPG )");
    expect(html).toContain("4 Okt 2026");
  });

  it("meng-escape semua teks dari data", () => {
    const jahat = '<script>alert("x")</script>';
    const html = bangun({
      docNo: `MTS/<b>`,
      alasan: jahat,
      catatanKantor: jahat,
      pengirim: jahat,
      asal: { id: "s1", kode: jahat, nama: jahat, alamat: jahat, telepon: jahat, kontak: jahat },
      tujuan: { id: "s2", kode: "B", nama: jahat, alamat: "x", telepon: null, kontak: null },
      baris: [{ sku: jahat, nama: jahat, varian: jahat, qty: 1 }],
    });
    expect(html).not.toContain(jahat);
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    // Tanpa bilah alat, dokumennya tidak memuat skrip sama sekali.
    expect(html).not.toContain("<script");
  });

  it("bilah alat hanya di layar: tersembunyi saat dicetak, cetak otomatis bisa ditahan", () => {
    const html = buildSuratJalanMutasiHtml(dasar(), { layar: { kembaliHref: "/pwa/spg/mutasi/trf1", cetakOtomatis: true } }) ?? "";
    expect(html).toContain('href="/pwa/spg/mutasi/trf1"');
    expect(html).toContain("Cetak / simpan PDF");
    expect(html).toContain("Simpan sebagai PDF");
    expect(html).toContain("var otomatis = true;");
    expect(html).toContain('"pratinjau"');
    expect(html).toContain('name="viewport"');
    // `.alat` disembunyikan di luar layar dan baru ditampilkan di @media screen.
    expect(html).toMatch(/\.alat \{ display: none; \}/);
    const tanpaOtomatis = buildSuratJalanMutasiHtml(dasar(), { layar: { kembaliHref: "/x", cetakOtomatis: false } }) ?? "";
    expect(tanpaOtomatis).toContain("var otomatis = false;");
  });

  it("A4 potret dengan kepala tabel berulang di setiap halaman", () => {
    const html = bangun();
    expect(html).toContain("@page { size: A4;");
    expect(html).toContain("display: table-header-group");
  });
});

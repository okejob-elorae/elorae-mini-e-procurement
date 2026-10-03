import { describe, expect, it } from "vitest";
import {
  penerjemahPesanToko,
  pesanKonfirmasi,
  pesanPembatalan,
  pesanTandaTerima,
  pesanUntukKlaim,
  tautanPesanToko,
  type BahanKonfirmasi,
  type BahanTandaTerima,
} from "./pesan-toko";

/**
 * Pesan ke toko memakai TEKS SUNGGUHAN dari berkas bahasa, bukan tiruan:
 * yang dijaga adalah kalimat yang benar-benar terkirim. Kalau seseorang
 * menyunting `pesanToko.terima_penutup` menjadi "...sudah lunas", tes ini
 * yang gagal.
 */

const id = penerjemahPesanToko("id");
const en = penerjemahPesanToko("en");

const transfer: BahanTandaTerima = {
  toko: "Toko Maju",
  docNo: "BKM/2026/0042",
  tanggal: new Date("2026-10-01T00:00:00+07:00"),
  cara: "transfer",
  faktur: [
    { invoiceNo: "INV-001", nilai: 400_000 },
    { invoiceNo: "INV-002", nilai: 100_000 },
  ],
  nilaiFaktur: 500_000,
  potongan: 0,
  diterima: 500_000,
  giro: null,
  diterimaOleh: "Budi",
};

const VARIAN: BahanTandaTerima[] = [
  transfer,
  { ...transfer, cara: "tunai" },
  { ...transfer, cara: "aneh" },
  { ...transfer, potongan: 20_000, diterima: 480_000 },
  {
    ...transfer,
    cara: "giro",
    giro: { nomor: "GR 7781", bank: "BCA", efektif: new Date("2026-10-20T00:00:00+07:00") },
  },
  { ...transfer, cara: "giro", giro: { nomor: null, bank: null, efektif: null }, diterimaOleh: null },
];

describe("pesanTandaTerima — Aturan 1: belum diverifikasi, jadi TIDAK PERNAH 'lunas'", () => {
  it("bahasa Indonesia: tidak ada 'lunas' (termasuk 'pelunasan', 'dilunasi') di varian mana pun", () => {
    for (const b of VARIAN) {
      const pesan = pesanTandaTerima(b, id.t, "id");
      expect(pesan).not.toMatch(/lunas/i);
      expect(pesan).not.toMatch(/\bberes\b/i);
    }
  });

  it("bahasa Inggris setara: tidak menyebut tagihan terbayar/selesai", () => {
    for (const b of VARIAN) {
      const pesan = pesanTandaTerima(b, en.t, "en");
      expect(pesan).not.toMatch(/settled|paid (in full|off)|fully paid/i);
    }
  });

  it("memuat nomor dokumen, tanggal WIB, faktur, jumlah dan cara bayar", () => {
    const pesan = pesanTandaTerima(transfer, id.t, "id");
    expect(pesan).toContain("Yth. Toko Maju,");
    expect(pesan).toContain("BKM/2026/0042");
    expect(pesan).toContain("1 Okt 2026");
    expect(pesan).toContain("INV-001");
    expect(pesan).toContain("Rp 400.000");
    expect(pesan).toContain("Jumlah diterima: Rp 500.000");
    expect(pesan).toContain("Transfer bank");
    expect(pesan).toContain("Diterima oleh: Budi");
    expect(pesan).toContain("diperiksa");
  });

  it("potongan hanya muncul kalau ada", () => {
    expect(pesanTandaTerima(transfer, id.t, "id")).not.toContain("Potongan");
    const dipotong = pesanTandaTerima({ ...transfer, potongan: 20_000, diterima: 480_000 }, id.t, "id");
    expect(dipotong).toContain("Potongan: Rp 20.000");
    expect(dipotong).toContain("Nilai faktur: Rp 500.000");
  });

  it("giro: menyebut nomor, bank, tanggal efektif, dan bahwa ia baru dihitung setelah cair", () => {
    const pesan = pesanTandaTerima(VARIAN[4], id.t, "id");
    expect(pesan).toContain("GR 7781");
    expect(pesan).toContain("BCA");
    expect(pesan).toContain("20 Okt 2026");
    expect(pesan).toMatch(/setelah giro cair/);
  });
});

describe("pesanKonfirmasi", () => {
  const dasar: BahanKonfirmasi = {
    toko: "Toko Maju",
    docNo: "BKM/2026/0042",
    tanggal: new Date("2026-10-01T00:00:00+07:00"),
    diterima: 500_000,
    giro: null,
    faktur: [
      { invoiceNo: "INV-001", sisa: 0 },
      { invoiceNo: "INV-002", sisa: 50_000 },
    ],
    tertahan: 0,
  };

  it("menyebut faktur yang lunas dan yang masih bersisa beserta totalnya", () => {
    const pesan = pesanKonfirmasi(dasar, id.t, "id");
    expect(pesan).toContain("sudah kami verifikasi");
    expect(pesan).toMatch(/lunas:\n• INV-001/);
    expect(pesan).toContain("• INV-002 — sisa Rp 50.000");
    expect(pesan).toContain("Sisa tagihan faktur di atas: Rp 50.000");
  });

  it("semua lunas: tanpa bagian sisa", () => {
    const pesan = pesanKonfirmasi({ ...dasar, faktur: [{ invoiceNo: "INV-001", sisa: 0 }] }, id.t, "id");
    expect(pesan).not.toContain("bersisa");
    expect(pesan).not.toContain("Sisa tagihan");
  });

  it("retur tertahan dijelaskan, dan giro disebut sudah cair", () => {
    const pesan = pesanKonfirmasi(
      { ...dasar, tertahan: 30_000, giro: { nomor: "GR 7781", bank: "BCA" } },
      id.t,
      "id",
    );
    expect(pesan).toContain("Potongan retur Rp 30.000");
    expect(pesan).toContain("Giro no. GR 7781 (BCA) sudah cair.");
  });
});

describe("pesanUntukKlaim", () => {
  const bahan = {
    tandaTerima: transfer,
    konfirmasi: {
      toko: "Toko Maju",
      docNo: "BKM/2026/0042",
      tanggal: transfer.tanggal,
      diterima: 500_000,
      giro: null,
      // Faktur ini kebetulan sudah nol karena klaim LAIN — tanda terima tetap tidak boleh menyebutnya.
      faktur: [{ invoiceNo: "INV-001", sisa: 0 }],
      tertahan: 0,
    },
  };

  it("DIKIRIM hanya mendapat tanda terima — tanpa 'lunas' walau fakturnya kebetulan sudah nol", () => {
    const h = pesanUntukKlaim("DIKIRIM", bahan, id.t, "id");
    expect(h?.jenis).toBe("TANDA_TERIMA");
    expect(h?.pesan).not.toMatch(/lunas/i);
  });

  it("TERVERIFIKASI mendapat konfirmasi; ditolak/dibatalkan tidak mendapat apa-apa", () => {
    expect(pesanUntukKlaim("TERVERIFIKASI", bahan, id.t, "id")?.jenis).toBe("KONFIRMASI");
    expect(pesanUntukKlaim("DITOLAK", bahan, id.t, "id")).toBeNull();
    expect(pesanUntukKlaim("DIBATALKAN", bahan, id.t, "id")).toBeNull();
  });
});

describe("tautanPesanToko", () => {
  it("nomor HP → wa.me dengan nomor 62…", () => {
    const h = tautanPesanToko("0812-3456-7890", "Halo toko");
    expect(h.adaNomor).toBe(true);
    expect(h.url).toBe("https://wa.me/6281234567890?text=Halo%20toko");
  });

  it("telepon kantor atau kosong → pemilih kontak WhatsApp, bukan obrolan yang tak dibaca", () => {
    expect(tautanPesanToko("022-7301234", "Halo")).toEqual({ url: "https://wa.me/?text=Halo", adaNomor: false });
    expect(tautanPesanToko(null, "Halo").adaNomor).toBe(false);
  });
});

describe("pesanPembatalan — tanda terima yang ditarik", () => {
  const bahan = { toko: "Toko Maju", docNo: "BKM/2026/0042", tanggal: new Date("2026-10-01T00:00:00+07:00"), diterima: 500_000 };

  it("menyebut nomor BKM, tanggal, dan nilainya, dan bahwa tanda terima itu dibatalkan", () => {
    const pesan = pesanPembatalan(bahan, id.t, id.locale);
    expect(pesan).toContain("Toko Maju");
    expect(pesan).toContain("BKM/2026/0042");
    expect(pesan).toContain("1 Okt 2026");
    expect(pesan).toMatch(/Rp\s500\.000/);
    expect(pesan.toLowerCase()).toContain("dibatalkan");
  });

  it("TIDAK PERNAH menyebut lunas, dan tidak mengaku uangnya hilang", () => {
    // Uang toko memang diterima — yang salah catatannya. Pesan yang terdengar
    // seperti "pembayaran Anda batal" membuat toko mengira harus membayar lagi.
    for (const p of [pesanPembatalan(bahan, id.t, id.locale), pesanPembatalan(bahan, en.t, en.locale)]) {
      expect(p.toLowerCase()).not.toContain("lunas");
      expect(p.toLowerCase()).not.toContain("paid in full");
    }
    expect(pesanPembatalan(bahan, id.t, id.locale)).toContain("salah catat");
  });
});

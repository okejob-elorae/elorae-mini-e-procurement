import { describe, expect, it } from "vitest";
import {
  bacaRupiahSen,
  barisJurnalVoucher,
  dasarPotongSen,
  hitungVoucher,
  KATEGORI_BAWAAN,
  periksaVoucher,
  tanggalKalenderSah,
  tebakAkunKategori,
  uraianJurnalVoucher,
  type VoucherSah,
} from "./aturan";

const HARI_INI = "2026-10-08";

describe("bacaRupiahSen", () => {
  it("membaca angka, format polos, dan format Indonesia", () => {
    expect(bacaRupiahSen(1500000)).toBe(150_000_000);
    expect(bacaRupiahSen("1500000")).toBe(150_000_000);
    expect(bacaRupiahSen("1.500.000")).toBe(150_000_000);
    expect(bacaRupiahSen("1.500.000,5")).toBe(150_000_050);
    expect(bacaRupiahSen("12,75")).toBe(1275);
    expect(bacaRupiahSen("1500000.25")).toBe(150_000_025);
    expect(bacaRupiahSen("Rp 2.000")).toBe(200_000);
    expect(bacaRupiahSen(0.1 + 0.2)).toBe(30);
  });
  it("menolak isian rusak dan negatif", () => {
    for (const v of ["", "abc", "-5", "1.5.0", "1,234", "12.345,678", null, undefined, -1, Number.NaN, {}]) {
      expect(bacaRupiahSen(v), String(v)).toBeNull();
    }
  });
});

describe("tanggalKalenderSah", () => {
  it("menolak tanggal yang tidak ada", () => {
    expect(tanggalKalenderSah("2026-02-29")).toBe(false);
    expect(tanggalKalenderSah("2024-02-29")).toBe(true);
    expect(tanggalKalenderSah("2026-13-01")).toBe(false);
    expect(tanggalKalenderSah("26-10-01")).toBe(false);
  });
});

describe("periksaVoucher", () => {
  const dasar = { jenis: "OUT", tanggal: "2026-10-01", rekeningId: "kas", baris: [{ kategoriId: "k1", jumlah: "100000" }] };

  it("voucher keluar sah dirapikan", () => {
    const r = periksaVoucher({ ...dasar, pihak: "  PLN  ", keterangan: "" }, HARI_INI);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.voucher.totalSen).toBe(10_000_000);
    expect(r.voucher.pihak).toBe("PLN");
    expect(r.voucher.keterangan).toBeNull();
    expect(r.voucher.baris[0]).toMatchObject({ kategoriId: "k1", akunId: null, sen: 10_000_000, kenaPotong: false });
  });

  it("menolak tanggal masa depan, tanggal rusak, rekening kosong", () => {
    expect(periksaVoucher({ ...dasar, tanggal: "2026-10-09" }, HARI_INI)).toEqual({ ok: false, kode: "TANGGAL_MASA_DEPAN" });
    expect(periksaVoucher({ ...dasar, tanggal: "2026-02-30" }, HARI_INI)).toEqual({ ok: false, kode: "TANGGAL_TIDAK_SAH" });
    expect(periksaVoucher({ ...dasar, rekeningId: " " }, HARI_INI)).toEqual({ ok: false, kode: "REKENING_WAJIB" });
    expect(periksaVoucher({ ...dasar, jenis: "X" }, HARI_INI)).toEqual({ ok: false, kode: "JENIS_TIDAK_SAH" });
  });

  it("menyebut baris yang salah", () => {
    expect(periksaVoucher({ ...dasar, baris: [{ kategoriId: "k1", jumlah: "1" }, { jumlah: "5" }] }, HARI_INI)).toEqual({ ok: false, kode: "AKUN_BARIS_WAJIB", baris: 2 });
    expect(periksaVoucher({ ...dasar, baris: [{ akunId: "a", jumlah: "0" }] }, HARI_INI)).toEqual({ ok: false, kode: "JUMLAH_TIDAK_SAH", baris: 1 });
    expect(periksaVoucher({ ...dasar, baris: [{ akunId: "a", jumlah: "5", kanal: "BUKAN" }] }, HARI_INI)).toEqual({ ok: false, kode: "KANAL_TIDAK_SAH", baris: 1 });
    expect(periksaVoucher({ ...dasar, baris: [] }, HARI_INI)).toEqual({ ok: false, kode: "BARIS_KOSONG" });
  });

  it("potongan hanya untuk voucher keluar dan jenisnya harus dikenal", () => {
    expect(periksaVoucher({ ...dasar, jenisPotong: "PPH99" }, HARI_INI)).toEqual({ ok: false, kode: "POTONG_TIDAK_SAH" });
    expect(periksaVoucher({ ...dasar, jenis: "IN", jenisPotong: "PPH23" }, HARI_INI)).toEqual({ ok: false, kode: "POTONG_HANYA_KELUAR" });
    const r = periksaVoucher({ ...dasar, jenisPotong: "PPH4_2", adaNpwp: false }, HARI_INI);
    expect(r.ok && r.voucher.jenisPotong).toBe("PPH4_2");
    expect(r.ok && r.voucher.adaNpwp).toBe(false);
  });

  it("transfer butuh rekening tujuan yang berbeda dan jumlah positif, tanpa baris", () => {
    const t = { jenis: "TRANSFER", tanggal: "2026-10-01", rekeningId: "bank" };
    expect(periksaVoucher(t, HARI_INI)).toEqual({ ok: false, kode: "REKENING_TUJUAN_WAJIB" });
    expect(periksaVoucher({ ...t, rekeningTujuanId: "bank", jumlahTransfer: "5" }, HARI_INI)).toEqual({ ok: false, kode: "REKENING_SAMA" });
    expect(periksaVoucher({ ...t, rekeningTujuanId: "kas", jumlahTransfer: "0" }, HARI_INI)).toEqual({ ok: false, kode: "JUMLAH_TIDAK_SAH" });
    const r = periksaVoucher({ ...t, rekeningTujuanId: "kas", jumlahTransfer: "2.500.000" }, HARI_INI);
    expect(r.ok && r.voucher.totalSen).toBe(250_000_000);
    expect(r.ok && r.voucher.baris).toEqual([]);
  });
});

describe("hitungVoucher & barisJurnalVoucher", () => {
  const sewa: VoucherSah = {
    jenis: "OUT",
    tanggal: "2026-10-01",
    rekeningId: "bank",
    rekeningTujuanId: null,
    pihak: "Pemilik ruko",
    pemasokId: null,
    keterangan: null,
    fotoUrl: null,
    baris: [
      { kategoriId: "sewa", akunId: null, sen: 1_000_000_000, memo: "Sewa Oktober", kanal: null, tokoId: null, kenaPotong: true },
      { kategoriId: "listrik", akunId: null, sen: 50_000_000, memo: null, kanal: "LAINNYA", tokoId: null, kenaPotong: false },
    ],
    totalSen: 1_050_000_000,
    jenisPotong: "PPH4_2",
    adaNpwp: true,
  };

  it("PPh 4(2) sewa hanya atas baris bertanda: 10% × Rp 10 jt", () => {
    expect(dasarPotongSen(sewa.baris)).toBe(1_000_000_000);
    expect(hitungVoucher(sewa)).toEqual({ totalSen: 1_050_000_000, dasarPotongSen: 1_000_000_000, potongSen: 100_000_000, netoSen: 950_000_000 });
  });

  it("tanpa baris bertanda, semua baris kena potongan", () => {
    const v = { ...sewa, baris: sewa.baris.map((b) => ({ ...b, kenaPotong: false })) };
    expect(hitungVoucher(v).dasarPotongSen).toBe(1_050_000_000);
  });

  it("jurnal keluar seimbang: DR beban bruto / CR bank neto / CR hutang PPh", () => {
    const h = hitungVoucher(sewa);
    const baris = barisJurnalVoucher(sewa, h, ["beban-sewa", "beban-listrik"], "hutang-pph42");
    expect(baris).toEqual([
      { chartAccountId: "beban-sewa", debit: 10_000_000, credit: 0, memo: "Sewa Oktober" },
      { chartAccountId: "beban-listrik", debit: 500_000, credit: 0, channel: "LAINNYA" },
      { chartAccountId: "bank", debit: 0, credit: 9_500_000 },
      { chartAccountId: "hutang-pph42", debit: 0, credit: 1_000_000, memo: "PPH4_2_PAYABLE" },
    ]);
    const dr = baris.reduce((s, b) => s + Math.round(b.debit * 100), 0);
    const cr = baris.reduce((s, b) => s + Math.round(b.credit * 100), 0);
    expect(dr).toBe(cr);
  });

  it("masuk: DR rekening / CR akun baris; transfer: DR tujuan / CR asal", () => {
    const masuk: VoucherSah = { ...sewa, jenis: "IN", jenisPotong: null, baris: [sewa.baris[1]], totalSen: 50_000_000 };
    expect(barisJurnalVoucher(masuk, hitungVoucher(masuk), ["pendapatan-lain"], null)).toEqual([
      { chartAccountId: "bank", debit: 500_000, credit: 0 },
      { chartAccountId: "pendapatan-lain", debit: 0, credit: 500_000, channel: "LAINNYA" },
    ]);
    const trf: VoucherSah = { ...sewa, jenis: "TRANSFER", rekeningTujuanId: "kas-kecil", baris: [], totalSen: 200_000_000, jenisPotong: null };
    expect(barisJurnalVoucher(trf, hitungVoucher(trf), [], null).map((b) => [b.chartAccountId, b.debit, b.credit])).toEqual([
      ["kas-kecil", 2_000_000, 0],
      ["bank", 0, 2_000_000],
    ]);
  });

  it("PPh 23 tanpa NPWP dua kali lipat (4%)", () => {
    const jasa: VoucherSah = { ...sewa, jenisPotong: "PPH23", adaNpwp: false, baris: [sewa.baris[0]], totalSen: 1_000_000_000 };
    expect(hitungVoucher(jasa).potongSen).toBe(40_000_000);
  });

  it("uraian jurnal berbahasa Indonesia", () => {
    expect(uraianJurnalVoucher("OUT", "BKK/2026/10/0001", "PLN", "Tagihan September")).toBe("Kas/bank keluar BKK/2026/10/0001 · PLN · Tagihan September");
    expect(uraianJurnalVoucher("TRANSFER", "TRF/1", null, null)).toBe("Transfer antar rekening TRF/1");
  });
});

describe("tebakAkunKategori", () => {
  const akun = [
    { id: "gaji", code: "6201", name: "Beban gaji", type: "BEBAN" },
    { id: "sewa", code: "6202", name: "Beban sewa", type: "BEBAN" },
    { id: "listrik", code: "6203", name: "Beban listrik & internet", type: "BEBAN" },
    { id: "kirim", code: "6107", name: "Beban packing & pengiriman", type: "BEBAN" },
    { id: "jual", code: "4101", name: "Penjualan", type: "PENDAPATAN" },
  ];
  const k = (nama: string) => KATEGORI_BAWAAN.find((x) => x.nama === nama)!;
  it("mencocokkan kata kunci, jatuh ke akun berkode terkecil bila tidak ada", () => {
    expect(tebakAkunKategori(k("Sewa"), akun)).toBe("sewa");
    expect(tebakAkunKategori(k("Listrik & air"), akun)).toBe("listrik");
    expect(tebakAkunKategori(k("Internet & telepon"), akun)).toBe("listrik");
    expect(tebakAkunKategori(k("Ongkos kirim"), akun)).toBe("kirim");
    expect(tebakAkunKategori(k("Lain-lain"), akun)).toBe("kirim");
    expect(tebakAkunKategori(k("Pendapatan lain-lain"), akun)).toBe("jual");
    expect(tebakAkunKategori(k("Sewa"), [])).toBeNull();
  });
});

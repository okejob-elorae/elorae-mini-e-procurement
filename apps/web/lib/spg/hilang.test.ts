import { describe, expect, it } from "vitest";
import {
  alokasiPotong,
  awalBulanBerikutWib,
  bacaIsianRupiah,
  bacaJejakKeringanan,
  bagiRata,
  batasPotongSen,
  hargaBersihKirim,
  hargaTerimaKonsi,
  kalimatKeringanan,
  kurangDariOpname,
  kurangDariTerima,
  nilaiSatuanSen,
  periksaBagian,
  pilihHargaTerima,
  presetBagian,
  rapikanTeksHilang,
  statusSesudahLunas,
  terapkanDiskonPegawai,
  tulisIsianRupiah,
  umurHari,
  validasiAturanBarangHilang,
  type IsianBagian,
  type KandidatHargaTerima,
} from "./hilang";
import { BARANG_HILANG_BAWAAN, bacaBarangHilang } from "./pengaturan";

describe("periksaBagian", () => {
  it("menerima bagian yang jumlahnya tepat sama dengan total", () => {
    const r = periksaBagian(
      [
        { bearer: "SPG", bearerUserId: "u1", amount: 60_000 },
        { bearer: "TOKO", bearerUserId: "abaikan", amount: 30_000 },
        { bearer: "ELORAE", amount: 10_000 },
      ],
      100_000,
      true,
    );
    expect(r).toEqual({
      ok: true,
      bagian: [
        { bearer: "SPG", bearerUserId: "u1", amount: 60_000 },
        // Orang dibuang untuk toko/Elorae.
        { bearer: "TOKO", bearerUserId: null, amount: 30_000 },
        { bearer: "ELORAE", bearerUserId: null, amount: 10_000 },
      ],
    });
  });

  it("menolak jumlah yang tidak sama, sekecil satu sen pun", () => {
    expect(periksaBagian([{ bearer: "ELORAE", amount: 99_999.99 }], 100_000, false)).toEqual({ ok: false, kode: "JUMLAH_TIDAK_SAMA" });
  });

  it("mewajibkan orang untuk SPG/SALES dan toko untuk bagian toko", () => {
    expect(periksaBagian([{ bearer: "SALES", amount: 10 }], 10, true)).toEqual({ ok: false, kode: "ORANG_WAJIB" });
    expect(periksaBagian([{ bearer: "SPG", bearerUserId: "  ", amount: 10 }], 10, true)).toEqual({ ok: false, kode: "ORANG_WAJIB" });
    expect(periksaBagian([{ bearer: "TOKO", amount: 10 }], 10, false)).toEqual({ ok: false, kode: "TOKO_WAJIB" });
  });

  it("menolak penanggung kembar, jumlah nol/negatif/lebih dari 2 desimal, total tidak sah", () => {
    expect(
      periksaBagian(
        [
          { bearer: "SPG", bearerUserId: "u1", amount: 5 },
          { bearer: "SPG", bearerUserId: "u1", amount: 5 },
        ],
        10,
        true,
      ),
    ).toEqual({ ok: false, kode: "BAGIAN_KEMBAR" });
    expect(periksaBagian([{ bearer: "ELORAE", amount: 0 }], 10, true)).toEqual({ ok: false, kode: "JUMLAH_TIDAK_SAH" });
    expect(periksaBagian([{ bearer: "ELORAE", amount: 1.234 }], 1.234, true)).toEqual({ ok: false, kode: "TOTAL_TIDAK_SAH" });
    expect(periksaBagian([{ bearer: "ELORAE", amount: 10 }], 0, true)).toEqual({ ok: false, kode: "TOTAL_TIDAK_SAH" });
    expect(periksaBagian([], 10, true)).toEqual({ ok: false, kode: "BAGIAN_KOSONG" });
    expect(periksaBagian([{ bearer: "GUDANG", amount: 10 }], 10, true)).toEqual({ ok: false, kode: "PENANGGUNG_TIDAK_SAH" });
  });

  it("dua SPG berbeda boleh, SPG dan SALES orang yang sama boleh", () => {
    const r = periksaBagian(
      [
        { bearer: "SPG", bearerUserId: "u1", amount: 5 },
        { bearer: "SALES", bearerUserId: "u1", amount: 5 },
      ],
      10,
      true,
    );
    expect(r.ok).toBe(true);
  });
});

describe("bagiRata", () => {
  it("membagi dalam rupiah utuh, sisa ke yang pertama, jumlah selalu tepat", () => {
    expect(bagiRata(100_000_00, 3)).toEqual([33_334_00, 33_333_00, 33_333_00]);
    expect(bagiRata(1_000_50, 2)).toEqual([500_50, 500_00]);
    for (const [total, n] of [
      [7_00, 3],
      [1_23, 5],
      [99_999_99, 7],
    ]) {
      expect(bagiRata(total, n).reduce((a, b) => a + b, 0)).toBe(total);
    }
    expect(bagiRata(100, 0)).toEqual([]);
  });
});

describe("presetBagian", () => {
  const konteks = { total: 100_000, adaToko: true, spgIds: ["a", "b", "a"], salesmanId: "s" };
  it("SPG toko ini dibagi rata (tanpa kembar)", () => {
    expect(presetBagian("SPG_TOKO", konteks)).toEqual([
      { bearer: "SPG", bearerUserId: "a", amount: 50_000 },
      { bearer: "SPG", bearerUserId: "b", amount: 50_000 },
    ]);
  });
  it("null kalau tidak bisa dipakai", () => {
    expect(presetBagian("TOKO", { ...konteks, adaToko: false })).toBeNull();
    expect(presetBagian("SPG_TOKO", { ...konteks, spgIds: [] })).toBeNull();
    expect(presetBagian("SALES_TOKO", { ...konteks, salesmanId: null })).toBeNull();
    expect(presetBagian("ELORAE", { ...konteks, total: 0 })).toBeNull();
  });
  it("hasil preset selalu lolos periksaBagian", () => {
    for (const p of ["ELORAE", "TOKO", "SPG_TOKO", "SALES_TOKO"] as const) {
      const isi = presetBagian(p, { ...konteks, total: 33_333.33 });
      expect(periksaBagian(isi, 33_333.33, true).ok).toBe(true);
    }
  });
});

describe("potongan", () => {
  it("batas = persen × bruto, dibulatkan ke bawah ke rupiah utuh", () => {
    expect(batasPotongSen(1_234_567, 50)).toBe(617_283_00);
    expect(batasPotongSen(1_000_000, 0)).toBe(0);
    expect(batasPotongSen(1_000_000, 100)).toBe(1_000_000_00);
    expect(batasPotongSen(0, 50)).toBe(0);
    expect(batasPotongSen(-5, 50)).toBe(0);
  });

  it("alokasi menghabiskan bagian terlama dulu, lalu mencicil yang berikutnya", () => {
    expect(
      alokasiPotong(
        [
          { id: "lama", sisaSen: 300_00 },
          { id: "baru", sisaSen: 500_00 },
          { id: "lebihBaru", sisaSen: 100_00 },
        ],
        450_00,
      ),
    ).toEqual([
      { id: "lama", potongSen: 300_00 },
      { id: "baru", potongSen: 150_00 },
    ]);
    expect(alokasiPotong([{ id: "x", sisaSen: 0 }, { id: "y", sisaSen: 10 }], 5)).toEqual([{ id: "y", potongSen: 5 }]);
    expect(alokasiPotong([{ id: "x", sisaSen: 10 }], 0)).toEqual([]);
  });

  it("status SELESAI hanya kalau semua bagian lunas", () => {
    expect(statusSesudahLunas([{ amount: 10, settledAmount: 10 }, { amount: 5, settledAmount: 5 }])).toBe("SELESAI");
    expect(statusSesudahLunas([{ amount: 10, settledAmount: 10 }, { amount: 5, settledAmount: 4.99 }])).toBe("DITETAPKAN");
    expect(statusSesudahLunas([])).toBe("DITETAPKAN");
  });
});

describe("nilaiSatuanSen", () => {
  const bahan = { sellingPrice: 100_000, avgCost: 40_000, termsType: "KONSI" as const, markupPercent: 20, priceDiscountPercent: null };
  it("mengikuti dasar nilai", () => {
    expect(nilaiSatuanSen("HARGA_ELORAE", bahan)).toBe(100_000_00);
    expect(nilaiSatuanSen("HPP", bahan)).toBe(40_000_00);
    // Konsinyasi: harga jual dinaikkan markup toko → eceran di rak (100.000 × 1,2).
    expect(nilaiSatuanSen("ECERAN", bahan)).toBe(120_000_00);
    expect(nilaiSatuanSen("ECERAN", { ...bahan, termsType: "PUTUS" })).toBe(100_000_00);
    // Toko putus: harga jual dikurangi diskon harga toko.
    expect(nilaiSatuanSen("ECERAN", { ...bahan, termsType: "PUTUS", priceDiscountPercent: 10 })).toBe(90_000_00);
    expect(nilaiSatuanSen("ECERAN", { ...bahan, termsType: null })).toBe(100_000_00);
  });
  it("yang tidak diketahui bernilai nol", () => {
    expect(nilaiSatuanSen("HARGA_ELORAE", { ...bahan, sellingPrice: null })).toBe(0);
    expect(nilaiSatuanSen("HPP", { ...bahan, avgCost: null })).toBe(0);
    expect(nilaiSatuanSen("HARGA_TERIMA", { ...bahan, sellingPrice: null, hargaTerima: null })).toBe(0);
  });
  it("harga toko terima: harga kiriman, atau harga jual Elorae kalau toko belum pernah menerima", () => {
    expect(nilaiSatuanSen("HARGA_TERIMA", { ...bahan, hargaTerima: 75_000 })).toBe(75_000_00);
    expect(nilaiSatuanSen("HARGA_TERIMA", { ...bahan, hargaTerima: 74_999.995 })).toBe(75_000_00);
    expect(nilaiSatuanSen("HARGA_TERIMA", { ...bahan, hargaTerima: null })).toBe(100_000_00);
    expect(nilaiSatuanSen("HARGA_TERIMA", bahan)).toBe(100_000_00);
    expect(nilaiSatuanSen("HARGA_TERIMA", { ...bahan, hargaTerima: 0 })).toBe(100_000_00);
  });
});

describe("harga toko terima", () => {
  it("harga bersih nota kiriman = harga − potongan baris ÷ jumlah, ke sen", () => {
    expect(hargaBersihKirim(80_000, 10_000, 2)).toBe(75_000);
    expect(hargaBersihKirim(80_000, 0, 3)).toBe(80_000);
    expect(hargaBersihKirim(80_000, null, 3)).toBe(80_000);
    expect(hargaBersihKirim(10_000, 1_000, 3)).toBe(9_666.67);
    expect(hargaBersihKirim(null, 0, 1)).toBeNull();
    expect(hargaBersihKirim(80_000, 0, 0)).toBeNull();
    // Baris bonus / potongan penuh bukan harga terima.
    expect(hargaBersihKirim(0, 0, 2)).toBeNull();
    expect(hargaBersihKirim(50_000, 100_000, 2)).toBeNull();
  });

  it("konsinyasi: harga di toko ÷ (1 + markup toko) — 120.000 markup 20% → 100.000", () => {
    expect(hargaTerimaKonsi(120_000, 20)).toBe(100_000);
    expect(hargaTerimaKonsi(100_000, 25)).toBe(80_000);
    expect(hargaTerimaKonsi(100_000, 0)).toBe(100_000);
    expect(hargaTerimaKonsi(99_999, 33.33)).toBe(75_001.13);
    expect(hargaTerimaKonsi(80_000, 100)).toBe(40_000);
    // Markup tidak sah → harga tidak pernah dinaikkan, dipakai apa adanya.
    expect(hargaTerimaKonsi(80_000, null)).toBe(80_000);
    expect(hargaTerimaKonsi(80_000, -5)).toBe(80_000);
    expect(hargaTerimaKonsi(80_000, 1000)).toBe(80_000);
    expect(hargaTerimaKonsi(80_000, Number.NaN)).toBe(80_000);
    expect(hargaTerimaKonsi(0, 25)).toBeNull();
    expect(hargaTerimaKonsi(null, 25)).toBeNull();
  });

  const k = (itemId: string, variantSku: string | null, harga: number, hari: number): KandidatHargaTerima => ({
    itemId,
    variantSku,
    harga,
    pada: new Date(Date.UTC(2026, 8, hari)),
  });

  it("varian persis yang terbaru lebih dulu, walau ada kiriman varian lain yang lebih baru", () => {
    const kandidat = [k("A", "A-M", 70_000, 1), k("A", "A-L", 90_000, 20), k("A", "A-M", 75_000, 10), k("B", "B-M", 1, 30)];
    expect(pilihHargaTerima(kandidat, "A", "A-M")).toBe(75_000);
    expect(pilihHargaTerima(kandidat, "A", "A-L")).toBe(90_000);
  });

  it("tanpa varian persis: kiriman terbaru barang yang sama (konsinyasi tidak punya varian)", () => {
    const kandidat = [k("A", "A-L", 90_000, 20), k("A", null, 60_000, 25), k("A", "A-M", 75_000, 10)];
    expect(pilihHargaTerima(kandidat, "A", "A-XL")).toBe(60_000);
    expect(pilihHargaTerima(kandidat, "A", "")).toBe(60_000);
    expect(pilihHargaTerima([k("K", null, 55_000, 1), k("K", null, 58_000, 2)], "K", "K-M")).toBe(58_000);
  });

  it("barang yang belum pernah diterima, atau hanya berharga nol → null", () => {
    expect(pilihHargaTerima([k("A", "A-M", 75_000, 1)], "B", "B-M")).toBeNull();
    expect(pilihHargaTerima([k("A", "A-M", 0, 5)], "A", "A-M")).toBeNull();
    expect(pilihHargaTerima([], "A", "")).toBeNull();
  });

  it("berwaktu sama: urutan masukan menentukan", () => {
    expect(pilihHargaTerima([k("A", "A-M", 1_000, 5), k("A", "A-M", 2_000, 5)], "A", "A-M")).toBe(1_000);
  });
});

describe("terapkanDiskonPegawai", () => {
  const spg = (id: string, amount: number): IsianBagian => ({ bearer: "SPG", bearerUserId: id, amount });
  const jumlahSen = (b: IsianBagian[]) => b.reduce((n, x) => n + Math.round(x.amount * 100), 0);

  it("bagian SPG/SALES dikurangi persen, dibulatkan ke bawah ke rupiah utuh; Elorae menanggung selisihnya", () => {
    const awal: IsianBagian[] = [spg("a", 75_000), { bearer: "SALES", bearerUserId: "s", amount: 33_333.33 }, { bearer: "TOKO", bearerUserId: null, amount: 10_000 }];
    const r = terapkanDiskonPegawai(awal, 20);
    expect(r.bagian).toEqual([
      spg("a", 60_000),
      // 33.333,33 × 80% = 26.666,664 → ke bawah 26.666.
      { bearer: "SALES", bearerUserId: "s", amount: 26_666 },
      { bearer: "TOKO", bearerUserId: null, amount: 10_000 },
      { bearer: "ELORAE", bearerUserId: null, amount: 21_667.33 },
    ]);
    expect(r.diserapSen).toBe(21_667_33);
    expect(jumlahSen(r.bagian)).toBe(jumlahSen(awal));
    expect(r.perOrang).toEqual([
      { bearer: "SPG", bearerUserId: "a", sebelum: 75_000, sesudah: 60_000 },
      { bearer: "SALES", bearerUserId: "s", sebelum: 33_333.33, sesudah: 26_666 },
    ]);
    // Masukan tidak diubah.
    expect(awal[0].amount).toBe(75_000);
  });

  it("digabung ke bagian Elorae yang sudah ada, di tempatnya", () => {
    const r = terapkanDiskonPegawai([{ bearer: "ELORAE", bearerUserId: null, amount: 5_000 }, spg("a", 25_001)], 20);
    // 25.001 × 80% = 20.000,8 → 20.000; selisih 5.001.
    expect(r.bagian).toEqual([{ bearer: "ELORAE", bearerUserId: null, amount: 10_001 }, spg("a", 20_000)]);
    expect(r.diserapSen).toBe(5_001_00);
  });

  it("tanpa bagian SPG/SALES, 0%, atau persen tidak sah: tidak berubah", () => {
    const tanpaOrang: IsianBagian[] = [{ bearer: "TOKO", bearerUserId: null, amount: 80_000 }];
    for (const [bagian, persen] of [
      [tanpaOrang, 20],
      [[spg("a", 80_000)], 0],
      [[spg("a", 80_000)], 20.5],
      [[spg("a", 80_000)], 101],
      [[spg("a", 80_000)], -5],
    ] as [IsianBagian[], number][]) {
      const r = terapkanDiskonPegawai(bagian, persen);
      expect(r).toEqual({ bagian, diserapSen: 0, perOrang: [] });
    }
  });

  it("100%: bagian orang dibuang, seluruhnya ke Elorae, dan lolos periksaBagian", () => {
    const r = terapkanDiskonPegawai([spg("a", 40_000), spg("b", 40_000)], 100);
    expect(r.bagian).toEqual([{ bearer: "ELORAE", bearerUserId: null, amount: 80_000 }]);
    expect(periksaBagian(r.bagian, 80_000, true).ok).toBe(true);
  });

  it("hasilnya selalu lolos periksaBagian dengan total yang sama", () => {
    for (const persen of [1, 7, 20, 33, 50, 99]) {
      const awal: IsianBagian[] = [spg("a", 33_333.34), spg("b", 33_333.33), { bearer: "TOKO", bearerUserId: null, amount: 33_333.33 }];
      const r = terapkanDiskonPegawai(awal, persen);
      expect(periksaBagian(r.bagian, 100_000, true)).toMatchObject({ ok: true });
      expect(r.bagian.filter((b) => b.bearer === "SPG").every((b) => Number.isInteger(b.amount))).toBe(true);
    }
  });

  it("kalimat dan jejak keringanan", () => {
    expect(kalimatKeringanan(20, 25_000_00)).toBe("Keringanan diskon pegawai 20%: Rp 25.000 ditanggung Elorae.");
    expect(kalimatKeringanan(15, 6_667_33)).toBe("Keringanan diskon pegawai 15%: Rp 6.667,33 ditanggung Elorae.");
    const jejak = { persen: 20, diserap: 15_000, sebelum: [spg("a", 75_000)], perOrang: [{ bearer: "SPG", bearerUserId: "a", sebelum: 75_000, sesudah: 60_000 }] };
    expect(bacaJejakKeringanan({ totalBerubah: false, keringanan: jejak })).toEqual(jejak);
    expect(bacaJejakKeringanan({ totalBerubah: false })).toBeNull();
    expect(bacaJejakKeringanan(null)).toBeNull();
    expect(bacaJejakKeringanan({ keringanan: { ...jejak, persen: 0 } })).toBeNull();
    expect(bacaJejakKeringanan({ keringanan: { ...jejak, sebelum: [{ bearer: "X", amount: 1 }] } })?.sebelum).toEqual([]);
  });
});

describe("baris kurang", () => {
  it("opname: hanya yang dihitung lebih sedikit dari buku", () => {
    expect(
      kurangDariOpname([
        { itemId: "a", variantSku: "A-M", productName: "A M", qtySystem: 5, qtyCounted: 3 },
        { itemId: "b", variantSku: "", productName: "B", qtySystem: 2, qtyCounted: 4 },
        { itemId: "c", variantSku: "", productName: "C", qtySystem: -1, qtyCounted: 0 },
      ]),
    ).toEqual([{ itemId: "a", variantSku: "A-M", productName: "A M", qty: 2 }]);
  });
  it("penerimaan: tiba lebih sedikit dari dikirim (barang rusak tetap terhitung tiba)", () => {
    expect(
      kurangDariTerima([
        { itemId: null, variantSku: "", productName: "Ketik", qtySent: 4, qtyReceived: 1 },
        { itemId: "b", variantSku: "", productName: "B", qtySent: 3, qtyReceived: 3 },
      ]),
    ).toEqual([{ itemId: null, variantSku: "", productName: "Ketik", qty: 3 }]);
  });
});

describe("pengaturan, teks, tanggal, isian", () => {
  it("validasiAturanBarangHilang menuntut bentuk persis; persen keringanan lama diabaikan", () => {
    expect(validasiAturanBarangHilang({ dasarNilai: "HPP", maksPotongPersen: 30, dariOpname: false })).toEqual({
      dasarNilai: "HPP",
      maksPotongPersen: 30,
      dariOpname: false,
    });
    // Keringanan tidak punya persen bawaan lagi — pemilik mengetiknya per keputusan.
    expect(validasiAturanBarangHilang({ dasarNilai: "HARGA_TERIMA", maksPotongPersen: 30, dariOpname: false, diskonPegawaiPersen: 15 })).toEqual({
      dasarNilai: "HARGA_TERIMA",
      maksPotongPersen: 30,
      dariOpname: false,
    });
    expect(validasiAturanBarangHilang({ dasarNilai: "HPP", maksPotongPersen: 30.5, dariOpname: false })).toBeNull();
    expect(validasiAturanBarangHilang({ dasarNilai: "X", maksPotongPersen: 30, dariOpname: false })).toBeNull();
    expect(validasiAturanBarangHilang({ dasarNilai: "HPP", maksPotongPersen: 101, dariOpname: true })).toBeNull();
    expect(validasiAturanBarangHilang({ dasarNilai: "HPP", maksPotongPersen: 10 })).toBeNull();
  });

  it("bacaBarangHilang: bawaan harga toko terima; isian lama tetap terbaca; bolak-balik dengan validasi", () => {
    expect(BARANG_HILANG_BAWAAN).toEqual({ dasarNilai: "HARGA_TERIMA", maksPotongPersen: 50, dariOpname: true });
    expect(bacaBarangHilang(null)).toEqual(BARANG_HILANG_BAWAAN);
    expect(bacaBarangHilang("{rusak")).toEqual(BARANG_HILANG_BAWAAN);
    expect(bacaBarangHilang(JSON.stringify({ dasarNilai: "HARGA_ELORAE", maksPotongPersen: 30, dariOpname: false, diskonPegawaiPersen: 20 }))).toEqual({
      dasarNilai: "HARGA_ELORAE",
      maksPotongPersen: 30,
      dariOpname: false,
    });
    expect(bacaBarangHilang(JSON.stringify({ dasarNilai: "ANEH" }))).toMatchObject({ dasarNilai: "HARGA_TERIMA" });
    // Aksi simpan membandingkan JSON keduanya — urutan kunci harus sama.
    for (const isi of [
      { dasarNilai: "HARGA_TERIMA", maksPotongPersen: 50, dariOpname: true },
      { dasarNilai: "ECERAN", maksPotongPersen: 0, dariOpname: false },
    ]) {
      const v = validasiAturanBarangHilang(isi);
      expect(v).not.toBeNull();
      const teks = JSON.stringify(v);
      expect(JSON.stringify(bacaBarangHilang(teks))).toBe(teks);
    }
  });

  it("rapikanTeksHilang", () => {
    expect(rapikanTeksHilang("  a   b ", true)).toEqual({ ok: true, teks: "a b" });
    expect(rapikanTeksHilang(" ", true)).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(rapikanTeksHilang(undefined, false)).toEqual({ ok: true, teks: null });
    expect(rapikanTeksHilang("x".repeat(501), false)).toEqual({ ok: false, kode: "TEKS_TERLALU_PANJANG" });
  });

  it("umur dalam hari kalender WIB", () => {
    // 23.30 WIB tanggal 1 → 00.30 WIB tanggal 2: satu hari.
    expect(umurHari(new Date("2026-10-01T16:30:00Z"), new Date("2026-10-01T17:30:00Z"))).toBe(1);
    expect(umurHari(new Date("2026-10-01T01:00:00Z"), new Date("2026-10-01T16:00:00Z"))).toBe(0);
  });

  it("awal bulan berikut pukul 00.00 WIB", () => {
    expect(awalBulanBerikutWib(2026, 10).toISOString()).toBe("2026-10-31T17:00:00.000Z");
    expect(awalBulanBerikutWib(2026, 12).toISOString()).toBe("2026-12-31T17:00:00.000Z");
  });

  it("isian rupiah gaya Indonesia bolak-balik", () => {
    expect(bacaIsianRupiah("100.000")).toBe(100_000);
    expect(bacaIsianRupiah("33.333,33")).toBe(33_333.33);
    expect(bacaIsianRupiah("1500")).toBe(1500);
    expect(bacaIsianRupiah("1500,5")).toBe(1500.5);
    expect(bacaIsianRupiah("10.00")).toBeNull();
    expect(bacaIsianRupiah("1,234")).toBeNull();
    expect(bacaIsianRupiah("")).toBeNull();
    expect(tulisIsianRupiah(1_234_567)).toBe("1.234.567");
    expect(tulisIsianRupiah(33_333.3)).toBe("33.333,30");
    for (const n of [0, 5, 999, 1000, 33_333.33, 12_345_678.9]) expect(bacaIsianRupiah(tulisIsianRupiah(n))).toBe(n);
  });
});

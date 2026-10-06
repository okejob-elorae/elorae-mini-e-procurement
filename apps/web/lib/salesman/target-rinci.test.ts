import { describe, expect, it } from "vitest";
import {
  bagiSen,
  bulanBerikutnya,
  bulanSebelumnya,
  capaianUntuk,
  capaianUntukHp,
  dokumenSpg,
  kemajuanRinci,
  MAKS_BARIS_TARGET,
  periksaTargetRinci,
  rentangBulanWib,
  salinDariBulanLalu,
  samaIsiTarget,
  susunCapaianRinci,
  TANPA_KATEGORI,
  tanpaKonsiDiHp,
  totalUntukHp,
  type DokumenJual,
} from "./target-rinci";

const dikenal = { kategori: new Set(["katA", "katB"]), barang: new Set(["brgX", "brgY"]) };
const wib = (s: string) => new Date(`${s}+07:00`);

describe("bulan", () => {
  it("sebelum dan sesudah melintasi tahun", () => {
    expect(bulanSebelumnya("2026-01")).toBe("2025-12");
    expect(bulanSebelumnya("2026-10")).toBe("2026-09");
    expect(bulanBerikutnya("2026-12")).toBe("2027-01");
  });

  it("rentang bulan berjalan berhenti di akhir hari ini WIB — sama dengan kartu beranda", () => {
    const r = rentangBulanWib("2026-10", wib("2026-10-15T23:30:00"));
    expect(r).toEqual({ awal: wib("2026-10-01T00:00:00"), akhir: wib("2026-10-16T00:00:00") });
  });

  it("bulan lampau utuh; bulan depan kosong", () => {
    expect(rentangBulanWib("2026-09", wib("2026-10-15T08:00:00"))).toEqual({
      awal: wib("2026-09-01T00:00:00"),
      akhir: wib("2026-10-01T00:00:00"),
    });
    expect(rentangBulanWib("2026-11", wib("2026-10-15T08:00:00"))).toBeNull();
  });

  it("00.30 WIB tanggal 1 sudah bulan baru", () => {
    const r = rentangBulanWib("2026-10", new Date("2026-09-30T17:30:00Z"));
    expect(r).toEqual({ awal: wib("2026-10-01T00:00:00"), akhir: wib("2026-10-02T00:00:00") });
  });
});

describe("periksaTargetRinci", () => {
  it("menerima baris sah; NILAI dibulatkan ke rupiah", () => {
    const r = periksaTargetRinci(
      [
        { scope: "KATEGORI", refId: "katA", measure: "NILAI", value: 5_000_000.4 },
        { scope: "BARANG", refId: "brgX", measure: "PCS", value: 120 },
      ],
      dikenal,
    );
    expect(r).toEqual({
      ok: true,
      baris: [
        { scope: "KATEGORI", refId: "katA", measure: "NILAI", value: 5_000_000 },
        { scope: "BARANG", refId: "brgX", measure: "PCS", value: 120 },
      ],
    });
  });

  it("nilai harus lebih dari nol", () => {
    for (const value of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, "10", null, 0.4]) {
      expect(periksaTargetRinci([{ scope: "KATEGORI", refId: "katA", measure: "NILAI", value }], dikenal)).toEqual({
        ok: false,
        kode: "NILAI_TIDAK_SAH",
        indeks: 0,
      });
    }
  });

  it("PCS harus bilangan bulat", () => {
    expect(periksaTargetRinci([{ scope: "BARANG", refId: "brgX", measure: "PCS", value: 2.5 }], dikenal)).toEqual({
      ok: false,
      kode: "PCS_BUKAN_BULAT",
      indeks: 0,
    });
  });

  it("nilai melewati kolom Decimal(15,2) ditolak", () => {
    expect(
      periksaTargetRinci([{ scope: "KATEGORI", refId: "katA", measure: "NILAI", value: 1e13 }], dikenal),
    ).toMatchObject({ ok: false, kode: "NILAI_TIDAK_SAH" });
  });

  it("acuan harus kategori atau barang jadi yang dikenal — lingkupnya menentukan daftarnya", () => {
    expect(periksaTargetRinci([{ scope: "KATEGORI", refId: "brgX", measure: "NILAI", value: 1 }], dikenal)).toEqual({
      ok: false,
      kode: "ACUAN_TIDAK_DIKENAL",
      indeks: 0,
    });
    expect(periksaTargetRinci([{ scope: "BARANG", refId: "katA", measure: "PCS", value: 1 }], dikenal)).toEqual({
      ok: false,
      kode: "ACUAN_TIDAK_DIKENAL",
      indeks: 0,
    });
  });

  it("lingkup, ukuran, dan bentuk asing ditolak", () => {
    expect(periksaTargetRinci("x", dikenal)).toEqual({ ok: false, kode: "BENTUK_TIDAK_SAH" });
    expect(periksaTargetRinci([null], dikenal)).toEqual({ ok: false, kode: "BENTUK_TIDAK_SAH", indeks: 0 });
    expect(periksaTargetRinci([{ scope: "TOKO", refId: "katA", measure: "NILAI", value: 1 }], dikenal)).toEqual({
      ok: false,
      kode: "LINGKUP_TIDAK_DIKENAL",
      indeks: 0,
    });
    expect(periksaTargetRinci([{ scope: "KATEGORI", refId: "katA", measure: "KG", value: 1 }], dikenal)).toEqual({
      ok: false,
      kode: "UKURAN_TIDAK_DIKENAL",
      indeks: 0,
    });
  });

  it("satu acuan sekali saja per bulan", () => {
    expect(
      periksaTargetRinci(
        [
          { scope: "KATEGORI", refId: "katA", measure: "NILAI", value: 1 },
          { scope: "KATEGORI", refId: "katA", measure: "PCS", value: 2 },
        ],
        dikenal,
      ),
    ).toEqual({ ok: false, kode: "GANDA", indeks: 1 });
  });

  it(`paling banyak ${MAKS_BARIS_TARGET} baris per sales per bulan`, () => {
    const banyak = new Set(Array.from({ length: MAKS_BARIS_TARGET + 1 }, (_, i) => `b${i}`));
    const baris = [...banyak].map((refId) => ({ scope: "BARANG", refId, measure: "PCS", value: 1 }));
    expect(periksaTargetRinci(baris, { kategori: new Set(), barang: banyak })).toEqual({
      ok: false,
      kode: "TERLALU_BANYAK",
    });
    expect(periksaTargetRinci(baris.slice(0, MAKS_BARIS_TARGET), { kategori: new Set(), barang: banyak })).toMatchObject({
      ok: true,
    });
  });

  it("tanpa daftar dikenal: hanya bentuk yang diperiksa", () => {
    expect(periksaTargetRinci([{ scope: "BARANG", refId: "apa-saja", measure: "PCS", value: 3 }], null)).toMatchObject({
      ok: true,
    });
    expect(periksaTargetRinci([{ scope: "BARANG", refId: "", measure: "PCS", value: 3 }], null)).toEqual({
      ok: false,
      kode: "ACUAN_TIDAK_DIKENAL",
      indeks: 0,
    });
  });

  it("daftar kosong sah — artinya semua target bulan itu dihapus", () => {
    expect(periksaTargetRinci([], dikenal)).toEqual({ ok: true, baris: [] });
  });
});

describe("samaIsiTarget", () => {
  it("urutan tidak penting; ukuran atau nilai berbeda = berubah", () => {
    const a = [
      { scope: "KATEGORI" as const, refId: "katA", measure: "NILAI" as const, value: 10 },
      { scope: "BARANG" as const, refId: "brgX", measure: "PCS" as const, value: 3 },
    ];
    expect(samaIsiTarget(a, [...a].reverse())).toBe(true);
    expect(samaIsiTarget(a, [a[0], { ...a[1], value: 4 }])).toBe(false);
    expect(samaIsiTarget(a, [a[0], { ...a[1], measure: "NILAI" }])).toBe(false);
    expect(samaIsiTarget(a, [a[0]])).toBe(false);
  });
});

describe("salinDariBulanLalu", () => {
  it("menyalin apa adanya dan membuang acuan yang sudah tidak dikenal", () => {
    const r = salinDariBulanLalu(
      [
        { scope: "KATEGORI", refId: "katA", measure: "NILAI", value: 10 },
        { scope: "BARANG", refId: "brgHilang", measure: "PCS", value: 3 },
        { scope: "BARANG", refId: "brgY", measure: "PCS", value: 7 },
      ],
      dikenal,
    );
    expect(r).toEqual({
      baris: [
        { scope: "KATEGORI", refId: "katA", measure: "NILAI", value: 10 },
        { scope: "BARANG", refId: "brgY", measure: "PCS", value: 7 },
      ],
      dibuang: 1,
    });
  });
});

describe("kemajuanRinci", () => {
  it("bulan berjalan di depan laju: sesuai jalur, kurang dan per hari dihitung dari sisa hari termasuk hari ini", () => {
    // Tanggal 15: 14 dari 31 hari Oktober sudah lewat → harapan 14/31 dari 3.100 = 1.400.
    const k = kemajuanRinci(3_100, 1_600, "2026-10", wib("2026-10-15T10:00:00"));
    expect(k).toEqual({
      target: 3_100,
      capai: 1_600,
      persen: 52,
      kurang: 1_500,
      tercapai: false,
      harapan: 1_400,
      laju: "SESUAI",
      sisaHari: 17,
      perHari: 89,
    });
  });

  it("tanggal 1 pagi belum ada yang terjual: sesuai jalur, bukan tertinggal", () => {
    expect(kemajuanRinci(3_100, 0, "2026-10", wib("2026-10-01T08:00:00"))).toMatchObject({
      harapan: 0,
      laju: "SESUAI",
      sisaHari: 31,
      perHari: 100,
    });
  });

  it("di belakang laju: tertinggal", () => {
    expect(kemajuanRinci(3_100, 1_000, "2026-10", wib("2026-10-15T10:00:00"))).toMatchObject({
      laju: "TERTINGGAL",
      kurang: 2_100,
    });
  });

  it("tercapai: kurang nol, tanpa per hari", () => {
    expect(kemajuanRinci(100, 130, "2026-10", wib("2026-10-15T10:00:00"))).toMatchObject({
      persen: 130,
      kurang: 0,
      tercapai: true,
      laju: "TERCAPAI",
      perHari: null,
    });
  });

  it("bulan lampau yang tidak tercapai sudah selesai, tidak ada sisa hari", () => {
    expect(kemajuanRinci(100, 40, "2026-09", wib("2026-10-15T10:00:00"))).toMatchObject({
      laju: "TIDAK_TERCAPAI",
      sisaHari: 0,
      perHari: null,
      harapan: 100,
    });
  });

  it("bulan depan belum mulai", () => {
    expect(kemajuanRinci(100, 0, "2026-11", wib("2026-10-15T10:00:00"))).toMatchObject({
      laju: "BELUM_MULAI",
      harapan: 0,
      sisaHari: 30,
      perHari: 4,
    });
  });
});

describe("bagiSen", () => {
  it("jumlahnya selalu tepat sama dengan totalnya", () => {
    const hasil = bagiSen(1_000, [1, 1, 1]);
    expect(hasil.reduce((a, b) => a + b, 0)).toBe(1_000);
    expect(hasil).toEqual([334, 333, 333]);
  });

  it("sebanding dengan bobotnya", () => {
    expect(bagiSen(900, [200, 100])).toEqual([600, 300]);
  });

  it("bobot nol semua: dibagi rata; total negatif tetap tepat", () => {
    expect(bagiSen(10, [0, 0])).toEqual([5, 5]);
    const neg = bagiSen(-7, [1, 2]);
    expect(neg.reduce((a, b) => a + b, 0)).toBe(-7);
  });

  it("bobot negatif dianggap nol", () => {
    expect(bagiSen(100, [-50, 100])).toEqual([0, 100]);
  });

  it("tanpa baris: tidak ada yang dibagi", () => {
    expect(bagiSen(500, [])).toEqual([]);
  });
});

describe("susunCapaianRinci", () => {
  const kategoriBarang = new Map<string, string | null>([
    ["i1", "katA"],
    ["i2", "katB"],
    ["i3", null],
  ]);

  it("total = jumlah dokumen; jumlah per kategori = total, termasuk yang tanpa kategori dan dokumen tanpa baris", () => {
    const dok: DokumenJual[] = [
      // Diskon membuat total < jumlah baris: dibagi sebanding nilai bersih baris.
      {
        jenis: "putus",
        totalSen: 90_000,
        baris: [
          { itemId: "i1", qty: 2, bobotSen: 60_000, bonus: false },
          { itemId: "i2", qty: 1, bobotSen: 40_000, bonus: false },
          // Baris bonus: gratis — tidak menambah nilai, tidak dihitung pcs.
          { itemId: "i1", qty: 1, bobotSen: 0, bonus: true },
        ],
      },
      { jenis: "konsi", totalSen: 30_000, baris: [{ itemId: "i3", qty: 5, bobotSen: 30_000, bonus: false }] },
      { jenis: "van", totalSen: 12_345, baris: [] },
    ];
    const c = susunCapaianRinci(dok, kategoriBarang);
    expect(c.total).toBe(1_323.45);
    expect(c.kanal).toEqual({ putus: 900, konsi: 300, van: 123.45, spg: 0 });
    expect(c.kategori).toEqual({
      katA: { nilai: 540, pcs: 2 },
      katB: { nilai: 360, pcs: 1 },
      [TANPA_KATEGORI]: { nilai: 423.45, pcs: 5 },
    });
    expect(c.barang).toEqual({
      i1: { nilai: 540, pcs: 2 },
      i2: { nilai: 360, pcs: 1 },
      i3: { nilai: 300, pcs: 5 },
    });
    const jumlah = Object.values(c.kategori).reduce((n, x) => n + Math.round(x.nilai * 100), 0);
    expect(jumlah).toBe(Math.round(c.total * 100));
  });

  it("barang yang tidak dikenal kategorinya masuk tanpa kategori", () => {
    const c = susunCapaianRinci(
      [{ jenis: "van", totalSen: 100, baris: [{ itemId: "asing", qty: 1, bobotSen: 100, bonus: false }] }],
      kategoriBarang,
    );
    expect(c.kategori).toEqual({ [TANPA_KATEGORI]: { nilai: 1, pcs: 1 } });
  });

  it("capaianUntuk membaca ukuran target dari kategori atau barang; yang belum terjual = 0", () => {
    const c = susunCapaianRinci(
      [{ jenis: "putus", totalSen: 50_000, baris: [{ itemId: "i1", qty: 4, bobotSen: 50_000, bonus: false }] }],
      kategoriBarang,
    );
    expect(capaianUntuk(c, { scope: "KATEGORI", refId: "katA", measure: "NILAI" })).toBe(500);
    expect(capaianUntuk(c, { scope: "BARANG", refId: "i1", measure: "PCS" })).toBe(4);
    expect(capaianUntuk(c, { scope: "BARANG", refId: "i2", measure: "PCS" })).toBe(0);
  });
});

/*
 * Aplikasi salesman tidak pernah menampilkan harga konsinyasi. Target BARANG
 * dalam rupiah membocorkannya: nilai konsi satu barang ÷ pcs yang ia kirim =
 * harga satuan konsi. Di HP nilainya dihitung tanpa konsinyasi.
 */
describe("capaianUntukHp — target barang dalam rupiah tanpa konsinyasi", () => {
  const kategoriBarang = new Map<string, string | null>([["i1", "katA"]]);
  const dok: DokumenJual[] = [
    { jenis: "putus", totalSen: 50_000, baris: [{ itemId: "i1", qty: 2, bobotSen: 50_000, bonus: false }] },
    { jenis: "konsi", totalSen: 30_000, baris: [{ itemId: "i1", qty: 3, bobotSen: 30_000, bonus: false }] },
    { jenis: "van", totalSen: 10_000, baris: [{ itemId: "i1", qty: 1, bobotSen: 10_000, bonus: false }] },
  ];
  const c = susunCapaianRinci(dok, kategoriBarang);

  it("mencatat bagian konsinyasi per barang terpisah", () => {
    expect(c.barang.i1).toEqual({ nilai: 900, pcs: 6 });
    expect(c.barangKonsi.i1).toEqual({ nilai: 300, pcs: 3 });
  });

  it("barang + NILAI di HP = putus + van saja; kantor tetap melihat semuanya", () => {
    const t = { scope: "BARANG" as const, refId: "i1", measure: "NILAI" as const };
    expect(capaianUntukHp(c, t)).toBe(600);
    expect(capaianUntuk(c, t)).toBe(900);
  });

  it("pcs tidak berubah di HP — jumlah barang tidak memuat harga", () => {
    expect(capaianUntukHp(c, { scope: "BARANG", refId: "i1", measure: "PCS" })).toBe(6);
    expect(capaianUntukHp(c, { scope: "KATEGORI", refId: "katA", measure: "PCS" })).toBe(6);
  });

  it("kategori + NILAI di HP juga putus + van saja; kantor tetap melihat semuanya", () => {
    // Nilai gabungan kategori − putus − van kategori itu = konsi kategori itu.
    expect(c.kategoriKonsi.katA).toEqual({ nilai: 300, pcs: 3 });
    const t = { scope: "KATEGORI" as const, refId: "katA", measure: "NILAI" as const };
    expect(capaianUntukHp(c, t)).toBe(600);
    expect(capaianUntuk(c, t)).toBe(900);
  });

  it("setiap target dalam rupiah ditandai 'tanpa konsinyasi' di HP; target pcs tidak", () => {
    expect(tanpaKonsiDiHp({ scope: "BARANG", measure: "NILAI" })).toBe(true);
    expect(tanpaKonsiDiHp({ scope: "KATEGORI", measure: "NILAI" })).toBe(true);
    expect(tanpaKonsiDiHp({ scope: "BARANG", measure: "PCS" })).toBe(false);
    expect(tanpaKonsiDiHp({ scope: "KATEGORI", measure: "PCS" })).toBe(false);
  });

  it("dokumen konsi tanpa baris masuk 'tanpa kategori' — di HP nilainya juga dibuang", () => {
    const tanpaBaris = susunCapaianRinci([...dok, { jenis: "konsi", totalSen: 77_700, baris: [] }], kategoriBarang);
    expect(tanpaBaris.kategoriKonsi[TANPA_KATEGORI]).toEqual({ nilai: 777, pcs: 0 });
    expect(capaianUntukHp(tanpaBaris, { scope: "KATEGORI", refId: TANPA_KATEGORI, measure: "NILAI" })).toBe(0);
  });

  it("total di HP = putus + van (+ SPG), tanpa konsinyasi", () => {
    expect(c.total).toBe(900);
    expect(totalUntukHp(c)).toBe(600);
    const pecahan = susunCapaianRinci(
      [
        { jenis: "putus", totalSen: 1_001, baris: [] },
        { jenis: "van", totalSen: 2_002, baris: [] },
        { jenis: "konsi", totalSen: 4_123_700, baris: [] },
      ],
      kategoriBarang,
    );
    expect(totalUntukHp(pecahan)).toBe(30.03);
    const spg = susunCapaianRinci([{ jenis: "spg", totalSen: 5_000_000, baris: [] }], kategoriBarang);
    expect(totalUntukHp(spg)).toBe(50_000);
  });

  it("barang yang hanya terjual lewat konsinyasi bernilai 0 di HP, bukan nilai konsinya", () => {
    const hanyaKonsi = susunCapaianRinci([dok[1]], kategoriBarang);
    expect(capaianUntukHp(hanyaKonsi, { scope: "BARANG", refId: "i1", measure: "NILAI" })).toBe(0);
  });
});

describe("penjualan SPG (bersih dari retur pembeli)", () => {
  const kategoriBarang = new Map<string, string | null>([
    ["i1", "katA"],
    ["i2", "katB"],
  ]);

  it("nota tanpa retur: nilai dan pcs apa adanya", () => {
    const d = dokumenSpg({
      total: 150_000,
      lines: [
        { itemId: "i1", qty: 2, lineTotal: 100_000, returnedQty: 0 },
        { itemId: "i2", qty: 1, lineTotal: 50_000, returnedQty: 0 },
      ],
    });
    expect(d).toEqual({
      jenis: "spg",
      totalSen: 15_000_000,
      baris: [
        { itemId: "i1", qty: 2, bobotSen: 10_000_000, bonus: false },
        { itemId: "i2", qty: 1, bobotSen: 5_000_000, bonus: false },
      ],
    });
  });

  it("retur pembeli mengurangi pcs dan nilai baris itu sebesar harga satuannya", () => {
    const d = dokumenSpg({
      total: 150_000,
      lines: [
        { itemId: "i1", qty: 2, lineTotal: 100_000, returnedQty: 1 },
        { itemId: "i2", qty: 1, lineTotal: 50_000, returnedQty: 1 },
      ],
    });
    expect(d.totalSen).toBe(5_000_000);
    expect(d.baris).toEqual([
      { itemId: "i1", qty: 1, bobotSen: 5_000_000, bonus: false },
      { itemId: "i2", qty: 0, bobotSen: 0, bonus: false },
    ]);
    const c = susunCapaianRinci([d], kategoriBarang);
    expect(c.total).toBe(50_000);
    expect(c.kanal.spg).toBe(50_000);
    expect(c.kategori).toEqual({ katA: { nilai: 50_000, pcs: 1 } });
    expect(c.barang).toEqual({ i1: { nilai: 50_000, pcs: 1 } });
    expect(c.barangKonsi).toEqual({});
    expect(c.kategoriKonsi).toEqual({});
  });

  it("retur seluruhnya: nota bernilai nol, tidak ada kategori yang tersisa; retur melebihi qty dibatasi", () => {
    const d = dokumenSpg({ total: 30_000, lines: [{ itemId: "i1", qty: 3, lineTotal: 30_000, returnedQty: 5 }] });
    expect(d).toEqual({ jenis: "spg", totalSen: 0, baris: [{ itemId: "i1", qty: 0, bobotSen: 0, bonus: false }] });
    const c = susunCapaianRinci([d], kategoriBarang);
    expect(c.total).toBe(0);
    expect(c.kategori).toEqual({});
  });

  it("harga pecahan: sisa sen tidak hilang — total = jumlah baris bersih", () => {
    const d = dokumenSpg({ total: 100.01, lines: [{ itemId: "i1", qty: 3, lineTotal: 100.01, returnedQty: 1 }] });
    // 10.001 sen × 1/3 = 3.333,67 → 3.334 sen dikembalikan.
    expect(d.totalSen).toBe(6_667);
    expect(d.baris[0]).toMatchObject({ qty: 2, bobotSen: 6_667 });
  });
});

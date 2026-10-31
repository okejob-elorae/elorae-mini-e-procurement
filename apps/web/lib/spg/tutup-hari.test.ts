import { describe, expect, it } from "vitest";
import { tabAktifSpg, tampilkanMenuSpg } from "@/lib/pwa/menu-spg";
import { TUTUP_HARI_BAWAAN } from "./pengaturan";
import {
  adaSelisih,
  bacaFotoLaporan,
  batasHariWib,
  hargaBersihPotong,
  hariSah,
  hariTutupSah,
  hitungAngkaPenjualan,
  konversiPersen,
  labelHariTutup,
  MAKS_FOTO_TUTUP,
  pesanTutupHariWa,
  periksaIsianTutupHari,
  perubahanLaporan,
  ringkasanUntukHp,
  selisihKasir,
  susunRingkasanTutupHari,
  tautanWaTutup,
  terlarisHari,
  type BahanTutupHari,
  type NotaTutup,
} from "./tutup-hari";

const nota = (salesmanId: string, total: number, baris: [string, string, number][], diskon = 0): NotaTutup => ({
  salesmanId,
  subtotal: total + diskon,
  discountTotal: diskon,
  total,
  baris: baris.map(([itemId, nama, qty]) => ({ itemId, variantSku: "", productName: nama, qty })),
});

describe("batas hari WIB", () => {
  it("covers exactly the WIB calendar day", () => {
    const { awal, akhir } = batasHariWib("2026-10-03");
    expect(awal.toISOString()).toBe("2026-10-02T17:00:00.000Z");
    expect(akhir.toISOString()).toBe("2026-10-03T17:00:00.000Z");
  });

  it("allows only today and yesterday in WIB", () => {
    // 2026-10-03 01:00 WIB = 2026-10-02 18:00 UTC: hari WIB sudah tanggal 3.
    const sekarang = new Date("2026-10-02T18:00:00Z");
    expect(hariTutupSah("2026-10-03", sekarang)).toBe(true);
    expect(hariTutupSah("2026-10-02", sekarang)).toBe(true);
    expect(hariTutupSah("2026-10-01", sekarang)).toBe(false);
    expect(hariTutupSah("2026-10-04", sekarang)).toBe(false);
    expect(hariTutupSah("3-10-2026", sekarang)).toBe(false);
    expect(hariTutupSah(null, sekarang)).toBe(false);
  });

  it("rejects calendar days that do not exist", () => {
    expect(hariSah("2026-02-29")).toBe(false);
    expect(hariSah("2028-02-29")).toBe(true);
    expect(hariSah("2026-1-01")).toBe(false);
  });

  it("labels the day in Indonesian with its weekday", () => {
    expect(labelHariTutup("2026-10-03")).toBe("Sabtu, 3 Okt 2026");
  });
});

describe("hitungAngkaPenjualan", () => {
  it("nets returns at the per-piece NET price of their sale line, not the list price", () => {
    const a = hitungAngkaPenjualan(
      [
        { subtotal: 200_000, discountTotal: 40_000, total: 160_000, potong: 2 },
        { subtotal: 100_000, discountTotal: 0, total: 100_000, potong: 1 },
      ],
      // 1 potong dari baris 2 × Rp 100.000 yang sesudah promo bernilai Rp 160.000.
      [{ qty: 1, saleLine: { qty: 2, lineTotal: 160_000, unitPrice: 100_000 } }],
    );
    expect(a).toEqual({
      nota: 2,
      potong: 3,
      potongKembali: 1,
      nilaiKotor: 300_000,
      potongan: 40_000,
      nilaiNota: 260_000,
      nilaiRetur: 80_000,
      nilaiBersih: 180_000,
    });
  });

  it("falls back to the list price for old lines without a usable line total", () => {
    expect(hargaBersihPotong({ qty: 0, lineTotal: 0, unitPrice: 50_000 })).toBe(50_000);
    expect(hargaBersihPotong({ qty: 3, lineTotal: null, unitPrice: 50_000 })).toBe(50_000);
  });

  it("can go negative on a day with only a shopper return — money left the till", () => {
    const a = hitungAngkaPenjualan([], [{ qty: 1, saleLine: { qty: 1, lineTotal: 75_000, unitPrice: 75_000 } }]);
    expect(a.nilaiBersih).toBe(-75_000);
    expect(a.nota).toBe(0);
  });

  it("keeps cents and never produces -0", () => {
    const a = hitungAngkaPenjualan([{ subtotal: 0.1, discountTotal: 0, total: 0.1, potong: 1 }], [
      { qty: 1, saleLine: { qty: 1, lineTotal: 0.1, unitPrice: 0.1 } },
    ]);
    expect(Object.is(a.nilaiBersih, -0)).toBe(false);
    expect(a.nilaiBersih).toBe(0);
  });
});

describe("terlarisHari", () => {
  it("sums by variant, keeps the latest name, ranks by pieces and caps at five", () => {
    const n = [
      nota("a", 1, [
        ["i1", "Kaos — M", 2],
        ["i2", "Celana", 1],
      ]),
      nota("b", 1, [
        ["i1", "Kaos Polos — M", 1],
        ["i3", "Topi", 1],
        ["i4", "Tas", 1],
        ["i5", "Sabuk", 1],
        ["i6", "Dompet", 1],
      ]),
    ];
    const t = terlarisHari(n);
    expect(t).toHaveLength(5);
    expect(t[0]).toEqual({ itemId: "i1", variantSku: "", nama: "Kaos Polos — M", qty: 3 });
    // Seri diurutkan nama supaya urutannya tidak berubah-ubah.
    expect(t.slice(1).map((x) => x.nama)).toEqual(["Celana", "Dompet", "Sabuk", "Tas"]);
  });
});

describe("susunRingkasanTutupHari", () => {
  const bahan: BahanTutupHari = {
    storeId: "s1",
    namaToko: "Toko Uji",
    day: "2026-10-03",
    nota: [nota("spg1", 150_000, [["i1", "Kaos — M", 2]], 10_000), nota("spg2", 90_000, [["i2", "Topi", 1]]), nota("lama", 50_000, [["i3", "Tas", 1]])],
    retur: [],
    kiriman: [{ docNo: "DLV/1", sourceType: "PUTUS_DELIVERY", waktu: "2026-10-03T03:00:00.000Z", diterima: 10, rusak: 1, penerima: "Ani" }],
    dicari: [{ description: "Kaos XL", qty: 2 }],
    spg: [
      { id: "spg1", nama: "Ani" },
      { id: "spg2", nama: "Budi" },
      { id: "spg3", nama: "Citra" },
    ],
    namaPengguna: { lama: "Dewi" },
  };

  it("covers every SPG of the store, including one who sold nothing and one since moved away", () => {
    const r = susunRingkasanTutupHari(bahan);
    expect(r.nota).toBe(3);
    expect(r.potong).toBe(4);
    expect(r.nilaiBersih).toBe(290_000);
    expect(r.potongan).toBe(10_000);
    expect(r.perSpg).toEqual([
      { userId: "spg1", nama: "Ani", nota: 1, potong: 2, nilai: 150_000 },
      { userId: "spg2", nama: "Budi", nota: 1, potong: 1, nilai: 90_000 },
      { userId: "lama", nama: "Dewi", nota: 1, potong: 1, nilai: 50_000 },
      { userId: "spg3", nama: "Citra", nota: 0, potong: 0, nilai: 0 },
    ]);
    expect(r.kiriman).toHaveLength(1);
    expect(r.dicari).toEqual([{ description: "Kaos XL", qty: 2 }]);
  });

  it("never sends a colleague's rupiah to the phone — only one's own", () => {
    const hp = ringkasanUntukHp(susunRingkasanTutupHari(bahan), "spg2");
    const json = JSON.stringify(hp);
    expect(json).not.toContain("150000");
    expect(json).not.toContain("50000,");
    expect(hp.perSpg.find((x) => x.userId === "spg1")).toEqual({ userId: "spg1", nama: "Ani", nota: 1, potong: 2, nilai: null, saya: false });
    expect(hp.perSpg.find((x) => x.userId === "spg2")?.nilai).toBe(90_000);
    // Angka toko sendiri tetap ada: itulah yang dicocokkan dengan kasir.
    expect(hp.nilaiBersih).toBe(290_000);
  });
});

describe("periksaIsianTutupHari", () => {
  const foto = (id: string) => `/api/foto/${id}`;

  it("accepts an empty report under the default rules", () => {
    expect(periksaIsianTutupHari({}, TUTUP_HARI_BAWAAN)).toEqual({
      ok: true,
      nilai: { pengunjung: null, totalKasir: null, catatan: null, foto: [] },
    });
  });

  it("validates visitors and the cashier total", () => {
    expect(periksaIsianTutupHari({ pengunjung: 1.5 }, TUTUP_HARI_BAWAAN)).toEqual({ ok: false, kode: "PENGUNJUNG_TIDAK_SAH" });
    expect(periksaIsianTutupHari({ pengunjung: -1 }, TUTUP_HARI_BAWAAN)).toEqual({ ok: false, kode: "PENGUNJUNG_TIDAK_SAH" });
    expect(periksaIsianTutupHari({ pengunjung: "40" }, TUTUP_HARI_BAWAAN)).toEqual({ ok: false, kode: "PENGUNJUNG_TIDAK_SAH" });
    expect(periksaIsianTutupHari({ totalKasir: -5 }, TUTUP_HARI_BAWAAN)).toEqual({ ok: false, kode: "KASIR_TIDAK_SAH" });
    expect(periksaIsianTutupHari({ totalKasir: Number.NaN }, TUTUP_HARI_BAWAAN)).toEqual({ ok: false, kode: "KASIR_TIDAK_SAH" });
    const ok = periksaIsianTutupHari({ pengunjung: 40, totalKasir: 1_250_000.456, catatan: "  hujan  " }, TUTUP_HARI_BAWAAN);
    expect(ok).toEqual({ ok: true, nilai: { pengunjung: 40, totalKasir: 1_250_000.46, catatan: "hujan", foto: [] } });
  });

  it("drops fields the settings no longer ask for instead of refusing the phone", () => {
    const r = periksaIsianTutupHari(
      { pengunjung: 40, totalKasir: 100 },
      { tanyaPengunjung: false, tanyaTotalKasir: false, wajibFoto: false },
    );
    expect(r).toEqual({ ok: true, nilai: { pengunjung: null, totalKasir: null, catatan: null, foto: [] } });
  });

  it("only takes photos from our own photo store, deduplicated and capped", () => {
    expect(periksaIsianTutupHari({ foto: ["https://contoh.com/a.jpg"] }, TUTUP_HARI_BAWAAN)).toEqual({ ok: false, kode: "FOTO_TIDAK_SAH" });
    expect(periksaIsianTutupHari({ foto: "/api/foto/a" }, TUTUP_HARI_BAWAAN)).toEqual({ ok: false, kode: "FOTO_TIDAK_SAH" });
    const banyak = Array.from({ length: MAKS_FOTO_TUTUP + 1 }, (_, i) => foto(`f${i}`));
    expect(periksaIsianTutupHari({ foto: banyak }, TUTUP_HARI_BAWAAN)).toEqual({ ok: false, kode: "FOTO_TERLALU_BANYAK" });
    const r = periksaIsianTutupHari({ foto: [foto("a"), foto("a"), foto("b")] }, TUTUP_HARI_BAWAAN);
    expect(r.ok && r.nilai.foto).toEqual([foto("a"), foto("b")]);
  });

  it("requires a photo when the office says so", () => {
    const aturan = { ...TUTUP_HARI_BAWAAN, wajibFoto: true };
    expect(periksaIsianTutupHari({}, aturan)).toEqual({ ok: false, kode: "FOTO_WAJIB" });
    expect(periksaIsianTutupHari({ foto: [foto("x")] }, aturan).ok).toBe(true);
  });

  it("refuses an overly long note", () => {
    expect(periksaIsianTutupHari({ catatan: "x".repeat(1001) }, TUTUP_HARI_BAWAAN)).toEqual({ ok: false, kode: "CATATAN_TERLALU_PANJANG" });
  });

  it("reads stored photo lists defensively", () => {
    expect(bacaFotoLaporan(["/api/foto/a", "x", 3, null])).toEqual(["/api/foto/a"]);
    expect(bacaFotoLaporan(null)).toEqual([]);
  });
});

describe("selisih & konversi", () => {
  it("measures the cashier against the system net value", () => {
    expect(selisihKasir(null, 100)).toBeNull();
    expect(selisihKasir(950_000, 1_000_000)).toBe(-50_000);
    expect(adaSelisih(selisihKasir(950_000, 1_000_000))).toBe(true);
    expect(adaSelisih(selisihKasir(1_000_000.2, 1_000_000))).toBe(false);
    expect(adaSelisih(null)).toBe(false);
  });

  it("gives conversion as a percentage with one decimal", () => {
    expect(konversiPersen(12, 40)).toBe(30);
    expect(konversiPersen(1, 3)).toBe(33.3);
    expect(konversiPersen(5, 0)).toBeNull();
    expect(konversiPersen(5, null)).toBeNull();
  });
});

describe("pesanTutupHariWa", () => {
  const dasar = {
    namaToko: "Toko Sinar",
    day: "2026-10-03",
    nota: 12,
    potong: 18,
    potongKembali: 1,
    nilaiBersih: 2_150_000,
    potongan: 150_000,
    terlaris: [
      { nama: "Kaos — M", qty: 4 },
      { nama: "Topi", qty: 2 },
    ],
    pengunjung: 40,
    totalKasir: 2_100_000,
    catatan: "Hujan sore, sepi.",
  };

  it("writes the whole report in Indonesian", () => {
    const teks = pesanTutupHariWa(dasar);
    expect(teks).toBe(
      [
        "*Laporan tutup hari — Toko Sinar*",
        "Sabtu, 3 Okt 2026",
        "",
        "Nota: 12",
        "Terjual: 18 pcs",
        "Dikembalikan pembeli: 1 pcs",
        "Penjualan bersih: Rp 2.150.000",
        "Potongan & diskon: Rp 150.000",
        "",
        "Terlaris:",
        "1. Kaos — M (4 pcs)",
        "2. Topi (2 pcs)",
        "",
        "Pengunjung: 40 (konversi 30%)",
        "Total kasir toko: Rp 2.100.000",
        "Selisih dengan sistem: -Rp 50.000",
        "",
        "Kendala hari ini: Hujan sore, sepi.",
      ].join("\n"),
    );
  });

  it("says the cashier matches when it does, and leaves out empty parts", () => {
    const teks = pesanTutupHariWa({ ...dasar, potongKembali: 0, totalKasir: 2_150_000, pengunjung: null, catatan: null, terlaris: [] });
    expect(teks).toContain("Sesuai dengan sistem");
    expect(teks).not.toContain("Dikembalikan");
    expect(teks).not.toContain("Pengunjung");
    expect(teks).not.toContain("Terlaris");
    expect(teks).not.toContain("Kendala");
  });

  it("carries no shopper phone number or per-SPG money", () => {
    const teks = pesanTutupHariWa(dasar);
    expect(teks).not.toMatch(/(\+62|\b62|\b0)8\d{6,}/);
    expect(teks).not.toMatch(/SPG/i);
  });

  it("opens WhatsApp with the text and no number", () => {
    expect(tautanWaTutup("Halo & selamat")).toBe("https://wa.me/?text=Halo%20%26%20selamat");
  });
});

describe("layar tutup hari di HP", () => {
  it("hides the bottom menu (the form has its own sticky submit bar) and lights the Lainnya tab", () => {
    expect(tampilkanMenuSpg("/pwa/spg/tutup")).toBe(false);
    expect(tabAktifSpg("/pwa/spg/tutup")).toBe("lainnya");
  });
});

describe("perubahanLaporan", () => {
  const dasar = {
    closedById: "a",
    notaCount: 3,
    pcs: 4,
    returnPcs: 0,
    grossTotal: 100,
    discountTotal: 0,
    netTotal: 100,
    visitorCount: 40,
    cashierTotal: 100,
    note: "Hujan",
    photoUrls: ["/api/foto/a"],
  };

  it("lists only what changed, photos as counts", () => {
    expect(
      perubahanLaporan(dasar, { ...dasar, closedById: "b", visitorCount: 45, note: null, photoUrls: ["/api/foto/a", "/api/foto/b"] }),
    ).toEqual([
      { kolom: "visitorCount", sebelum: 40, sesudah: 45 },
      { kolom: "note", sebelum: "Hujan", sesudah: null },
      { kolom: "photoUrls", sebelum: 1, sesudah: 2 },
    ]);
  });

  it("has nothing to say about the first submission", () => {
    expect(perubahanLaporan(null, dasar)).toEqual([]);
  });

  it("notices a swapped photo even when the count is the same", () => {
    expect(perubahanLaporan(dasar, { ...dasar, photoUrls: ["/api/foto/z"] })).toEqual([{ kolom: "photoUrls", sebelum: 1, sesudah: 1 }]);
  });
});

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { kalenderKerja } from "@/lib/production/hari-kerja";
import type { SumberLeadTime } from "@/lib/production/jadwal-queries";
import {
  alasanTidakBisaBuatWo,
  angkaTampil,
  bacaDurasi,
  bolehGanti,
  bolehWoBaru,
  centangLangkah,
  geserPemasok,
  hapusPemasok,
  hariLangkahUntukQty,
  peringatanJadwal,
  hariTerlambat,
  isianAwalTarik,
  kalenderDariData,
  keadaanKebutuhan,
  labelPendek,
  labelTahapRuang,
  langkahTerpilih,
  namaBulanTahun,
  pesanWaLangkah,
  pratinjauMulai,
  pratinjauPindah,
  pratinjauStatus,
  pratinjauTarik,
  statusUsulan,
  tambahPemasok,
  tautanWaDenganPesan,
} from "./ruang-kerja";

// 2026-10-05 = Senin, 2026-10-30 = Jumat.
const kal = kalenderKerja([1, 2, 3, 4, 5], []);

const sumber: SumberLeadTime[] = [
  {
    supplierId: "kain",
    supplierName: "Pabrik Kain",
    jenis: "Kain",
    langkah: [
      { sequence: 1, name: "Rajut", type: "FIXED", days: 3, rateQty: null, hariUntukQty: 3 },
      { sequence: 2, name: "Celup", type: "FIXED", days: 2, rateQty: null, hariUntukQty: 2 },
    ],
  },
  {
    supplierId: "jahit",
    supplierName: "CMT Maju",
    jenis: "CMT",
    langkah: [
      { sequence: 10, name: "Potong", type: "FIXED", days: 1, rateQty: null, hariUntukQty: 1 },
      { sequence: 20, name: "Jahit", type: "PER_QTY", days: 7, rateQty: 10_000, hariUntukQty: 9 },
    ],
  },
];

type Lama = Parameters<typeof pratinjauTarik>[0]["langkahLama"][number];
const lama = (id: string, durationDays: number, status: Lama["status"] = "BELUM", doneDate: string | null = null): Lama => ({
  id,
  name: `Langkah ${id}`,
  durationDays,
  status,
  doneDate,
  pemasok: null,
});

const dasar = {
  langkahLama: [] as Lama[],
  scheduleStart: null as string | null,
  deadline: null as string | null,
  targetQty: 12_000,
  sumber,
  mode: "MAJU" as const,
  tanggal: "2026-10-05",
  cara: "TAMBAH" as const,
  kal,
};

describe("pilihan pemasok", () => {
  it("tambah di akhir dengan semua langkah tercentang, tanpa menggandakan", () => {
    let p = tambahPemasok([], sumber, "jahit");
    p = tambahPemasok(p, sumber, "kain");
    p = tambahPemasok(p, sumber, "jahit");
    expect(p).toEqual([
      { supplierId: "jahit", sequences: [10, 20] },
      { supplierId: "kain", sequences: [1, 2] },
    ]);
    expect(tambahPemasok(p, sumber, "tidak-ada")).toEqual(p);
  });

  it("geser dan hapus menjaga urutan; di ujung tidak berubah", () => {
    const p = [
      { supplierId: "kain", sequences: [1] },
      { supplierId: "jahit", sequences: [10] },
    ];
    expect(geserPemasok(p, "jahit", -1).map((x) => x.supplierId)).toEqual(["jahit", "kain"]);
    expect(geserPemasok(p, "kain", -1)).toEqual(p);
    expect(geserPemasok(p, "jahit", 1)).toEqual(p);
    expect(hapusPemasok(p, "kain")).toEqual([{ supplierId: "jahit", sequences: [10] }]);
  });

  it("langkah keluar menurut urutan pemasok yang dipilih, lalu urutan rantai — bukan urutan dicentang", () => {
    let p = tambahPemasok([], sumber, "kain");
    p = tambahPemasok(p, sumber, "jahit");
    p = centangLangkah(p, "kain", 1, false);
    p = centangLangkah(p, "jahit", 10, false);
    p = centangLangkah(p, "jahit", 10, true); // dicentang lagi → tetap sebelum "Jahit"
    expect(langkahTerpilih(p, sumber)).toEqual([
      { supplierId: "kain", sequence: 2 },
      { supplierId: "jahit", sequence: 10 },
      { supplierId: "jahit", sequence: 20 },
    ]);
    expect(langkahTerpilih([{ supplierId: "hilang", sequences: [1] }], sumber)).toEqual([]);
  });

  it("lama langkah sebanding qty, sama dengan computeStepDays penulis", () => {
    const jahit = sumber[1].langkah[1];
    expect(hariLangkahUntukQty(jahit, 12_000)).toBe(9);
    expect(hariLangkahUntukQty(jahit, 5_000)).toBe(4);
    expect(hariLangkahUntukQty(jahit, 0)).toBe(7);
    expect(hariLangkahUntukQty(sumber[0].langkah[0], 50_000)).toBe(3);
  });
});

describe("isianAwalTarik", () => {
  const data = {
    tahap: { deadline: null, scheduleStart: null, penjahit: { id: "jahit", name: "CMT Maju" } },
    langkah: [],
    sumberLeadTime: sumber,
    hariIni: "2026-10-07",
  } as unknown as Parameters<typeof isianAwalTarik>[0];

  it("jadwal kosong: maju dari hari ini, penjahit tahap langsung terpilih", () => {
    expect(isianAwalTarik(data)).toEqual({
      mode: "MAJU",
      tanggal: "2026-10-07",
      cara: "TAMBAH",
      pilihan: [{ supplierId: "jahit", sequences: [10, 20] }],
    });
  });

  it("tahap bertenggat disusun mundur dari tenggatnya; jadwal berisi tidak memilih apa pun", () => {
    const berisi = {
      ...data,
      tahap: { ...data.tahap, deadline: "2026-11-30", scheduleStart: "2026-10-01" },
      langkah: [lama("a", 1)],
    } as unknown as Parameters<typeof isianAwalTarik>[0];
    expect(isianAwalTarik(berisi)).toMatchObject({ mode: "MUNDUR", tanggal: "2026-11-30", pilihan: [] });
  });
});

describe("pratinjauTarik — mengikuti tarikJadwalDariLeadTime", () => {
  it("maju dari tanggal mulai, hari kerja Senin–Jumat, hari awal tidak dihitung", () => {
    const h = pratinjauTarik({ ...dasar, pilihan: tambahPemasok([], sumber, "jahit") });
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(h.baris.map((b) => [b.name, b.durationDays, b.targetDate])).toEqual([
      ["Potong", 1, "2026-10-06"],
      ["Jahit", 9, "2026-10-19"],
    ]);
    expect(h).toMatchObject({ mulai: "2026-10-05", tenggat: null, selesaiPada: "2026-10-19", totalHari: 10, jumlahBaru: 2 });
    expect(h.menyambung).toBe(false);
  });

  it("lintas pemasok: rantai kain lalu penjahit", () => {
    let p = tambahPemasok([], sumber, "kain");
    p = tambahPemasok(p, sumber, "jahit");
    p = centangLangkah(p, "kain", 1, false);
    p = centangLangkah(p, "jahit", 20, false);
    const h = pratinjauTarik({ ...dasar, pilihan: p });
    expect(h.ok && h.baris.map((b) => [b.pemasok, b.name, b.targetDate])).toEqual([
      ["Pabrik Kain", "Celup", "2026-10-07"],
      ["CMT Maju", "Potong", "2026-10-08"],
    ]);
  });

  it("tanggal merah dilewati", () => {
    const h = pratinjauTarik({
      ...dasar,
      kal: kalenderKerja([1, 2, 3, 4, 5], [{ tanggal: "2026-10-06", nama: "Libur" }]),
      pilihan: [{ supplierId: "jahit", sequences: [10] }],
    });
    expect(h.ok && h.baris[0].targetDate).toBe("2026-10-07");
  });

  it("mundur: tenggat = tanggal, mulai dihitung mundur, langkah terakhir jatuh tepat di tenggat", () => {
    const h = pratinjauTarik({ ...dasar, mode: "MUNDUR", tanggal: "2026-10-30", pilihan: tambahPemasok([], sumber, "jahit") });
    expect(h).toMatchObject({ ok: true, mulai: "2026-10-16", tenggat: "2026-10-30", selesaiPada: "2026-10-30" });
  });

  it("maju + tambah ke jadwal berisi: menyambung di akhir, tanggal mulai lama tetap, tanggal pilihan diabaikan", () => {
    const h = pratinjauTarik({
      ...dasar,
      langkahLama: [lama("a", 2)],
      scheduleStart: "2026-10-05",
      deadline: "2026-12-01",
      tanggal: "2027-01-04",
      pilihan: [{ supplierId: "kain", sequences: [1] }],
    });
    expect(h).toMatchObject({ ok: true, menyambung: true, mulai: "2026-10-05", tanggalKirim: "2026-10-05", tenggat: "2026-12-01" });
    expect(h.ok && h.baris.map((b) => [b.kunci, b.baru, b.targetDate])).toEqual([
      ["a", false, "2026-10-07"],
      ["baru-0-kain-1", true, "2026-10-12"],
    ]);
  });

  it("maju + tambah ke jadwal berisi tanpa tanggal mulai: tanggal pilihan menjadi mulai", () => {
    const h = pratinjauTarik({
      ...dasar,
      langkahLama: [lama("a", 2)],
      deadline: "2026-12-01",
      pilihan: [{ supplierId: "kain", sequences: [1] }],
    });
    expect(h).toMatchObject({ ok: true, menyambung: false, mulai: "2026-10-05", tenggat: null, tanggalKirim: "2026-10-05" });
  });

  it("langkah SELESAI tetap berjangkar pada tanggal selesainya", () => {
    const h = pratinjauTarik({
      ...dasar,
      langkahLama: [lama("a", 5, "SELESAI", "2026-10-06")],
      scheduleStart: "2026-10-01",
      pilihan: [{ supplierId: "jahit", sequences: [10] }],
    });
    expect(h.ok && h.baris.map((b) => b.targetDate)).toEqual(["2026-10-06", "2026-10-07"]);
  });

  it("ganti membuang langkah lama, dan ditolak bila ada yang sudah berjalan", () => {
    const pilihan = [{ supplierId: "jahit", sequences: [10] }];
    const ganti = pratinjauTarik({ ...dasar, cara: "GANTI", langkahLama: [lama("a", 2)], scheduleStart: "2026-10-01", pilihan });
    expect(ganti.ok && ganti.baris.map((b) => b.name)).toEqual(["Potong"]);
    expect(ganti.ok && ganti.mulai).toBe("2026-10-05");
    expect(
      pratinjauTarik({ ...dasar, cara: "GANTI", langkahLama: [lama("a", 2, "PROSES")], pilihan }),
    ).toEqual({ ok: false, code: "ADA_LANGKAH_BERJALAN" });
    expect(bolehGanti([{ status: "BELUM" }])).toBe(true);
    expect(bolehGanti([{ status: "BELUM" }, { status: "SELESAI" }])).toBe(false);
  });

  it("menolak dengan kode yang sama dengan penulis", () => {
    expect(pratinjauTarik({ ...dasar, tanggal: "2026-02-30", pilihan: [{ supplierId: "jahit", sequences: [10] }] })).toEqual({
      ok: false,
      code: "TANGGAL_TIDAK_SAH",
    });
    expect(pratinjauTarik({ ...dasar, tanggal: "1999-12-31", pilihan: [{ supplierId: "jahit", sequences: [10] }] })).toEqual({
      ok: false,
      code: "TANGGAL_TIDAK_SAH",
    });
    expect(pratinjauTarik({ ...dasar, pilihan: [{ supplierId: "jahit", sequences: [] }] })).toEqual({
      ok: false,
      code: "TANPA_LANGKAH_LEAD_TIME",
    });
  });
});

describe("pratinjauMulai dan pratinjauStatus", () => {
  const langkah = [
    { id: "a", durationDays: 2, status: "BELUM" as const, doneDate: null },
    { id: "b", durationDays: 3, status: "BELUM" as const, doneDate: null },
  ];

  it("atur mulai maju / mundur", () => {
    expect(pratinjauMulai({ langkah, mode: "MAJU", tanggal: "2026-10-05", kal })).toEqual({
      ok: true,
      mulai: "2026-10-05",
      tenggat: null,
      selesaiPada: "2026-10-12",
      target: ["2026-10-07", "2026-10-12"],
    });
    expect(pratinjauMulai({ langkah, mode: "MUNDUR", tanggal: "2026-10-12", kal })).toEqual({
      ok: true,
      mulai: "2026-10-05",
      tenggat: "2026-10-12",
      selesaiPada: "2026-10-12",
      target: ["2026-10-07", "2026-10-12"],
    });
    expect(pratinjauMulai({ langkah, mode: "MAJU", tanggal: "", kal })).toEqual({ ok: false });
  });

  it("selesai lebih cepat menarik maju perkiraan selesai tahap; proses tidak menggeser apa pun", () => {
    expect(pratinjauStatus({ langkah, stepId: "a", status: "SELESAI", doneDate: "2026-10-06", mulai: "2026-10-05", kal })).toEqual({
      selesaiPadaLama: "2026-10-12",
      selesaiPadaBaru: "2026-10-09",
    });
    expect(pratinjauStatus({ langkah, stepId: "a", status: "PROSES", doneDate: "2026-10-06", mulai: "2026-10-05", kal })).toEqual({
      selesaiPadaLama: "2026-10-12",
      selesaiPadaBaru: "2026-10-12",
    });
  });

  it("pratinjau seret: urutan baru, tanggal per langkah, dan perkiraan selesai — sama dengan menyusun ulang", () => {
    const tiga = [...langkah, { id: "c", durationDays: 1, status: "BELUM" as const, doneDate: null }];
    // Senin 5 Okt: a(2) → 7, b(3) → 12, c(1) → 13. Pindah c ke atas: c → 6, a → 8, b → 13.
    expect(pratinjauPindah({ langkah: tiga, dari: 2, ke: 0, mulai: "2026-10-05", kal })).toEqual({
      urutan: ["c", "a", "b"],
      target: { c: "2026-10-06", a: "2026-10-08", b: "2026-10-13" },
      selesaiPadaLama: "2026-10-13",
      selesaiPadaBaru: "2026-10-13",
    });
    // Langkah yang sudah selesai tetap berjangkar pada tanggal selesainya di posisi baru.
    const selesai = [{ id: "a", durationDays: 2, status: "SELESAI" as const, doneDate: "2026-10-09" }, ...tiga.slice(1)];
    expect(pratinjauPindah({ langkah: selesai, dari: 0, ke: 2, mulai: "2026-10-05", kal })).toEqual({
      urutan: ["b", "c", "a"],
      target: { b: "2026-10-08", c: "2026-10-09", a: "2026-10-09" },
      // Lama: a selesai Jumat 9 Okt, b(3) → 14, c(1) → 15.
      selesaiPadaLama: "2026-10-15",
      selesaiPadaBaru: "2026-10-09",
    });
    expect(pratinjauPindah({ langkah: tiga, dari: 1, ke: 1, mulai: "2026-10-05", kal }).urutan).toEqual(["a", "b", "c"]);
  });

  it("peringatan: langkah pertama yang belum selesai seharusnya sudah mulai", () => {
    const b = (status: "BELUM" | "PROSES" | "SELESAI", targetDate: string, name = "X") => ({ name, status, targetDate });
    // Rantai mulai Senin 5 Okt, hari ini Rabu 7 Okt, belum ada yang selesai.
    expect(
      peringatanJadwal({ langkah: [b("BELUM", "2026-10-07", "Rajut"), b("BELUM", "2026-10-12")], mulai: "2026-10-05", tenggat: "2026-10-12", hariIni: "2026-10-07", kal }),
    ).toEqual({ jenis: "MULAI_LEWAT", langkah: "Rajut", mulai: "2026-10-05", hari: 2 });
    // Langkah yang sudah selesai tidak dihitung: yang berikutnya mulai dari target langkah sebelumnya.
    expect(
      peringatanJadwal({
        langkah: [b("SELESAI", "2026-10-02"), b("BELUM", "2026-10-09", "Celup")],
        mulai: "2026-09-28",
        tenggat: "2026-10-09",
        hariIni: "2026-10-07",
        kal,
      }),
    ).toEqual({ jenis: "MULAI_LEWAT", langkah: "Celup", mulai: "2026-10-02", hari: 3 });
    // Belum waktunya mulai → tidak ada peringatan.
    expect(peringatanJadwal({ langkah: [b("BELUM", "2026-10-12")], mulai: "2026-10-07", tenggat: "2026-10-12", hariIni: "2026-10-07", kal })).toBeNull();
    // Semua selesai → tidak ada peringatan.
    expect(peringatanJadwal({ langkah: [b("SELESAI", "2026-10-01")], mulai: "2026-09-28", tenggat: "2026-10-01", hariIni: "2026-10-07", kal })).toBeNull();
  });

  it("peringatan: perkiraan selesai sesudah tenggat (langkah yang sudah selesai terlambat menggeser sisanya)", () => {
    const b = (status: "BELUM" | "SELESAI", targetDate: string) => ({ name: "X", status, targetDate });
    expect(
      peringatanJadwal({ langkah: [b("SELESAI", "2026-10-07"), b("BELUM", "2026-10-12")], mulai: "2026-09-28", tenggat: "2026-10-09", hariIni: "2026-10-07", kal }),
    ).toEqual({ jenis: "LEWAT_TENGGAT", selesai: "2026-10-12", hari: 1 });
    // Tanpa tenggat tidak ada yang dibandingkan.
    expect(peringatanJadwal({ langkah: [b("BELUM", "2026-10-12")], mulai: "2026-10-07", tenggat: null, hariIni: "2026-10-07", kal })).toBeNull();
  });

  it("kalender dari data server", () => {
    const k = kalenderDariData({ hariKerja: [1, 2, 3, 4, 5, 6], tanggalMerah: ["2026-10-06"] });
    expect(k.hariKerja.has(6)).toBe(true);
    expect(k.libur.has("2026-10-06")).toBe(true);
  });
});

describe("teks dan keadaan", () => {
  it("pesan WhatsApp selalu bahasa Indonesia, tautannya ter-encode", () => {
    const pesan = pesanWaLangkah({ pemasok: "CMT Maju", langkah: "Jahit", tahap: "Kaos Basic · Tahap 1", targetDate: "2026-10-19" });
    expect(pesan).toBe("Halo CMT Maju, menanyakan proses Jahit untuk Kaos Basic · Tahap 1 — target 19 Okt 2026.");
    expect(tautanWaDenganPesan("https://wa.me/628123", "Halo & salam")).toBe("https://wa.me/628123?text=Halo%20%26%20salam");
  });

  it("kurang / pas (sampai +5%) / lebih", () => {
    expect(keadaanKebutuhan(100, 99.99)).toEqual({ keadaan: "KURANG", selisih: -0.01 });
    expect(keadaanKebutuhan(100, 100)).toEqual({ keadaan: "PAS", selisih: 0 });
    expect(keadaanKebutuhan(100, 105)).toEqual({ keadaan: "PAS", selisih: 5 });
    expect(keadaanKebutuhan(100, 105.01)).toEqual({ keadaan: "LEBIH", selisih: 5.01 });
    expect(keadaanKebutuhan(0, 0).keadaan).toBe("PAS");
    expect(keadaanKebutuhan(0, 1).keadaan).toBe("LEBIH");
  });

  it("alasan Buat WO ditolak, urutan sama dengan server", () => {
    const penjahit = { id: "p", name: "P" };
    const barang = { id: "b", sku: "B", nama: "B" };
    expect(alasanTidakBisaBuatWo({ penjahit: null, barang: null, variantSku: null })).toBe("TANPA_VENDOR");
    expect(alasanTidakBisaBuatWo({ penjahit, barang: null, variantSku: "X" })).toBe("TANPA_BARANG_JADI");
    expect(alasanTidakBisaBuatWo({ penjahit, barang, variantSku: "  " })).toBe("TAHAP_TANPA_VARIAN");
    expect(alasanTidakBisaBuatWo({ penjahit, barang, variantSku: "B-M" })).toBeNull();
    expect(bolehWoBaru(null)).toBe(true);
    expect(bolehWoBaru({ id: "w", docNumber: "WO/1", status: "CANCELLED" })).toBe(true);
    expect(bolehWoBaru({ id: "w", docNumber: "WO/1", status: "DRAFT" })).toBe(false);
  });

  it("hari terlambat dan isian lama", () => {
    expect(hariTerlambat("2026-10-05", "2026-10-07")).toBe(2);
    expect(hariTerlambat("2026-10-07", "2026-10-07")).toBe(0);
    expect(hariTerlambat("2026-10-09", "2026-10-07")).toBe(0);
    expect(bacaDurasi(" 12 ")).toBe(12);
    expect(bacaDurasi("0")).toBe(0);
    expect(bacaDurasi("1.5")).toBeNull();
    expect(bacaDurasi("-1")).toBeNull();
    expect(bacaDurasi("3651")).toBeNull();
    expect(bacaDurasi("")).toBeNull();
  });
});

describe("label tampilan", () => {
  it("status usulan saat pil diklik mengikuti alur Belum → Proses → Selesai", () => {
    expect(statusUsulan("BELUM")).toBe("PROSES");
    expect(statusUsulan("PROSES")).toBe("SELESAI");
    expect(statusUsulan("SELESAI")).toBe("SELESAI");
  });

  it("judul tahap dengan kode jenis; tanpa kode cukup namanya", () => {
    expect(labelTahapRuang({ name: "Tahap 1", kategori: { id: "k", code: "KB", name: "Kaos Basic" } })).toBe("KB · Tahap 1");
    expect(labelTahapRuang({ name: "Tahap 1", kategori: { id: "k", code: " ", name: "Kaos Basic" } })).toBe("Tahap 1");
  });

  it("tanggal pendek: tahun hanya bila bukan tahun ini, hari tidak bergeser", () => {
    expect(labelPendek("2026-11-12", "2026-10-07", "id")).toBe("12 Nov");
    expect(labelPendek("2027-01-01", "2026-10-07", "id")).toBe("1 Jan 2027");
    expect(labelPendek("2026-08-17", "2026-10-07", "en")).toBe("17 Aug");
    expect(labelPendek(null, "2026-10-07", "id")).toBe("");
  });

  it("bulan target dan angka", () => {
    expect(namaBulanTahun(10, 2026, "id")).toBe("Oktober 2026");
    expect(namaBulanTahun(null, 2026, "id")).toBeNull();
    expect(namaBulanTahun(13, 2026, "id")).toBeNull();
    expect(angkaTampil(1234.567, "id")).toBe("1.234,57");
    expect(angkaTampil(1234.5, "en")).toBe("1,234.5");
  });
});

describe("batas impor klien", () => {
  // jadwal-queries / -writer / -pengaturan membawa Prisma; layar ini hanya boleh mengimpor TIPE-nya.
  const folder = path.dirname(fileURLToPath(import.meta.url));
  const berkas = readdirSync(folder).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".spec.ts") && f !== "page.tsx");

  it.each(berkas)("%s tidak mengimpor nilai dari modul yang membawa Prisma", (f) => {
    const isi = readFileSync(path.join(folder, f), "utf8");
    const impor = [...isi.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gm)];
    for (const m of impor) {
      if (/jadwal-(queries|writer|pengaturan)$|@elorae\/db$|lib\/suppliers\/queries$/.test(m[2])) {
        expect(m[1], `${f}: ${m[0]}`).toBe("type ");
      }
    }
  });
});

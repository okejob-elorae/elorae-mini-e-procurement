import { describe, expect, it } from "vitest";
import {
  bekuDariRincian,
  gajiBulananBerlaku,
  hariAntara,
  hariBulan,
  hariDinilaiGaji,
  hariKerjaStandar,
  hitungGajiPokok,
  masaKerjaBulan,
  pesertaGajiBulan,
  susunDasarHari,
  URUTAN_TAHAN_BAYAR,
  type DasarHari,
  type JenisHari,
} from "./gaji-pokok";

/**
 * Gaji pokok SPG (keputusan pemilik 2026-11-02): contoh pemilik "3.500.000 dan masuk 26 hari kerja
 * … jika dia ada absen ya di potong untuk hariannya" (P7a), izin disetujui tidak dipotong (P7b),
 * mulai/berhenti tengah bulan dibagi hari kerja standar sebulan penuh (P62), masuk di hari libur
 * dibayar satu tarif harian (P65a), check-in di luar radius tetap hadir (P70), dan seluruh
 * pembayaran menunggu selama dasarnya belum pasti (P60).
 */

const SENIN_SABTU = [1, 2, 3, 4, 5, 6];
const SPG = "u-dewi";

/** Bulan dengan 26 hari KERJA: November 2026 tanpa hari Minggu (1, 8, 15, 22, 29) dan tanpa tanggal 30. */
function jadwal26(bulan = "2026-11"): Map<string, JenisHari> {
  const sel = new Map<string, JenisHari>();
  for (const d of hariBulan(bulan)) {
    const minggu = new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
    sel.set(d, minggu || d.endsWith("-30") ? "LIBUR" : "KERJA");
  }
  return sel;
}

function hitung(m: {
  sel?: Map<string, JenisHari>;
  hadir?: (d: string) => boolean;
  luarRadius?: (d: string) => boolean;
  izin?: { startDay: string; endDay: string; type: string }[];
  mulai?: string | null;
  akhir?: string | null;
  gaji?: number | null;
  statusJadwal?: "DRAF" | "DIAJUKAN" | "DISETUJUI" | "DITOLAK" | null;
  catatan?: Map<string, { kind: JenisHari; present: boolean }> | null;
  statusCatatan?: "DIAJUKAN" | "DIPERIKSA" | "DIKEMBALIKAN" | null;
  mulaiDiisi?: boolean;
}) {
  const bulan = "2026-11";
  const sel = m.sel ?? jadwal26();
  const masa = masaKerjaBulan(bulan, m.mulai === undefined ? "2026-01-01" : m.mulai, m.akhir ?? null);
  const hari = masa ? hariAntara(masa.hariAwal, masa.hariAkhir) : [];
  const checkin = new Map<string, { luarRadius: boolean }>();
  for (const d of hari) if ((m.hadir ?? (() => true))(d)) checkin.set(d, { luarRadius: (m.luarRadius ?? (() => false))(d) });
  const { dasar, tanpaDasar } = susunDasarHari({
    hari,
    statusJadwal: m.statusJadwal === undefined ? "DISETUJUI" : m.statusJadwal,
    sel,
    catatanDiperiksa: m.statusCatatan === "DIPERIKSA" ? (m.catatan ?? null) : null,
    checkin,
  });
  return hitungGajiPokok({
    bulan,
    gajiBulanan: m.gaji === undefined ? 3_500_000 : m.gaji,
    mulaiDiisi: m.mulaiDiisi ?? true,
    masa,
    dasar,
    tanpaDasar,
    statusJadwal: m.statusJadwal === undefined ? "DISETUJUI" : m.statusJadwal,
    sel,
    statusCatatan: m.statusCatatan ?? null,
    izin: (m.izin ?? []).map((z) => ({ userId: SPG, ...z })),
    userId: SPG,
    hariKerjaSpg: SENIN_SABTU,
  });
}

function rincian(h: ReturnType<typeof hitung>) {
  if (!h.ok) throw new Error(`ditahan ${h.alasan}`);
  return h.rincian;
}

describe("bulan penuh (P7a, P7b)", () => {
  it("tanpa absen dibayar penuh", () => {
    const r = rincian(hitung({}));
    expect(r.hariTerjadwal).toBe(26);
    expect(r.tarifHarian).toBe(134_615);
    expect(r.gajiPokok).toBe(3_500_000);
    expect(r.sumberPembagi).toBe("JADWAL");
  });

  it("satu hari absen dipotong satu tarif harian — contoh pemilik", () => {
    const r = rincian(hitung({ hadir: (d) => d !== "2026-11-03" }));
    expect(r.hariTidakMasuk).toBe(1);
    expect(r.tanggalTidakMasuk).toEqual(["2026-11-03"]);
    expect(r.gajiPokok).toBe(3_365_385);
  });

  it("izin sakit yang disetujui tidak dipotong", () => {
    const r = rincian(hitung({ hadir: (d) => d !== "2026-11-03", izin: [{ startDay: "2026-11-03", endDay: "2026-11-03", type: "SAKIT" }] }));
    expect(r.hariIzin).toBe(1);
    expect(r.hariTidakMasuk).toBe(0);
    expect(r.gajiPokok).toBe(3_500_000);
  });

  it("satu absen dan satu hari libur yang dikerjakan saling menutup (P65a)", () => {
    const r = rincian(hitung({ hadir: (d) => d !== "2026-11-03" }));
    // hadir di semua hari, termasuk Minggu & tgl 30 (LIBUR) — lima Minggu + satu tanggal 30 dikerjakan.
    expect(r.hariMasukLibur).toBe(6);
    const hanyaSatuLibur = rincian(hitung({ hadir: (d) => d !== "2026-11-03" && (jadwal26().get(d) === "KERJA" || d === "2026-11-08") }));
    expect(hanyaSatuLibur.hariMasukLibur).toBe(1);
    expect(hanyaSatuLibur.gajiPokok).toBe(3_500_000);
  });

  it("absen di setiap hari terjadwal dibayar 0, tanpa sisa pembulatan", () => {
    const r = rincian(hitung({ hadir: () => false }));
    expect(r.hariTidakMasuk).toBe(26);
    expect(r.gajiPokok).toBe(0);
  });

  it("izin disetujui di setiap hari terjadwal tetap dibayar penuh", () => {
    const r = rincian(hitung({ hadir: () => false, izin: [{ startDay: "2026-11-01", endDay: "2026-11-30", type: "CUTI" }] }));
    expect(r.gajiPokok).toBe(3_500_000);
  });

  it("check-in di luar radius tetap hadir dan didaftar (P70)", () => {
    const r = rincian(hitung({ luarRadius: (d) => d === "2026-11-04" || d === "2026-11-05" }));
    expect(r.gajiPokok).toBe(3_500_000);
    expect(r.tanggalLuarRadius).toEqual(["2026-11-04", "2026-11-05"]);
  });
});

describe("mulai atau berhenti di tengah bulan (P62)", () => {
  it("pembagi = hari kerja standar sebulan penuh; dibayar hari terjadwalnya saja", () => {
    expect(hariKerjaStandar("2026-11", SENIN_SABTU)).toBe(25);
    const sel = new Map<string, JenisHari>();
    for (const d of hariAntara("2026-11-16", "2026-11-30")) {
      const minggu = new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
      sel.set(d, minggu || d === "2026-11-30" ? "LIBUR" : "KERJA");
    }
    const r = rincian(hitung({ sel, mulai: "2026-11-16", hadir: (d) => sel.get(d) === "KERJA" }));
    expect(r.penuh).toBe(false);
    expect(r.sumberPembagi).toBe("STANDAR");
    expect(r.pembagi).toBe(25);
    expect(r.tarifHarian).toBe(140_000);
    expect(r.hariTerjadwal).toBe(12);
    expect(r.gajiPokok).toBe(12 * 140_000);
  });

  it("berhenti tengah bulan: hari sesudah hari terakhirnya tidak dihitung", () => {
    const r = rincian(hitung({ akhir: "2026-11-10" }));
    expect(r.hariAkhir).toBe("2026-11-10");
    expect(r.penuh).toBe(false);
    // 1–10 November tanpa Minggu 1 dan 8.
    expect(r.hariTerjadwal).toBe(8);
  });

  it("tanpa hari terjadwal di masanya dibayar 0", () => {
    const sel = new Map<string, JenisHari>();
    for (const d of hariAntara("2026-11-29", "2026-11-30")) sel.set(d, "LIBUR");
    const r = rincian(hitung({ sel, mulai: "2026-11-29", hadir: () => false }));
    expect(r.gajiPokok).toBe(0);
  });

  it("masa yang tidak menyentuh bulan itu dibayar 0", () => {
    expect(masaKerjaBulan("2026-11", "2026-12-02", null)).toBeNull();
    const r = rincian(hitung({ mulai: "2026-12-02" }));
    expect(r.gajiPokok).toBe(0);
  });
});

describe("catatan check-in toko (P61)", () => {
  it("catatan yang sudah diperiksa menggantikan sel jadwal DAN check-in sistem", () => {
    const catatan = new Map<string, { kind: JenisHari; present: boolean }>([
      ["2026-11-03", { kind: "KERJA", present: false }],
      ["2026-11-08", { kind: "KERJA", present: true }],
    ]);
    const r = rincian(hitung({ statusCatatan: "DIPERIKSA", catatan, hadir: (d) => jadwal26().get(d) === "KERJA" }));
    // 26 + Minggu 8 yang kini KERJA = 27 hari terjadwal; tgl 3 tidak hadir menurut catatan.
    expect(r.hariTerjadwal).toBe(27);
    expect(r.hariTidakMasuk).toBe(1);
    expect(r.hariDariCatatan).toBe(2);
  });

  it("catatan yang belum diperiksa tidak dipakai dan menahan pembayaran", () => {
    const h = hitung({ statusCatatan: "DIAJUKAN", catatan: new Map([["2026-11-03", { kind: "KERJA", present: false }]]) });
    expect(h).toEqual({ ok: false, alasan: "CATATAN_HADIR_BELUM_DIPERIKSA", hari: [] });
    expect(hitung({ statusCatatan: "DIKEMBALIKAN" })).toMatchObject({ ok: false, alasan: "CATATAN_HADIR_BELUM_DIPERIKSA" });
  });

  it("catatan yang diperiksa menutup hari yang jadwalnya ditolak", () => {
    // Hadir di setiap hari KERJA, tidak masuk di hari LIBUR — masuk di hari libur dibayar tambahan (P65a).
    const semua = new Map<string, { kind: JenisHari; present: boolean }>(
      hariBulan("2026-11").map((d) => [d, { kind: jadwal26().get(d)!, present: jadwal26().get(d) === "KERJA" }]),
    );
    const r = rincian(hitung({ statusJadwal: "DITOLAK", statusCatatan: "DIPERIKSA", catatan: semua }));
    expect(r.gajiPokok).toBe(3_500_000);
    expect(r.hariDariCatatan).toBe(30);
  });
});

describe("tahan (P60)", () => {
  it("urutan tahan tetap", () => {
    expect(URUTAN_TAHAN_BAYAR).toEqual([
      "GAJI_POKOK_BELUM_DIATUR",
      "MULAI_KERJA_BELUM_DIISI",
      "CATATAN_HADIR_BELUM_DIPERIKSA",
      "JADWAL_MENUNGGU_PERSETUJUAN",
      "CATATAN_HADIR_BELUM_DIMASUKKAN",
      "TANPA_HARI_KERJA",
    ]);
  });

  it("gaji belum diatur ditahan lebih dulu dari sebab lain; Rp 0 tetap gaji", () => {
    expect(hitung({ gaji: null, statusJadwal: null })).toMatchObject({ ok: false, alasan: "GAJI_POKOK_BELUM_DIATUR" });
    expect(rincian(hitung({ gaji: 0 })).gajiPokok).toBe(0);
  });

  it("tanggal mulai belum diisi menahan pembayaran", () => {
    expect(hitung({ mulaiDiisi: false })).toMatchObject({ ok: false, alasan: "MULAI_KERJA_BELUM_DIISI" });
  });

  it("jadwal draf/diajukan: menunggu persetujuan", () => {
    expect(hitung({ statusJadwal: "DIAJUKAN" })).toMatchObject({ ok: false, alasan: "JADWAL_MENUNGGU_PERSETUJUAN" });
    expect(hitung({ statusJadwal: "DRAF" })).toMatchObject({ ok: false, alasan: "JADWAL_MENUNGGU_PERSETUJUAN" });
  });

  it("jadwal ditolak atau hari kosong: catatan check-in belum dimasukkan, dengan harinya", () => {
    expect(hitung({ statusJadwal: "DITOLAK" })).toMatchObject({ ok: false, alasan: "CATATAN_HADIR_BELUM_DIMASUKKAN" });
    const sel = jadwal26();
    sel.delete("2026-11-03");
    const h = hitung({ sel });
    expect(h).toEqual({ ok: false, alasan: "CATATAN_HADIR_BELUM_DIMASUKKAN", hari: ["2026-11-03"] });
    expect(hitung({ statusJadwal: null })).toMatchObject({ ok: false, alasan: "CATATAN_HADIR_BELUM_DIMASUKKAN" });
  });

  it("bulan penuh tanpa satu pun hari KERJA ditahan (pertanyaan pemilik)", () => {
    const sel = new Map<string, JenisHari>(hariBulan("2026-11").map((d) => [d, "LIBUR"]));
    expect(hitung({ sel })).toEqual({ ok: false, alasan: "TANPA_HARI_KERJA", hari: [] });
  });
});

describe("bulan yang sudah dibayar dibekukan", () => {
  it("masa, penuh dan pembagi dari rincian tersimpan — pengaturan hari kerja yang berubah tidak menggeser", () => {
    const sel = new Map<string, JenisHari>();
    for (const d of hariAntara("2026-11-16", "2026-11-30")) sel.set(d, new Date(`${d}T00:00:00Z`).getUTCDay() === 0 ? "LIBUR" : "KERJA");
    const masa = masaKerjaBulan("2026-11", "2026-11-16", null);
    const hari = hariAntara("2026-11-16", "2026-11-30");
    const checkin = new Map(hari.filter((d) => sel.get(d) === "KERJA").map((d) => [d, { luarRadius: false }]));
    const { dasar, tanpaDasar } = susunDasarHari({ hari, statusJadwal: "DISETUJUI", sel, catatanDiperiksa: null, checkin });
    const dasarHitung = {
      bulan: "2026-11",
      gajiBulanan: 3_500_000,
      mulaiDiisi: true,
      masa,
      dasar: dasar as Map<string, DasarHari>,
      tanpaDasar,
      statusJadwal: "DISETUJUI" as const,
      sel,
      statusCatatan: null,
      izin: [],
      userId: SPG,
    };
    const dibayar = hitungGajiPokok({ ...dasarHitung, hariKerjaSpg: SENIN_SABTU });
    if (!dibayar.ok) throw new Error("ditahan");
    const beku = bekuDariRincian(dibayar.rincian);
    expect(beku).toEqual({ hariAwal: "2026-11-16", hariAkhir: "2026-11-30", penuh: false, pembagi: 25, sumberPembagi: "STANDAR" });
    const sesudah = hitungGajiPokok({ ...dasarHitung, hariKerjaSpg: [0, 1, 2, 3, 4, 5, 6], beku });
    expect(sesudah.ok && sesudah.rincian.gajiPokok).toBe(dibayar.rincian.gajiPokok);
  });
});

describe("bulan dibayar penuh, lalu hari terakhir diisi di tengah bulan itu", () => {
  /*
   * Oktober dibayar sebagai bulan penuh dengan 10 hari tidak masuk dipotong; kantor kemudian
   * menandai hari terakhirnya 15 Oktober. Hari yang dinilai harus tetap masa beku (1–31 Oktober):
   * kalau diambil dari masa sekarang (1–15), sepuluh hari tidak masuk sesudah tanggal 15 ikut hilang
   * dan bulan itu dihitung ulang 3.500.000 — koreksi plus untuk hari yang tidak dikerjakan.
   */
  const bulan = "2026-10";
  const sel = new Map<string, JenisHari>();
  for (const d of hariBulan(bulan)) sel.set(d, new Date(`${d}T00:00:00Z`).getUTCDay() === 0 ? "LIBUR" : "KERJA");
  const kerja = [...sel].filter(([, k]) => k === "KERJA").map(([d]) => d);
  const tidakMasuk = new Set(kerja.slice(-10));
  const nilai = (hari: string[], beku: ReturnType<typeof bekuDariRincian>, masa: ReturnType<typeof masaKerjaBulan>) => {
    const checkin = new Map(hari.filter((d) => sel.get(d) === "KERJA" && !tidakMasuk.has(d)).map((d) => [d, { luarRadius: false }]));
    const { dasar, tanpaDasar } = susunDasarHari({ hari, statusJadwal: "DISETUJUI", sel, catatanDiperiksa: null, checkin });
    return hitungGajiPokok({
      bulan,
      gajiBulanan: 3_500_000,
      mulaiDiisi: true,
      masa,
      dasar,
      tanpaDasar,
      statusJadwal: "DISETUJUI",
      sel,
      statusCatatan: null,
      izin: [],
      userId: SPG,
      hariKerjaSpg: SENIN_SABTU,
      beku,
    });
  };

  it("hari yang dinilai = masa beku, bukan masa sesudah hari terakhir diisi", () => {
    const masaPenuh = masaKerjaBulan(bulan, "2026-01-01", null);
    const dibayar = nilai(hariDinilaiGaji(masaPenuh, null), null, masaPenuh);
    if (!dibayar.ok) throw new Error(`ditahan ${dibayar.alasan}`);
    expect(dibayar.rincian.hariTidakMasuk).toBe(10);
    const beku = bekuDariRincian(dibayar.rincian);
    expect(beku).toMatchObject({ hariAwal: "2026-10-01", hariAkhir: "2026-10-31", penuh: true });

    const masaSekarang = masaKerjaBulan(bulan, "2026-01-01", "2026-10-15");
    expect(hariDinilaiGaji(masaSekarang, beku)).toEqual(hariAntara("2026-10-01", "2026-10-31"));
    const sesudah = nilai(hariDinilaiGaji(masaSekarang, beku), beku, masaSekarang);
    expect(sesudah.ok && sesudah.rincian.gajiPokok).toBe(dibayar.rincian.gajiPokok);
    expect(sesudah.ok && sesudah.rincian.hariTidakMasuk).toBe(10);
  });

  it("masa sekarang yang tidak lagi menyentuh bulan beku tidak membuat gajinya nol", () => {
    const masaPenuh = masaKerjaBulan(bulan, "2026-01-01", null);
    const dibayar = nilai(hariDinilaiGaji(masaPenuh, null), null, masaPenuh);
    if (!dibayar.ok) throw new Error(`ditahan ${dibayar.alasan}`);
    const beku = bekuDariRincian(dibayar.rincian);
    const sesudah = nilai(hariDinilaiGaji(null, beku), beku, null);
    expect(sesudah.ok && sesudah.rincian.gajiPokok).toBe(dibayar.rincian.gajiPokok);
  });

  it("tanpa beku, hari yang dinilai = masa sekarang", () => {
    expect(hariDinilaiGaji({ hariAwal: "2026-11-16", hariAkhir: "2026-11-18" }, null)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
    expect(hariDinilaiGaji(null, null)).toEqual([]);
  });
});

describe("pembantu", () => {
  it("gaji yang berlaku = effectiveFrom terakhir ≤ bulan", () => {
    const rows = [
      { effectiveFrom: "2026-09", monthlyAmount: 3_000_000 },
      { effectiveFrom: "2026-11", monthlyAmount: 3_500_000 },
    ];
    expect(gajiBulananBerlaku(rows, "2026-08")).toBeNull();
    expect(gajiBulananBerlaku(rows, "2026-10")).toBe(3_000_000);
    expect(gajiBulananBerlaku(rows, "2026-12")).toBe(3_500_000);
  });

  it("masa kerja dengan batas null dan batas di tepi bulan", () => {
    expect(masaKerjaBulan("2026-11", null, null)).toEqual({ hariAwal: "2026-11-01", hariAkhir: "2026-11-30", penuh: true });
    expect(masaKerjaBulan("2026-11", "2026-11-01", "2026-11-30")).toMatchObject({ penuh: true });
    expect(masaKerjaBulan("2026-11", "2026-10-05", "2026-11-12")).toEqual({ hariAwal: "2026-11-01", hariAkhir: "2026-11-12", penuh: false });
    expect(masaKerjaBulan("2026-11", null, "2026-10-31")).toBeNull();
  });

  it("peserta: jadwal, penjual, catatan, dan masa tugas yang menyentuh bulan", () => {
    const peserta = pesertaGajiBulan({
      bulan: "2026-11",
      jadwal: ["u-a"],
      penjual: ["u-b", "u-a"],
      catatan: ["u-c"],
      tugas: [
        { userId: "u-d", mulai: "2026-11-20", akhir: null },
        { userId: "u-e", mulai: null, akhir: null },
        { userId: "u-f", mulai: "2026-01-01", akhir: "2026-10-31" },
        { userId: "u-g", mulai: "2026-12-01", akhir: null },
      ],
    });
    expect(peserta).toEqual(["u-a", "u-b", "u-c", "u-d"]);
  });
});

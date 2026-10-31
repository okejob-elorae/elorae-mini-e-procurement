import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Aksi jadwal produksi — pagar izin, pelaku dari sesi, dan penolakan berkode.
 * Tanpa basis data: sesi, penulis, kueri, dan pengaturan ditiru; yang diperiksa
 * adalah apakah penulis/kueri DIPANGGIL dan dengan isian apa.
 */

const keadaan = vi.hoisted(() => ({
  sesi: { user: { id: "u1", permissions: ["*"] as string[] } } as null | { user: { id?: string; permissions?: string[] } },
  lempar: false,
}));

const tiru = vi.hoisted(() => {
  const hasilOk = (extra: object = {}) => vi.fn(async () => ({ ok: true, ...extra }));
  return {
    writer: {
      tarikJadwalDariLeadTime: hasilOk({ jumlah: 2 }),
      tambahLangkah: hasilOk({ id: "s-baru" }),
      ubahLangkah: hasilOk(),
      ubahStatusLangkah: hasilOk(),
      pindahUrutanLangkah: hasilOk(),
      pindahLangkahKe: hasilOk(),
      hapusLangkah: hasilOk(),
      aturMulaiJadwal: hasilOk(),
    },
    queries: {
      ruangKerjaTahap: vi.fn(async (): Promise<unknown> => ({ tahap: { id: "t1" } })),
      ikhtisarJadwalTahun: vi.fn(async () => []),
      tahapBulan: vi.fn(async () => []),
      followUpProduksi: vi.fn(async () => ({ baris: [], jumlah: { hariIni: 0, terlambat: 0, mingguIni: 0, semua: 0 }, halaman: 1, jumlahHalaman: 1 })),
      kalenderProduksiBulan: vi.fn(async () => ({})),
    },
    pengaturan: {
      ambilKalenderKerja: vi.fn(async () => ({ kal: {}, hariKerja: [1, 2, 3, 4, 5], tanggalMerah: [] })),
      simpanHariKerjaProduksi: vi.fn(async () => ({ ok: true, hariKerja: [1, 2, 3, 4, 5, 6] })),
      simpanTanggalMerah: vi.fn(async () => ({ ok: true, tanggalMerah: [] })),
    },
    revalidate: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => keadaan.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: tiru.revalidate }));
vi.mock("@/lib/production/jadwal-writer", () => tiru.writer);
vi.mock("@/lib/production/jadwal-queries", () => tiru.queries);
vi.mock("@/lib/production/jadwal-pengaturan", () => tiru.pengaturan);

const aksi = await import("./jadwal-produksi");

const semuaTiruan = () => [...Object.values(tiru.writer), ...Object.values(tiru.queries), ...Object.values(tiru.pengaturan)];

beforeEach(() => {
  keadaan.sesi = { user: { id: "u1", permissions: ["*"] } };
  for (const f of semuaTiruan()) f.mockClear();
  tiru.revalidate.mockClear();
});

const izin = (...p: string[]) => {
  keadaan.sesi = { user: { id: "u1", permissions: p } };
};

/** Setiap aksi tulis dengan isian sah. */
const TULIS = {
  tarikJadwalAction: () =>
    aksi.tarikJadwalAction({ planStageId: "t1", langkah: [{ supplierId: "p1", sequence: 1 }], mode: "MAJU", tanggal: "2031-03-03", cara: "GANTI" }),
  tambahLangkahAction: () => aksi.tambahLangkahAction({ planStageId: "t1", name: "QC", durationDays: 1 }),
  ubahLangkahAction: () => aksi.ubahLangkahAction({ stepId: "s1", durationDays: 2 }),
  ubahStatusLangkahAction: () => aksi.ubahStatusLangkahAction({ stepId: "s1", status: "SELESAI", doneDate: "2026-10-01" }),
  pindahUrutanLangkahAction: () => aksi.pindahUrutanLangkahAction({ stepId: "s1", arah: "NAIK" }),
  pindahLangkahKeAction: () => aksi.pindahLangkahKeAction({ stepId: "s1", posisi: 2 }),
  hapusLangkahAction: () => aksi.hapusLangkahAction({ stepId: "s1" }),
  aturMulaiJadwalAction: () => aksi.aturMulaiJadwalAction({ planStageId: "t1", mode: "MUNDUR", tanggal: "2031-03-21" }),
} as const;

const BACA = {
  ambilRuangKerjaTahapAction: () => aksi.ambilRuangKerjaTahapAction("t1"),
  ambilIkhtisarJadwalAction: () => aksi.ambilIkhtisarJadwalAction(2026),
  ambilTahapBulanAction: () => aksi.ambilTahapBulanAction(2026, 3),
  ambilFollowUpAction: () => aksi.ambilFollowUpAction({ saring: "terlambat" }),
  ambilKalenderProduksiAction: () => aksi.ambilKalenderProduksiAction(2026, 10),
} as const;

describe("aksi tulis", () => {
  for (const [nama, jalankan] of Object.entries(TULIS)) {
    it(`${nama}: tanpa sesi atau hanya izin lihat → TANPA_AKSES, tidak ada penulis yang dipanggil`, async () => {
      keadaan.sesi = null;
      expect(await jalankan()).toEqual({ ok: false, code: "TANPA_AKSES" });
      keadaan.sesi = { user: { permissions: ["*"] } };
      expect(await jalankan()).toEqual({ ok: false, code: "TANPA_AKSES" });
      izin("production_planning:view", "lead_time:manage", "purchase_orders:view");
      expect(await jalankan()).toEqual({ ok: false, code: "TANPA_AKSES" });
      for (const f of semuaTiruan()) expect(f).not.toHaveBeenCalled();
      expect(tiru.revalidate).not.toHaveBeenCalled();
    });
  }

  it("dengan production_planning:manage: pelaku dari SESI, olehUserId kiriman klien dibuang", async () => {
    izin("production_planning:manage");
    expect(
      await aksi.ubahStatusLangkahAction({ stepId: "s1", status: "SELESAI", doneDate: "2026-10-01", olehUserId: "penyusup" } as never),
    ).toEqual({ ok: true });
    expect(tiru.writer.ubahStatusLangkah).toHaveBeenCalledWith({ stepId: "s1", status: "SELESAI", doneDate: "2026-10-01", olehUserId: "u1" });
    expect(tiru.revalidate).toHaveBeenCalled();

    expect(await TULIS.tarikJadwalAction()).toEqual({ ok: true, jumlah: 2 });
    expect(tiru.writer.tarikJadwalDariLeadTime).toHaveBeenCalledWith({
      planStageId: "t1",
      langkah: [{ supplierId: "p1", sequence: 1 }],
      mode: "MAJU",
      tanggal: "2031-03-03",
      cara: "GANTI",
      olehUserId: "u1",
    });
    expect(await TULIS.tambahLangkahAction()).toEqual({ ok: true, id: "s-baru" });
    expect(await TULIS.hapusLangkahAction()).toEqual({ ok: true });
    expect(await TULIS.pindahLangkahKeAction()).toEqual({ ok: true });
    expect(tiru.writer.pindahLangkahKe).toHaveBeenCalledWith({ stepId: "s1", posisi: 2, olehUserId: "u1" });
  });

  it("isian rusak → ISIAN_TIDAK_SAH tanpa memanggil penulis", async () => {
    expect(await aksi.ubahStatusLangkahAction({ stepId: "s1", status: "BATAL" as never })).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(await aksi.pindahUrutanLangkahAction({ stepId: "s1", arah: "KIRI" as never })).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(await aksi.hapusLangkahAction({ stepId: "" })).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(await aksi.pindahLangkahKeAction({ stepId: "s1", posisi: -1 })).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(await aksi.pindahLangkahKeAction({ stepId: "s1", posisi: 1.5 })).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(
      await aksi.tarikJadwalAction({ planStageId: "t1", langkah: [{ supplierId: "p1", sequence: 1.5 }], mode: "MAJU", tanggal: "2031-03-03", cara: "GANTI" }),
    ).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(await aksi.tambahLangkahAction({ planStageId: "t1", name: "QC", durationDays: "2" as never })).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    for (const f of Object.values(tiru.writer)) expect(f).not.toHaveBeenCalled();
  });

  it("penolakan penulis diteruskan apa adanya; galat tak terduga menjadi GAGAL dan tidak dilempar", async () => {
    tiru.writer.hapusLangkah.mockResolvedValueOnce({ ok: false, code: "LANGKAH_TIDAK_ADA" } as never);
    expect(await TULIS.hapusLangkahAction()).toEqual({ ok: false, code: "LANGKAH_TIDAK_ADA" });
    expect(tiru.revalidate).not.toHaveBeenCalled();

    const galat = vi.spyOn(console, "error").mockImplementation(() => {});
    tiru.writer.aturMulaiJadwal.mockRejectedValueOnce(new Error("db putus"));
    expect(await TULIS.aturMulaiJadwalAction()).toEqual({ ok: false, code: "GAGAL" });
    expect(galat).toHaveBeenCalled();
    galat.mockRestore();
  });
});

describe("aksi baca", () => {
  for (const [nama, jalankan] of Object.entries(BACA)) {
    it(`${nama}: tanpa production_planning:view → TANPA_AKSES, kueri tidak dijalankan`, async () => {
      keadaan.sesi = null;
      expect(await jalankan()).toEqual({ ok: false, code: "TANPA_AKSES" });
      izin("lead_time:view", "purchase_orders:view", "work_orders:view");
      expect(await jalankan()).toEqual({ ok: false, code: "TANPA_AKSES" });
      for (const f of Object.values(tiru.queries)) expect(f).not.toHaveBeenCalled();
    });
  }

  it("PO dan SPK di ruang kerja mengikuti izin penonton", async () => {
    izin("production_planning:view");
    expect(await BACA.ambilRuangKerjaTahapAction()).toEqual({ ok: true, data: { tahap: { id: "t1" } } });
    expect(tiru.queries.ruangKerjaTahap).toHaveBeenLastCalledWith("t1", { lihatPo: false, lihatSpk: false });
    izin("production_planning:view", "purchase_orders:view", "work_orders:view");
    await BACA.ambilRuangKerjaTahapAction();
    expect(tiru.queries.ruangKerjaTahap).toHaveBeenLastCalledWith("t1", { lihatPo: true, lihatSpk: true });
    izin("production_planning:view", "work_orders:view");
    await BACA.ambilTahapBulanAction();
    expect(tiru.queries.tahapBulan).toHaveBeenLastCalledWith(2026, 3, { lihatPo: false, lihatSpk: true });
  });

  it("tahap tidak ada → TAHAP_TIDAK_ADA; tahun/bulan/saringan rusak → ISIAN_TIDAK_SAH", async () => {
    tiru.queries.ruangKerjaTahap.mockResolvedValueOnce(null);
    expect(await BACA.ambilRuangKerjaTahapAction()).toEqual({ ok: false, code: "TAHAP_TIDAK_ADA" });
    expect(await aksi.ambilTahapBulanAction(2026, 13)).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(await aksi.ambilIkhtisarJadwalAction(1999)).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(await aksi.ambilFollowUpAction({ saring: "besok" as never })).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(await aksi.ambilKalenderProduksiAction(2026, 0)).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(tiru.queries.tahapBulan).not.toHaveBeenCalled();
    expect(tiru.queries.followUpProduksi).not.toHaveBeenCalled();
  });

  it("follow-up meneruskan saringan, pemasok, dan halaman", async () => {
    izin("production_planning:view");
    await aksi.ambilFollowUpAction({ saring: "minggu-ini", supplierId: "p1", halaman: 2 });
    expect(tiru.queries.followUpProduksi).toHaveBeenCalledWith({ saring: "minggu-ini", supplierId: "p1", halaman: 2 });
  });
});

describe("kalender kerja", () => {
  it("baca: production_planning:view ATAU lead_time:view", async () => {
    izin("lead_time:view");
    expect(await aksi.ambilHariKerjaAction()).toEqual({ ok: true, data: { hariKerja: [1, 2, 3, 4, 5], tanggalMerah: [] } });
    izin("production_planning:view");
    expect((await aksi.ambilHariKerjaAction()).ok).toBe(true);
    izin("purchase_orders:view");
    expect(await aksi.ambilHariKerjaAction()).toEqual({ ok: false, code: "TANPA_AKSES" });
  });

  it("ubah: production_planning:manage ATAU lead_time:manage; lihat saja ditolak tanpa menulis", async () => {
    izin("production_planning:view", "lead_time:view");
    expect(await aksi.simpanHariKerjaAction({ hariKerja: [1, 2, 3, 4, 5, 6] })).toEqual({ ok: false, code: "TANPA_AKSES" });
    expect(await aksi.simpanTanggalMerahAction({ daftar: [] })).toEqual({ ok: false, code: "TANPA_AKSES" });
    expect(tiru.pengaturan.simpanHariKerjaProduksi).not.toHaveBeenCalled();
    expect(tiru.pengaturan.simpanTanggalMerah).not.toHaveBeenCalled();

    izin("lead_time:manage");
    expect(await aksi.simpanHariKerjaAction({ hariKerja: [1, 2, 3, 4, 5, 6] })).toEqual({ ok: true, hariKerja: [1, 2, 3, 4, 5, 6] });
    expect(tiru.pengaturan.simpanHariKerjaProduksi).toHaveBeenCalledWith({ hariKerja: [1, 2, 3, 4, 5, 6], olehUserId: "u1" });
    izin("production_planning:manage");
    const daftar = [{ tanggal: "2026-12-25", nama: "Natal" }];
    expect(await aksi.simpanTanggalMerahAction({ daftar })).toEqual({ ok: true, tanggalMerah: [] });
    expect(tiru.pengaturan.simpanTanggalMerah).toHaveBeenCalledWith({ daftar, olehUserId: "u1" });
  });
});

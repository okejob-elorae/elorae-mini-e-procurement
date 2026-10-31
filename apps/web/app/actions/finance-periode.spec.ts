import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Aksi tutup buku: izin di setiap aksi, aktor dari `auth()`, isian dibaca
 * ketat, dan galat tak terduga jadi `{ ok:false, kode:"GAGAL" }` (tidak
 * pernah melempar ke layar). Penulisnya dipalsukan.
 */

const sesi = vi.hoisted(() => ({ ada: true, permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => (sesi.ada ? { user: { id: "aktor", permissions: sesi.permissions } } : null)) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const panggil = vi.hoisted(() => ({ daftar: [] as Array<[string, unknown]>, lempar: false }));
vi.mock("@/lib/finance/periode/writer", () => ({
  tutupBulan: vi.fn(async (isi: unknown) => {
    panggil.daftar.push(["tutupBulan", isi]);
    if (panggil.lempar) throw new Error("db mati");
    return { ok: true };
  }),
  bukaBulan: vi.fn(async (isi: unknown) => {
    panggil.daftar.push(["bukaBulan", isi]);
    return { ok: false, kode: "ALASAN_WAJIB" };
  }),
  tutupTahun: vi.fn(async (isi: unknown) => {
    panggil.daftar.push(["tutupTahun", isi]);
    return { ok: true, journalId: "j1", labaBersih: 5 };
  }),
  bukaTahun: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/finance/periode/queries", () => ({ bacaDaftarPeriksa: vi.fn(async () => ({ butir: [], bolehTutup: true, perluPersetujuan: false })) }));
vi.mock("@/lib/finance/periode/tanggal-mulai", () => ({
  bacaInfoTanggalMulai: vi.fn(async () => ({ tanggal: "2026-08-01", adaPeriodeTertutup: false })),
  hitungDampakTanggalMulai: vi.fn(async () => ({ jurnalOtomatisSebelum: 0, dokumenAkanDisapu: [], terpotong: false })),
  tetapkanTanggalMulai: vi.fn(async (isi: { tanggal: string }) => ({ ok: true, tanggal: isi.tanggal })),
}));
vi.mock("@/lib/finance/sapuan/runner", () => ({ jalankanSapuan: vi.fn(async () => ({ dilewati: "TANPA_TANGGAL_MULAI", sumber: [] })) }));

const aksi = await import("./finance-periode");

beforeEach(() => {
  sesi.ada = true;
  sesi.permissions = [];
  panggil.daftar = [];
  panggil.lempar = false;
});

describe("aksi tutup buku", () => {
  it("tanpa sesi atau tanpa journals:manage → TANPA_AKSES, penulis tidak dipanggil", async () => {
    sesi.ada = false;
    expect(await aksi.tutupBulanAction({ bulan: "2026-09", setujuPeringatan: false })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    sesi.ada = true;
    sesi.permissions = ["journals:view"];
    expect(await aksi.tutupBulanAction({ bulan: "2026-09", setujuPeringatan: false })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(await aksi.bukaTahunAction({ tahun: 2026, alasan: "x" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(await aksi.tetapkanTanggalMulaiAction({ tanggal: "2026-08-01", setuju: true })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(await aksi.jalankanSapuanAction()).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(panggil.daftar).toEqual([]);
    // Membaca daftar periksa cukup journals:view.
    expect((await aksi.bacaDaftarPeriksaAction({ bulan: "2026-09" })).ok).toBe(true);
  });

  it("aktor dari sesi, bulan dibaca ketat; galat tak terduga jadi GAGAL", async () => {
    sesi.permissions = ["journals:manage"];
    expect(await aksi.tutupBulanAction({ bulan: "2026-13", setujuPeringatan: true })).toEqual({ ok: false, kode: "ISIAN_TIDAK_SAH" });
    expect(await aksi.tutupBulanAction({ bulan: "2026-09", catatan: "beres", setujuPeringatan: true })).toEqual({ ok: true });
    expect(panggil.daftar[0]).toEqual([
      "tutupBulan",
      { tb: { tahun: 2026, bulan: 9 }, olehUserId: "aktor", catatan: "beres", setujuPeringatan: true },
    ]);
    expect(await aksi.bukaBulanAction({ bulan: "2026-09", alasan: "x" })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(await aksi.tutupTahunAction({ tahun: 2026 })).toEqual({ ok: true, journalId: "j1", labaBersih: 5 });
    expect(await aksi.tutupTahunAction({ tahun: 1900 })).toEqual({ ok: false, kode: "ISIAN_TIDAK_SAH" });
    panggil.lempar = true;
    expect(await aksi.tutupBulanAction({ bulan: "2026-09", setujuPeringatan: true })).toEqual({ ok: false, kode: "GAGAL" });
  });

  it("tanggal mulai: menyimpan butuh persetujuan; pratinjau menolak tanggal yang sama", async () => {
    sesi.permissions = ["journals:manage"];
    expect(await aksi.tetapkanTanggalMulaiAction({ tanggal: "2026-07-01", setuju: false })).toEqual({ ok: false, kode: "PERINGATAN_BELUM_DISETUJUI" });
    expect(await aksi.tetapkanTanggalMulaiAction({ tanggal: "2026-07-01", setuju: true })).toEqual({ ok: true, tanggal: "2026-07-01" });
    expect(await aksi.pratinjauTanggalMulaiAction({ tanggal: "2026-08-01" })).toEqual({ ok: false, kode: "TANGGAL_SAMA" });
    const p = await aksi.pratinjauTanggalMulaiAction({ tanggal: "2026-07-01" });
    expect(p).toMatchObject({ ok: true, tanggal: "2026-07-01", peringatan: [{ kunci: "mundur" }] });
  });
});

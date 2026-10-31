import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Pagar aksi pembayaran toko konsinyasi. Yang mencatat uang masuk adalah
 * keuangan (`journals:manage`), bukan admin konsinyasi — memisahkan keduanya
 * adalah aturan uang modul ini. Tanpa basis data: penulisnya ditiru, dan yang
 * diperiksa adalah apakah penulis sempat dipanggil dan dengan apa.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dicatat: [] as unknown[],
  dibatalkan: [] as unknown[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/konsinyasi/writer", () => ({
  catatPembayaranToko: vi.fn(async (input: unknown) => {
    state.dicatat.push(input);
    return { ok: true, id: "p1", sisa: 900_000 };
  }),
  batalkanPembayaranToko: vi.fn(async (input: unknown) => {
    state.dibatalkan.push(input);
    return { ok: false, alasan: "SUDAH_DIBATALKAN" };
  }),
}));
vi.mock("@/lib/konsinyasi/laporan-spg", () => ({ bahanLaporanSpg: vi.fn() }));

const aksi = await import("./konsinyasi");

const masuk = (permissions: string[]) => {
  state.sesi = { user: { id: "u1", permissions } };
};

beforeEach(() => {
  state.sesi = null;
  state.dicatat = [];
  state.dibatalkan = [];
});

const catat = (tanggal = "2026-10-03") =>
  aksi.catatPembayaranTokoAction({ cycleId: "c1", jumlah: 600_000, tanggal, cara: "transfer", catatan: "BCA" });

describe("catatPembayaranTokoAction", () => {
  it("menolak tanpa sesi dan menolak admin konsinyasi tanpa izin keuangan", async () => {
    expect(await catat()).toEqual({ ok: false, kode: "TANPA_AKSES" });
    masuk(["consignment:manage", "consignment:view", "receivables:manage"]);
    expect(await catat()).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(state.dicatat).toHaveLength(0);
  });

  it("keuangan mencatat; tanggal dibaca sebagai tengah malam WIB", async () => {
    masuk(["journals:manage"]);
    expect(await catat()).toEqual({ ok: true });
    expect(state.dicatat).toEqual([
      expect.objectContaining({
        cycleId: "c1",
        jumlah: 600_000,
        cara: "transfer",
        olehUserId: "u1",
        tanggal: new Date("2026-10-03T00:00:00+07:00"),
      }),
    ]);
  });

  it("tanggal yang tidak terbaca ditolak sebelum menyentuh penulis", async () => {
    masuk(["*"]);
    expect(await catat("03/10/2026")).toEqual({ ok: false, kode: "TANGGAL_TIDAK_VALID" });
    expect(state.dicatat).toHaveLength(0);
  });
});

describe("batalkanPembayaranTokoAction", () => {
  it("hanya keuangan, dan meneruskan alasan penolakan penulis", async () => {
    masuk(["consignment:manage"]);
    expect(await aksi.batalkanPembayaranTokoAction("p1", "salah toko")).toEqual({ ok: false, kode: "TANPA_AKSES" });
    masuk(["journals:manage"]);
    expect(await aksi.batalkanPembayaranTokoAction("p1", "salah toko")).toEqual({ ok: false, kode: "SUDAH_DIBATALKAN" });
    expect(state.dibatalkan).toEqual([{ paymentId: "p1", alasan: "salah toko", olehUserId: "u1" }]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Aksi pembayaran toko konsinyasi meneruskan kunci kiriman dialog ke penulis
 * (dibuat SEKALI per isian, lihat `TagihanKonsiCard`). Penulisnya ditiru —
 * perilaku kuncinya dites terhadap basis data di
 * `lib/konsinyasi/bayar-toko-kunci.test.ts`.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dicatat: [] as unknown[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/konsinyasi/writer", () => ({
  catatPembayaranToko: vi.fn(async (input: unknown) => {
    state.dicatat.push(input);
    return { ok: true, id: "p1", sisa: 900_000, ulang: true };
  }),
  batalkanPembayaranToko: vi.fn(),
}));
vi.mock("@/lib/konsinyasi/laporan-spg", () => ({ bahanLaporanSpg: vi.fn() }));

const aksi = await import("./konsinyasi");

beforeEach(() => {
  state.sesi = { user: { id: "u1", permissions: ["journals:manage"] } };
  state.dicatat = [];
});

const catat = (idempotencyKey?: string) =>
  aksi.catatPembayaranTokoAction({
    cycleId: "c1",
    jumlah: 600_000,
    tanggal: "2026-10-03",
    cara: "transfer",
    catatan: "BCA",
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
  });

describe("catatPembayaranTokoAction: kunci kiriman", () => {
  it("meneruskan kunci (dirapikan) ke penulis; kiriman ulang tetap { ok:true }", async () => {
    expect(await catat("  kunci-dialog-1  ")).toEqual({ ok: true });
    expect(state.dicatat).toEqual([expect.objectContaining({ idempotencyKey: "kunci-dialog-1", olehUserId: "u1" })]);
  });

  it("tanpa kunci, kunci kosong, atau kunci lebih dari 100 huruf → penulis menerima null", async () => {
    await catat();
    await catat("   ");
    await catat("x".repeat(101));
    expect(state.dicatat.map((d) => (d as { idempotencyKey: unknown }).idempotencyKey)).toEqual([null, null, null]);
  });
});

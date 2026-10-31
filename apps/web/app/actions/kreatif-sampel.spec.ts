import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Aksi pengiriman sampel: izin dari sesi (bukan dari klien), tanggal dibaca
 * sebagai hari WIB, dan rincian kurang stok sampai ke layar. Tanpa basis
 * data: penulis ditiru.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dikirim: [] as Record<string, unknown>[],
  hasil: { ok: true, id: "p1", dibuat: true, berangkat: true, diterima: false, ulang: false, tahap: null } as Record<string, unknown>,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/creative/sampel-writer", () => ({
  simpanPengiriman: vi.fn(async (input: Record<string, unknown>) => {
    state.dikirim.push(input);
    return state.hasil;
  }),
  tandaiDiterima: vi.fn(async (input: Record<string, unknown>) => {
    state.dikirim.push(input);
    return { ok: true, ulang: false, tahap: { dari: "SAMPEL_DIKIRIM", ke: "SAMPEL_DITERIMA" } };
  }),
  hapusPengiriman: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/creative/sampel-queries", () => ({
  barisAlamatKirim: vi.fn(async () => ({ baris: [], terpotong: false })),
  cariBarangSampel: vi.fn(async () => []),
}));

const aksi = await import("./kreatif-sampel");

const masuk = (permissions: string[]) => {
  state.sesi = { user: { id: "u-sesi", permissions } };
};

beforeEach(() => {
  state.sesi = null;
  state.dikirim = [];
  state.hasil = { ok: true, id: "p1", dibuat: true, berangkat: true, diterima: false, ulang: false, tahap: null };
});

describe("simpanPengirimanAction", () => {
  it("tanpa creative:manage ditolak dan penulis tidak dipanggil", async () => {
    masuk(["creative:view"]);
    expect(await aksi.simpanPengirimanAction({ kolaborasiId: "k1", trackingNo: "JNE1" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    state.sesi = null;
    expect(await aksi.simpanPengirimanAction({ kolaborasiId: "k1", trackingNo: "JNE1" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(state.dikirim).toHaveLength(0);
  });

  it("pengguna dari sesi; tanggal hari WIB; isian yang tidak dikirim tetap undefined", async () => {
    masuk(["creative:manage", "creative:view"]);
    const r = await aksi.simpanPengirimanAction({ kolaborasiId: "k1", trackingNo: "JNE1", sentAt: "2026-10-05", kunci: "f1" });
    expect(r).toEqual({ ok: true, id: "p1", berangkat: true, diterima: false, ulang: false, tahap: null });
    const isi = state.dikirim[0];
    expect(isi.olehUserId).toBe("u-sesi");
    expect((isi.sentAt as Date).toISOString()).toBe("2026-10-04T17:00:00.000Z");
    expect(isi.receivedAt).toBeUndefined();
    expect(isi.courier).toBeUndefined();
    expect(isi.baris).toBeUndefined();
    expect(isi.kunci).toBe("f1");
  });

  it("tanggal rusak ditolak sebelum menulis", async () => {
    masuk(["creative:manage", "creative:view"]);
    expect(await aksi.simpanPengirimanAction({ kolaborasiId: "k1", sentAt: "5 Okt" })).toEqual({ ok: false, kode: "TANGGAL_TIDAK_VALID" });
    expect(state.dikirim).toHaveLength(0);
  });

  it("rincian kurang stok diteruskan ke layar", async () => {
    masuk(["creative:manage", "creative:view"]);
    const kurang = [{ itemId: "i1", itemName: "Kaos", variantSku: "K-M", variantLabel: "M", diminta: 3, tersedia: 1 }];
    state.hasil = { ok: false, kode: "STOK_KURANG", kurang };
    expect(await aksi.simpanPengirimanAction({ kolaborasiId: "k1", trackingNo: "JNE1" })).toEqual({ ok: false, kode: "STOK_KURANG", kurang });
  });
});

describe("tandaiDiterimaAction & eksporAlamatKirimAction", () => {
  it("tandai diterima butuh creative:manage dan mengembalikan perpindahan tahap", async () => {
    masuk(["creative:view"]);
    expect(await aksi.tandaiDiterimaAction({ pengirimanId: "p1", receivedAt: "2026-10-05" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    masuk(["creative:view", "creative:manage"]);
    expect(await aksi.tandaiDiterimaAction({ pengirimanId: "p1", receivedAt: "2026-10-05" })).toEqual({
      ok: true,
      ulang: false,
      tahap: { dari: "SAMPEL_DIKIRIM", ke: "SAMPEL_DITERIMA" },
    });
    expect(state.dikirim[0]).toMatchObject({ pengirimanId: "p1", olehUserId: "u-sesi" });
  });

  it("ekspor alamat cukup creative:view dan menghasilkan CSV ber-BOM", async () => {
    masuk(["creative:view"]);
    const r = await aksi.eksporAlamatKirimAction({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.csv.startsWith("﻿Nama penerima")).toBe(true);
      expect(r.namaBerkas).toMatch(/^alamat-kirim-sampel-\d{4}-\d{2}-\d{2}\.csv$/);
    }
    state.sesi = null;
    expect(await aksi.eksporAlamatKirimAction({})).toEqual({ ok: false, kode: "TANPA_AKSES" });
  });
});

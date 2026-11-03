import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@elorae/db", () => ({ prisma: { jubelioPushDefaults: { count: vi.fn() } } }));
vi.mock("@/lib/jubelio/harga/writer", () => ({
  konfirmasiHargaJubelio: vi.fn(),
  kembalikanHargaErp: vi.fn(),
  kirimUlangHargaJubelio: vi.fn(),
}));
vi.mock("@/lib/jubelio/product-push", () => ({ fireProductPushNow: vi.fn() }));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { kembalikanHargaErp, kirimUlangHargaJubelio, konfirmasiHargaJubelio } from "@/lib/jubelio/harga/writer";
import { fireProductPushNow } from "@/lib/jubelio/product-push";
import { kembalikanHargaErpAction, kirimUlangHargaJubelioAction, konfirmasiHargaJubelioAction } from "./jubelio-harga";

/*
 * Aksi Jubelio → Konfirmasi harga (keputusan pemilik 2026-11-02): ketiganya digerbangi
 * `jubelio_prices:confirm`, izin yang sama dengan halaman dan tombolnya, dan isiannya diperiksa
 * sebelum penulis dipanggil.
 */

const sesi = (permissions: string[]) => ({ user: { id: "u1", permissions } }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(sesi(["jubelio_prices:confirm"]));
  vi.mocked(prisma.jubelioPushDefaults.count).mockResolvedValue(1 as never);
  vi.mocked(konfirmasiHargaJubelio).mockImplementation(async ({ itemId }) => ({ hasil: "DIKONFIRMASI", jenis: "UBAH", outboxId: `row-${itemId}` }));
});

describe("konfirmasiHargaJubelioAction", () => {
  it.each([
    ["tanpa sesi", null],
    ["tanpa izin konfirmasi harga", sesi(["settings_security:manage", "items:edit", "jubelio_admin:view"])],
  ])("%s → TANPA_AKSES, penulis tidak dipanggil", async (_label, s) => {
    vi.mocked(auth).mockResolvedValue(s as never);
    expect(await konfirmasiHargaJubelioAction([{ itemId: "i1", hargaErp: "100.00" }])).toEqual({ ok: false, code: "TANPA_AKSES" });
    expect(konfirmasiHargaJubelio).not.toHaveBeenCalled();
  });

  it("admin (wildcard) boleh", async () => {
    vi.mocked(auth).mockResolvedValue(sesi(["*"]));
    expect(await konfirmasiHargaJubelioAction([{ itemId: "i1", hargaErp: "100.00" }])).toMatchObject({ ok: true });
  });

  it.each([
    ["bukan larik", { itemId: "i1", hargaErp: "100.00" }],
    ["larik kosong", []],
    ["lebih dari 200 baris", Array.from({ length: 201 }, (_, i) => ({ itemId: `i${i}`, hargaErp: "100.00" }))],
    ["harga bukan teks angka", [{ itemId: "i1", hargaErp: 100 }]],
    ["harga ilmiah", [{ itemId: "i1", hargaErp: "1e5" }]],
    ["id kosong", [{ itemId: "", hargaErp: "100.00" }]],
    ["id dobel", [{ itemId: "i1", hargaErp: "100.00" }, { itemId: "i1", hargaErp: "100.00" }]],
  ])("%s → ISIAN_TIDAK_SAH", async (_label, isian) => {
    expect(await konfirmasiHargaJubelioAction(isian)).toMatchObject({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(konfirmasiHargaJubelio).not.toHaveBeenCalled();
  });

  it("tanpa pengaturan bawaan kirim produk → BAWAAN_BELUM_ADA", async () => {
    vi.mocked(prisma.jubelioPushDefaults.count).mockResolvedValue(0 as never);
    expect(await konfirmasiHargaJubelioAction([{ itemId: "i1", hargaErp: "100.00" }])).toMatchObject({ ok: false, code: "BAWAAN_BELUM_ADA" });
    expect(konfirmasiHargaJubelio).not.toHaveBeenCalled();
  });

  it("meneruskan hasil per baris dengan pelaku dari sesi, dan mengirim langsung hanya yang dikonfirmasi", async () => {
    vi.mocked(konfirmasiHargaJubelio)
      .mockResolvedValueOnce({ hasil: "DIKONFIRMASI", jenis: "UBAH", outboxId: "row-a" })
      .mockResolvedValueOnce({ hasil: "HARGA_BERUBAH" })
      .mockResolvedValueOnce({ hasil: "DIKONFIRMASI", jenis: "BARU", outboxId: "row-c" });

    const r = await konfirmasiHargaJubelioAction([
      { itemId: "a", hargaErp: "100.00" },
      { itemId: "b", hargaErp: null },
      { itemId: "c", hargaErp: "150000" },
    ]);

    expect(r).toEqual({
      ok: true,
      data: [
        { itemId: "a", hasil: "DIKONFIRMASI" },
        { itemId: "b", hasil: "HARGA_BERUBAH" },
        { itemId: "c", hasil: "DIKONFIRMASI" },
      ],
    });
    expect(vi.mocked(konfirmasiHargaJubelio).mock.calls.map(([isi]) => isi)).toEqual([
      { itemId: "a", hargaErpDiharapkan: "100.00", olehUserId: "u1" },
      { itemId: "b", hargaErpDiharapkan: null, olehUserId: "u1" },
      { itemId: "c", hargaErpDiharapkan: "150000", olehUserId: "u1" },
    ]);
    expect(vi.mocked(fireProductPushNow).mock.calls).toEqual([
      ["row-a", "u1"],
      ["row-c", "u1"],
    ]);
  });

  it("di atas 10 konfirmasi tidak ada kiriman langsung — poller yang mengambil", async () => {
    const isian = Array.from({ length: 11 }, (_, i) => ({ itemId: `i${i}`, hargaErp: "100.00" }));
    const r = await konfirmasiHargaJubelioAction(isian);
    expect(r.ok && r.data).toHaveLength(11);
    expect(fireProductPushNow).not.toHaveBeenCalled();
  });
});

describe("kembalikanHargaErpAction", () => {
  it("digerbangi izin yang sama", async () => {
    vi.mocked(auth).mockResolvedValue(sesi(["items:edit"]));
    expect(await kembalikanHargaErpAction({ itemId: "i1", hargaErp: "100.00" })).toEqual({ ok: false, code: "TANPA_AKSES" });
    expect(kembalikanHargaErp).not.toHaveBeenCalled();
  });

  it("menolak isian yang salah bentuk", async () => {
    expect(await kembalikanHargaErpAction({ itemId: "i1", hargaErp: "-5" })).toMatchObject({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(await kembalikanHargaErpAction(null)).toMatchObject({ ok: false, code: "ISIAN_TIDAK_SAH" });
  });

  it("kembalikan: pelaku dari sesi, kiriman langsung bila berhasil", async () => {
    vi.mocked(kembalikanHargaErp).mockResolvedValue({ hasil: "DIKEMBALIKAN", outboxId: "row-r" });
    expect(await kembalikanHargaErpAction({ itemId: "i1", hargaErp: "120000.00", olehUserId: "penyusup" })).toEqual({
      ok: true,
      data: { hasil: "DIKEMBALIKAN", outboxId: "row-r" },
    });
    expect(kembalikanHargaErp).toHaveBeenCalledWith({ itemId: "i1", hargaErpDiharapkan: "120000.00", olehUserId: "u1" });
    expect(fireProductPushNow).toHaveBeenCalledWith("row-r", "u1");
  });
});

/*
 * Jawaban pemilik P74 (2026-11-02): satu-satunya jalan keluar beda harga, digerbangi izin yang sama.
 * Satu baris per tekan (rancangan R26) — isian berupa larik ditolak, jadi tidak ada penimpaan massal.
 */
describe("kirimUlangHargaJubelioAction", () => {
  const isian = { itemId: "i1", berubahPada: "2026-11-03T01:00:00.000Z" };

  it.each([
    ["tanpa sesi", null],
    ["tanpa izin konfirmasi harga", sesi(["items:edit", "settings_security:manage"])],
  ])("%s → TANPA_AKSES, penulis tidak dipanggil", async (_label, s) => {
    vi.mocked(auth).mockResolvedValue(s as never);
    expect(await kirimUlangHargaJubelioAction(isian)).toEqual({ ok: false, code: "TANPA_AKSES" });
    expect(kirimUlangHargaJubelio).not.toHaveBeenCalled();
  });

  it.each([
    ["larik beberapa baris", [isian, { itemId: "i2", berubahPada: null }]],
    ["larik satu baris", [isian]],
    ["kosong", null],
    ["id kosong", { itemId: "", berubahPada: null }],
    ["waktu tak terbaca", { itemId: "i1", berubahPada: "kemarin" }],
    ["waktu bukan teks", { itemId: "i1", berubahPada: 5 }],
  ])("%s → ISIAN_TIDAK_SAH", async (_label, salah) => {
    expect(await kirimUlangHargaJubelioAction(salah)).toMatchObject({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(kirimUlangHargaJubelio).not.toHaveBeenCalled();
  });

  it("tanpa pengaturan bawaan kirim produk → BAWAAN_BELUM_ADA", async () => {
    vi.mocked(prisma.jubelioPushDefaults.count).mockResolvedValue(0 as never);
    expect(await kirimUlangHargaJubelioAction(isian)).toMatchObject({ ok: false, code: "BAWAAN_BELUM_ADA" });
    expect(kirimUlangHargaJubelio).not.toHaveBeenCalled();
  });

  it("dikirim ulang: pelaku dari sesi, kiriman langsung", async () => {
    vi.mocked(kirimUlangHargaJubelio).mockResolvedValue({ hasil: "DIKIRIM_ULANG", outboxId: "row-a" });
    expect(await kirimUlangHargaJubelioAction({ ...isian, olehUserId: "penyusup" })).toEqual({
      ok: true,
      data: { hasil: "DIKIRIM_ULANG", outboxId: "row-a" },
    });
    expect(kirimUlangHargaJubelio).toHaveBeenCalledWith({
      itemId: "i1",
      berubahPadaDiharapkan: "2026-11-03T01:00:00.000Z",
      olehUserId: "u1",
    });
    expect(vi.mocked(fireProductPushNow).mock.calls).toEqual([["row-a", "u1"]]);
  });

  it("ditolak penulis: hasilnya diteruskan, tidak ada kiriman", async () => {
    vi.mocked(kirimUlangHargaJubelio).mockResolvedValue({ hasil: "TERBACA_BERUBAH" });
    expect(await kirimUlangHargaJubelioAction({ itemId: "b", berubahPada: null })).toEqual({
      ok: true,
      data: { hasil: "TERBACA_BERUBAH" },
    });
    expect(kirimUlangHargaJubelio).toHaveBeenCalledWith({ itemId: "b", berubahPadaDiharapkan: null, olehUserId: "u1" });
    expect(fireProductPushNow).not.toHaveBeenCalled();
  });
});

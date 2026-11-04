import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({ ok: true })) }));
// Kueri asli tetap dipakai; satu tes menggantinya sekali untuk meniru potret yang dibaca sebelum
// pemetaannya dihapus (jendela antara kueri dan transaksi).
vi.mock("./queries", async (importOriginal) => {
  const asli = await importOriginal<typeof import("./queries")>();
  return { ...asli, idKirimanTertahanSiapDilepas: vi.fn(asli.idKirimanTertahanSiapDilepas) };
});

import { lepaskanKirimanHargaTertahan } from "./lepas-tahanan";
import { idKirimanTertahanSiapDilepas } from "./queries";
import { buatFixtureHarga } from "./test-fixtures";

/*
 * Kiriman yang ditahan karena beda harga dilepas begitu bedanya selesai (jawaban pemilik P75,
 * 2026-11-02). Sapuannya SELALU dibatasi barang milik tes ini — basis data uji dipakai bersama.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const jeda = (ms: number) => new Promise((r) => setTimeout(r, ms));

d("lepaskanKirimanHargaTertahan (test bed only)", () => {
  const fx = buatFixtureHarga();
  const tadi = new Date("2026-11-03T01:00:00.000Z");
  const DITAHAN = "price_differs_held";

  beforeEach(async () => {
    await fx.siapkan();
  });

  afterEach(async () => {
    await fx.bersihkan();
  });

  const baris = (itemId: string) =>
    prisma.jubelioOutbox.findMany({
      where: { entityId: seededId(itemId), entityType: "product_push" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { status: true, skipReason: true },
    });

  const sepakat = { terpetakan: true, jubelioConfirmedPrice: 100_000, terbacaPada: tadi, jubelioTertinggi: 100_000, jubelioTerendah: 100_000 };

  it("melepas sekali barang yang ditahan dan sudah tidak beda", async () => {
    const id = await fx.barang(sepakat);
    await fx.kiriman(id, { status: "SKIPPED", skipReason: DITAHAN });

    expect(await lepaskanKirimanHargaTertahan({ itemIds: [id] })).toEqual({ dilepas: 1, dilewati: 0, gagal: 0 });
    expect((await baris(id)).map((b) => b.status)).toEqual(["SKIPPED", "PENDING"]);
    // Kiriman terakhirnya kini PENDING: putaran berikutnya tidak melepas lagi.
    expect(await lepaskanKirimanHargaTertahan({ itemIds: [id] })).toEqual({ dilepas: 0, dilewati: 0, gagal: 0 });
    expect(await baris(id)).toHaveLength(2);
  });

  it("membiarkan barang yang masih beda, yang kiriman terakhirnya DONE, dan yang punya kiriman berjalan", async () => {
    const beda = await fx.barang({ ...sepakat, jubelioTertinggi: 125_000, jubelioTerendah: 125_000 });
    await fx.kiriman(beda, { status: "SKIPPED", skipReason: DITAHAN });

    const selesai = await fx.barang(sepakat);
    await fx.kiriman(selesai, { status: "SKIPPED", skipReason: DITAHAN, createdAt: new Date(Date.now() - 60_000) });
    await fx.kiriman(selesai, { status: "DONE" });

    const berjalan = await fx.barang(sepakat);
    await fx.kiriman(berjalan, { status: "PENDING", createdAt: new Date(Date.now() - 60_000) });
    await fx.kiriman(berjalan, { status: "SKIPPED", skipReason: DITAHAN });

    expect(await lepaskanKirimanHargaTertahan({ itemIds: [beda, selesai, berjalan] })).toEqual({ dilepas: 0, dilewati: 0, gagal: 0 });
    expect(await baris(beda)).toHaveLength(1);
    expect(await baris(selesai)).toHaveLength(2);
    expect(await baris(berjalan)).toHaveLength(2);
  });

  it("tidak melepas barang yang pemetaannya sudah dihapus dari Jubelio — kiriman penuh akan membuat produknya lagi", async () => {
    const id = await fx.barang(sepakat);
    await fx.kiriman(id, { status: "SKIPPED", skipReason: DITAHAN });
    await prisma.jubelioProductMapping.deleteMany({ where: { itemId: seededId(id) } });

    expect(await lepaskanKirimanHargaTertahan({ itemIds: [id] })).toEqual({ dilepas: 0, dilewati: 0, gagal: 0 });
    expect(await baris(id)).toEqual([{ status: "SKIPPED", skipReason: DITAHAN }]);
  });

  it("pemetaan terhapus di antara kueri dan transaksi: dibaca ulang, tidak dilepas", async () => {
    const id = await fx.barang(sepakat);
    await fx.kiriman(id, { status: "SKIPPED", skipReason: DITAHAN });
    expect(await idKirimanTertahanSiapDilepas({ hanyaBarang: [id] })).toEqual([id]);
    await prisma.jubelioProductMapping.deleteMany({ where: { itemId: seededId(id) } });
    // Potret kueri yang diambil sebelum pemetaannya hilang.
    vi.mocked(idKirimanTertahanSiapDilepas).mockResolvedValueOnce([id]);

    expect(await lepaskanKirimanHargaTertahan({ itemIds: [id] })).toEqual({ dilepas: 0, dilewati: 1, gagal: 0 });
    expect(await baris(id)).toEqual([{ status: "SKIPPED", skipReason: DITAHAN }]);
  });

  it.each([0, 5])("dua sapuan bersamaan (jeda %i ms): tepat satu kiriman baru", async (ms) => {
    const id = await fx.barang(sepakat);
    await fx.kiriman(id, { status: "SKIPPED", skipReason: DITAHAN });

    const hasil = await Promise.all([
      lepaskanKirimanHargaTertahan({ itemIds: [id] }),
      jeda(ms).then(() => lepaskanKirimanHargaTertahan({ itemIds: [id] })),
    ]);
    expect(hasil.reduce((n, h) => n + h.dilepas, 0)).toBe(1);
    expect((await baris(id)).filter((b) => b.status === "PENDING")).toHaveLength(1);
  });
});

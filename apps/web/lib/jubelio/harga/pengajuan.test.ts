import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@elorae/db";

vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({ ok: true })) }));

import { ajukanKeJubelio, dataPengajuanJubelio } from "./pengajuan";
import { konfirmasiHargaJubelio } from "./writer";
import { buatFixtureHarga } from "./test-fixtures";

/*
 * Membuat produk di Jubelio adalah pengajuan yang menunggu konfirmasi harga (keputusan pemilik
 * 2026-11-02). Diuji terhadap basis data sungguhan, termasuk dua pengajuan bersamaan dan pengajuan
 * ulang tepat sesudah konfirmasi.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

describe("dataPengajuanJubelio", () => {
  it("menandai waktu dan pengaju untuk disebar ke data pembuatan barang", () => {
    const sekarang = new Date("2026-11-02T03:00:00.000Z");
    expect(dataPengajuanJubelio("u1", sekarang)).toEqual({ jubelioCreateRequestedAt: sekarang, jubelioCreateRequestedById: "u1" });
    expect(dataPengajuanJubelio(null, sekarang)).toEqual({ jubelioCreateRequestedAt: sekarang, jubelioCreateRequestedById: null });
  });
});

d("ajukanKeJubelio (test bed only)", () => {
  const fx = buatFixtureHarga();

  beforeEach(async () => {
    await fx.siapkan();
  });

  afterEach(async () => {
    await fx.bersihkan();
  });

  it("menandai barang jadi ERP yang belum di Jubelio; pengajuan kedua → SUDAH_DIAJUKAN", async () => {
    const id = await fx.barang({});
    expect(await ajukanKeJubelio([id], fx.keadaan.userId)).toEqual([{ itemId: id, hasil: "DIAJUKAN" }]);
    const b = await fx.baca(id);
    expect(b.diajukanPada).toBeInstanceOf(Date);
    expect(b.diajukanOleh).toBe(fx.keadaan.userId);
    expect(await ajukanKeJubelio([id], fx.keadaan.userLainId)).toEqual([{ itemId: id, hasil: "SUDAH_DIAJUKAN" }]);
    expect((await fx.baca(id)).diajukanOleh).toBe(fx.keadaan.userId);
  });

  it("menolak barang yang sudah di Jubelio, yang kirimannya masih berjalan, bukan barang jadi ERP, atau tidak ada", async () => {
    const terpetakan = await fx.barang({ terpetakan: true, jubelioConfirmedPrice: 100_000 });
    const dikirim = await fx.barang({});
    await prisma.jubelioOutbox.create({ data: { entityType: "product_push", entityId: dikirim, payload: {}, status: "PENDING" } });
    const kain = await fx.barang({ type: "FABRIC" });
    const ingest = await fx.barang({ source: "JUBELIO_INGEST" });

    const hasil = await ajukanKeJubelio([terpetakan, dikirim, kain, ingest, "tidak-ada"], fx.keadaan.userId);
    expect(new Map(hasil.map((h) => [h.itemId, h.hasil]))).toEqual(
      new Map([
        [terpetakan, "SUDAH_DI_JUBELIO"],
        [dikirim, "SEDANG_DIKIRIM"],
        [kain, "BUKAN_BARANG_JADI_ERP"],
        [ingest, "BUKAN_BARANG_JADI_ERP"],
        ["tidak-ada", "TIDAK_DITEMUKAN"],
      ]),
    );
    for (const id of [terpetakan, dikirim, kain, ingest]) expect((await fx.baca(id)).diajukanPada, id).toBeNull();
  });

  it.each([0, 5])("dua pengajuan bersamaan (jeda %i ms): tepat satu DIAJUKAN", async (ms) => {
    const id = await fx.barang({});
    const hasil = await Promise.all([
      ajukanKeJubelio([id], fx.keadaan.userId),
      new Promise((r) => setTimeout(r, ms)).then(() => ajukanKeJubelio([id], fx.keadaan.userLainId)),
    ]);
    expect(hasil.map((h) => h[0].hasil).sort()).toEqual(["DIAJUKAN", "SUDAH_DIAJUKAN"]);
  });

  it("pengajuan ulang tepat sesudah konfirmasi produk baru → SEDANG_DIKIRIM, kiriman pembuatnya tidak tertahan", async () => {
    const id = await fx.barang({ sellingPrice: 150_000 });
    await ajukanKeJubelio([id], fx.keadaan.userId);
    const konfirmasi = await konfirmasiHargaJubelio({ itemId: id, hargaErpDiharapkan: "150000.00", olehUserId: fx.keadaan.userId });
    expect(konfirmasi.hasil).toBe("DIKONFIRMASI");

    expect(await ajukanKeJubelio([id], fx.keadaan.userId)).toEqual([{ itemId: id, hasil: "SEDANG_DIKIRIM" }]);
    // Tanda pengajuan tetap kosong, jadi handler apps/api akan membuat produknya.
    expect((await fx.baca(id)).diajukanPada).toBeNull();
  });
});

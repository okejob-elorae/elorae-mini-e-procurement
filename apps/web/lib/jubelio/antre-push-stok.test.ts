import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Penolong antrean push stok ke Jubelio, terhadap basis data uji sungguhan.
 *
 * Yang dibuktikan:
 *  - barang yang punya pemetaan Jubelio mendapat SATU baris `stock_push`
 *    PENDING; barang tanpa pemetaan tidak mendapat apa pun;
 *  - memanggil lagi selagi baris PENDING masih menunggu tidak menambah baris
 *    (baris itu akan membaca stok terbaru saat diproses);
 *  - begitu baris lama sudah diproses (DONE), perubahan berikutnya mendapat
 *    baris baru;
 *  - kegagalan basis data tidak pernah dilempar ke pemanggil — dokumen stok
 *    sudah tercatat, push hanya pelengkap.
 */

const tendang = vi.hoisted(() => ({ panggilan: [] as string[] }));
vi.mock("@/lib/internal-api", () => ({
  apiFetch: vi.fn(async (_m: string, path: string) => {
    tendang.panggilan.push(path);
    return { ok: true, status: 200 };
  }),
}));

const { antrekanPushStok, SUMBER_PUSH_STOK } = await import("./antre-push-stok");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `APS-${Math.random().toString(36).slice(2, 9)}`;
const angkaAcak = () => 1_500_000_000 + Math.floor(Math.random() * 400_000_000);

d("antrekanPushStok (test bed only)", () => {
  let uomId = "";
  let itemTerpetakan = "";
  let itemLepas = "";

  beforeAll(async () => {
    uomId = "";
    itemTerpetakan = "";
    itemLepas = "";
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemTerpetakan = (
      await prisma.item.create({
        data: { sku: `${tag}-A`, nameId: "Kaos A", nameEn: "Tee A", type: "FINISHED_GOOD", uomId, isActive: true },
      })
    ).id;
    itemLepas = (
      await prisma.item.create({
        data: { sku: `${tag}-B`, nameId: "Kaos B", nameEn: "Tee B", type: "FINISHED_GOOD", uomId, isActive: true },
      })
    ).id;
    await prisma.jubelioProductMapping.create({
      data: {
        itemId: itemTerpetakan,
        jubelioItemGroupId: angkaAcak(),
        jubelioItemId: angkaAcak(),
        jubelioItemCode: `${tag}-A`,
        erpVariantSku: "",
      },
    });
  });

  beforeEach(async () => {
    tendang.panggilan = [];
    await prisma.jubelioOutbox.deleteMany({
      where: { entityType: "stock_push", entityId: { in: seededIds([itemTerpetakan, itemLepas]) } },
    });
  });

  afterAll(async () => {
    const ids = seededIds([itemTerpetakan, itemLepas].filter(Boolean));
    await prisma.jubelioOutbox.deleteMany({ where: { entityType: "stock_push", entityId: { in: seededIds(ids) } } });
    await prisma.jubelioProductMapping.deleteMany({ where: { itemId: { in: seededIds(ids) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds(ids) } } });
    if (uomId) await prisma.uOM.delete({ where: { id: uomId } });
  });

  async function barisPush() {
    return prisma.jubelioOutbox.findMany({
      where: { entityType: "stock_push", entityId: { in: seededIds([itemTerpetakan, itemLepas]) } },
      select: { id: true, entityId: true, status: true, payload: true },
    });
  }

  it("hanya barang terpetakan yang diantrekan, dengan sumber dokumennya", async () => {
    const hasil = await antrekanPushStok([itemTerpetakan, itemLepas, itemTerpetakan], {
      sumber: "GRN",
      ref: "GRN/2026/10/0001",
    });

    const baris = await barisPush();
    expect(baris).toHaveLength(1);
    expect(baris[0].entityId).toBe(itemTerpetakan);
    expect(baris[0].status).toBe("PENDING");
    expect(baris[0].payload).toMatchObject({ sumber: "GRN", ref: "GRN/2026/10/0001" });
    expect(hasil).toMatchObject({ diantrekan: [itemTerpetakan], tanpaPemetaan: [itemLepas], gagal: false });
    // Api ditendang supaya tidak menunggu poller.
    expect(tendang.panggilan).toEqual([`/jubelio/outbox/enqueue/${baris[0].id}`]);
  });

  it("baris PENDING yang masih menunggu tidak digandakan", async () => {
    await antrekanPushStok([itemTerpetakan], { sumber: "ADJUSTMENT" });
    const kedua = await antrekanPushStok([itemTerpetakan], { sumber: "ADJUSTMENT" });

    expect(await barisPush()).toHaveLength(1);
    expect(kedua).toMatchObject({ diantrekan: [], sudahAntre: [itemTerpetakan], gagal: false });
  });

  it("baris lama yang sudah diproses tidak menahan perubahan baru", async () => {
    await antrekanPushStok([itemTerpetakan], { sumber: "GRN" });
    await prisma.jubelioOutbox.updateMany({
      where: { entityType: "stock_push", entityId: seededId(itemTerpetakan) },
      data: { status: "DONE", processedAt: new Date() },
    });

    await antrekanPushStok([itemTerpetakan], { sumber: "FG_RECEIPT" });

    const baris = await barisPush();
    expect(baris.map((b) => b.status).sort()).toEqual(["DONE", "PENDING"]);
  });

  it("gagal menulis antrean tidak dilempar ke pemanggil", async () => {
    const galat = vi.spyOn(console, "error").mockImplementation(() => {});
    const klienRusak = {
      jubelioProductMapping: { findMany: async () => [{ itemId: itemTerpetakan }] },
      jubelioOutbox: {
        findMany: async () => [],
        create: async () => {
          throw new Error("koneksi putus");
        },
      },
    };

    const hasil = await antrekanPushStok([itemTerpetakan], {
      sumber: "GRN",
      client: klienRusak as unknown as typeof prisma,
    });

    expect(hasil.gagal).toBe(true);
    expect(hasil.diantrekan).toEqual([]);
    expect(galat).toHaveBeenCalled();
    galat.mockRestore();
    expect(await barisPush()).toHaveLength(0);
  });

  it("opsi yang rusak (klien gagal diambil) tidak dilempar ke pemanggil", async () => {
    const galat = vi.spyOn(console, "error").mockImplementation(() => {});
    const opsiRusak = {
      sumber: "GRN" as const,
      get client(): never {
        throw new Error("klien tidak tersedia");
      },
    };

    const hasil = await antrekanPushStok([itemTerpetakan], opsiRusak);

    expect(hasil).toMatchObject({ diantrekan: [], gagal: true });
    expect(galat).toHaveBeenCalled();
    galat.mockRestore();
    expect(await barisPush()).toHaveLength(0);
  });

  it("sumber dokumen nyata tercatat apa adanya di payload", async () => {
    await antrekanPushStok([itemTerpetakan], { sumber: "INDEN", ref: "rilis inden UJI" });

    const baris = await barisPush();
    expect(baris).toHaveLength(1);
    expect(baris[0].payload).toMatchObject({ sumber: "INDEN", ref: "rilis inden UJI" });
  });

  it("daftar kosong tidak menyentuh basis data", async () => {
    const hasil = await antrekanPushStok(["", ""], { sumber: "GRN" });
    expect(hasil).toEqual({ diantrekan: [], sudahAntre: [], tanpaPemetaan: [], barisGabungan: [], gagal: false });
  });
});

/*
 * Barang bervarian di Jubelio yang stoknya masih (sebagian) di baris gabungan
 * null/"" — misalnya penerimaan barang jadi tanpa rincian ukuran.
 *
 * Penangan push api (`stock-push.handler.ts`) kini MELEWATI baris gabungan
 * barang bervarian sendiri dan hanya mengirim baris per varian ke kodenya
 * masing-masing. Jadi barang ini TETAP diantrekan: kalau tidak, perubahan stok
 * ukuran M (5 pcs) tidak pernah sampai ke marketplace hanya karena barang itu
 * juga punya 12 pcs di baris tanpa ukuran. Barangnya tetap dilaporkan di
 * `barisGabungan` supaya stok tanpa ukuran itu terlihat.
 */
d("antrekanPushStok: barang bervarian dengan stok di baris gabungan (test bed only)", () => {
  const tag2 = `APV-${Math.random().toString(36).slice(2, 9)}`;
  let uomId = "";
  let itemId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag2}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tag2, nameId: "Kaos varian", nameEn: "Variant tee", type: "FINISHED_GOOD", uomId, isActive: true },
      })
    ).id;
    for (const ukuran of ["M", "L"]) {
      await prisma.jubelioProductMapping.create({
        data: {
          itemId,
          jubelioItemGroupId: angkaAcak(),
          jubelioItemId: angkaAcak(),
          jubelioItemCode: `${tag2}-${ukuran}`,
          erpVariantSku: `${tag2}-${ukuran}`,
        },
      });
    }
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: `${tag2}-M`, qtyOnHand: 5, avgCost: 40_000, totalValue: 200_000 },
    });
  });

  afterEach(async () => {
    await prisma.jubelioOutbox.deleteMany({ where: { entityType: "stock_push", entityId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.jubelioProductMapping.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  async function jumlahAntrean() {
    return prisma.jubelioOutbox.count({ where: { entityType: "stock_push", entityId: seededId(itemId) } });
  }

  it("baris gabungan berisi 12 pcs: TETAP diantrekan (baris per ukuran dikirim api), dilaporkan", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 12, avgCost: 40_000, totalValue: 480_000 },
    });
    const peringatan = vi.spyOn(console, "warn").mockImplementation(() => {});

    const hasil = await antrekanPushStok([itemId], { sumber: "FG_RECEIPT", ref: "FG/UJI" });

    expect(hasil).toMatchObject({ diantrekan: [itemId], barisGabungan: [itemId], gagal: false });
    expect(await jumlahAntrean()).toBe(1);
    const baris = await prisma.jubelioOutbox.findFirstOrThrow({
      where: { entityType: "stock_push", entityId: seededId(itemId) },
      select: { status: true, payload: true },
    });
    expect(baris).toMatchObject({ status: "PENDING", payload: { sumber: "FG_RECEIPT", ref: "FG/UJI" } });
    expect(peringatan).toHaveBeenCalled();
    peringatan.mockRestore();
  });

  it("baris gabungan hanya menahan cadangan (0 pcs, 2 ditahan): tetap diantrekan", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: "", qtyOnHand: 0, reservedQty: 2, avgCost: 40_000, totalValue: 0 },
    });
    const peringatan = vi.spyOn(console, "warn").mockImplementation(() => {});

    const hasil = await antrekanPushStok([itemId], { sumber: "GRN" });

    expect(hasil).toMatchObject({ diantrekan: [itemId], barisGabungan: [itemId] });
    expect(await jumlahAntrean()).toBe(1);
    peringatan.mockRestore();
  });

  it("baris gabungan berisi stok + baris PENDING lama: tidak digandakan", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 12, avgCost: 40_000, totalValue: 480_000 },
    });
    const peringatan = vi.spyOn(console, "warn").mockImplementation(() => {});

    await antrekanPushStok([itemId], { sumber: "GRN" });
    const kedua = await antrekanPushStok([itemId], { sumber: "GRN" });

    expect(kedua).toMatchObject({ diantrekan: [], sudahAntre: [itemId], barisGabungan: [itemId] });
    expect(await jumlahAntrean()).toBe(1);
    peringatan.mockRestore();
  });

  it("baris gabungan kosong sisa pembuatan barang (0 pcs, 0 ditahan) tidak menghalangi", async () => {
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 0, avgCost: 0, totalValue: 0 },
    });

    const hasil = await antrekanPushStok([itemId], { sumber: "GRN" });

    expect(hasil).toMatchObject({ diantrekan: [itemId], barisGabungan: [] });
    expect(await jumlahAntrean()).toBe(1);
  });
});

describe("SUMBER_PUSH_STOK", () => {
  it("memuat sumber nyata para penulis stok, bukan hanya ADJUSTMENT pengganti", () => {
    for (const sumber of [
      "GRN",
      "GRN_DECLINE",
      "FG_RECEIPT",
      "ADJUSTMENT",
      "SALES_RETURN_ACCEPT",
      "NRI",
      "KONSI_TRANSFER",
      "KIRIM_PUTUS",
      "PESANAN_LAPANGAN",
      "VAN",
      "TUKAR",
      "GUDANG_RUSAK",
      "RETUR_PEMASOK",
      "INDEN",
    ]) {
      expect(SUMBER_PUSH_STOK).toContain(sumber);
    }
    expect(new Set(SUMBER_PUSH_STOK).size).toBe(SUMBER_PUSH_STOK.length);
  });
});

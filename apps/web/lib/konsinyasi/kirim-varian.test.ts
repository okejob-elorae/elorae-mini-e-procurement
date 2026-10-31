import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { kirimTitipan } from "./writer";
import { muatKiriman } from "@/lib/spg/kiriman";
import { terimaKiriman } from "@/lib/spg/stok-writer";

/**
 * "Kirim titipan" per varian, sekali kirim sekali potong, terhadap basis data sungguhan.
 *
 *   gudang S 20, M 20 (Rp40.000/pcs)
 *   kirim M 5          → M 15, S tetap 20; baris kiriman & tanda terima SPG membawa varian M
 *   klik ganda (kunci sama, bersamaan) → satu kiriman, M 20→15 sekali
 *   M 8 + M 8 dari stok 12 → ditolak, rincian "M: diminta 16, tersedia 12"
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("kirim titipan per varian (basis data)", () => {
  const tag = `KVR${Math.random().toString(36).slice(2, 8)}`;
  const S = `${tag}-S`;
  const M = `${tag}-M`;
  let tokoId = "";
  let tokoLainId = "";
  let uomId = "";
  let barangId = "";
  let adminId = "";
  let kirimIds: string[] = [];
  let receiptIds: string[] = [];

  beforeEach(async () => {
    tokoId = "";
    tokoLainId = "";
    uomId = "";
    barangId = "";
    adminId = "";
    kirimIds = [];
    receiptIds = [];
    tokoId = (await prisma.store.create({ data: { code: `${tag}-T`, name: `${tag} Toko`, address: "uji", termsType: "KONSI", isActive: true } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    barangId = (
      await prisma.item.create({
        data: {
          sku: `${tag}-I`,
          nameId: `${tag} Blus`,
          nameEn: `${tag} Blouse`,
          type: "FINISHED_GOOD",
          uomId,
          isActive: true,
          variants: [
            { sku: S, size: "S" },
            { sku: M, size: "M" },
          ],
        },
      })
    ).id;
    adminId = (await prisma.user.create({ data: { email: `${tag}@uji.local`.toLowerCase(), name: `${tag} Admin`, passwordHash: "x" } })).id;
    for (const v of [S, M]) {
      await prisma.inventoryValue.create({
        data: { itemId: barangId, variantSku: v, qtyOnHand: 20, reservedQty: 0, avgCost: 40000, totalValue: 800000 },
      });
    }
  });

  afterEach(async () => {
    await prisma.storeStockMovement.deleteMany({ where: { storeId: seededId(tokoId) } });
    await prisma.storeReceipt.deleteMany({ where: { id: { in: seededIds(receiptIds) } } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(adminId) } });
    await prisma.consignmentShipmentItem.deleteMany({ where: { shipmentId: { in: seededIds(kirimIds) } } });
    await prisma.consignmentShipment.deleteMany({ where: { id: { in: seededIds(kirimIds) } } });
    // Kiriman yang lolos tanpa tercatat di kirimIds (mis. klik ganda yang gagal dijaga) tetap dibersihkan.
    await prisma.consignmentShipmentItem.deleteMany({ where: { shipment: { storeId: seededId(tokoId) } } });
    await prisma.consignmentShipment.deleteMany({ where: { storeId: seededId(tokoId) } });
    if (tokoLainId) {
      await prisma.consignmentShipmentItem.deleteMany({ where: { shipment: { storeId: seededId(tokoLainId) } } });
      await prisma.consignmentShipment.deleteMany({ where: { storeId: seededId(tokoLainId) } });
    }
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(barangId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(barangId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(barangId) } });
    await prisma.item.deleteMany({ where: { id: seededId(barangId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: seededId(adminId) } });
    await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
    if (tokoLainId) await prisma.store.deleteMany({ where: { id: seededId(tokoLainId) } });
  });

  const stok = async (variantSku: string) => {
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId: barangId, variantSku } });
    return Number(inv!.qtyOnHand);
  };

  const kirim = async (items: Parameters<typeof kirimTitipan>[0]["items"], idempotencyKey?: string, storeId = tokoId) => {
    const h = await kirimTitipan({
      storeId,
      olehUserId: adminId,
      shippedAt: new Date("2026-10-02T03:00:00Z"),
      items,
      idempotencyKey,
    });
    if (h.ok && !kirimIds.includes(h.id)) kirimIds.push(h.id);
    return h;
  };

  const blus = (variantSku: string, qty: number) => ({ itemId: barangId, variantSku, itemName: `${tag} Blus`, qty, price: 100000 });

  it("varian M dipilih: M 20→15, S tetap 20; SPG menerima → tanda terima membawa varian M", async () => {
    const h = await kirim([blus(M, 5)], `${tag}-k1`);
    expect(h).toMatchObject({ ok: true, ulang: false, barangBerubah: [barangId] });
    expect(await stok(M)).toBe(15);
    expect(await stok(S)).toBe(20);
    const adj = await prisma.stockAdjustment.findMany({ where: { itemId: barangId } });
    expect(adj.map((a) => Number(a.qtyChange))).toEqual([-5]);

    if (!h.ok) throw new Error(h.alasan);
    const k = await muatKiriman(prisma, tokoId, "KONSI_SHIPMENT", h.id);
    expect(k?.lines.map((l) => [l.variantSku, l.qty])).toEqual([[M, 5]]);

    const terima = await terimaKiriman({
      storeId: tokoId,
      userId: adminId,
      sourceType: "KONSI_SHIPMENT",
      sourceId: h.id,
      diterima: k!.lines.map((l) => ({ lineId: l.lineId, qtyReceived: 5 })),
    });
    if (!terima.ok) throw new Error(terima.alasan);
    receiptIds.push(terima.receiptId);
    const baris = await prisma.storeReceiptLine.findMany({ where: { receiptId: terima.receiptId } });
    expect(baris.map((b) => [b.itemId, b.variantSku, b.qtyReceived])).toEqual([[barangId, M, 5]]);
  });

  it("klik ganda bersamaan dengan kunci yang sama: satu kiriman, stok M terpotong sekali", async () => {
    const kunci = `${tag}-ganda`;
    const [a, b, c] = await Promise.all([kirim([blus(M, 5)], kunci), kirim([blus(M, 5)], kunci), kirim([blus(M, 5)], kunci)]);
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) throw new Error("klik ganda gagal");
    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
    expect([a.ulang, b.ulang, c.ulang].sort()).toEqual([false, true, true]);
    expect(await prisma.consignmentShipment.count({ where: { storeId: tokoId } })).toBe(1);
    expect(await stok(M)).toBe(15);
    expect(await prisma.stockAdjustment.count({ where: { itemId: barangId } })).toBe(1);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: barangId, variantSku: M } })).toBe(1);
  });

  it("kirim ulang sesudah jawaban hilang: kiriman yang sama, tidak terpotong lagi, tidak ada push ulang", async () => {
    const kunci = `${tag}-ulang`;
    const pertama = await kirim([blus(M, 5)], kunci);
    const kedua = await kirim([blus(M, 5)], kunci);
    expect(pertama).toMatchObject({ ok: true, ulang: false });
    expect(kedua).toMatchObject({ ok: true, ulang: true, barangBerubah: [] });
    if (!pertama.ok || !kedua.ok) throw new Error("kirim ulang gagal");
    expect(kedua.id).toBe(pertama.id);
    expect(kedua.noKirim).toBe(pertama.noKirim);
    expect(await stok(M)).toBe(15);

    // Kunci diperiksa SEBELUM stok: sisa tersedia kini 1, kiriman ulangnya tetap kiriman pertama
    // (bukan "stok kurang" palsu untuk barang yang sudah berangkat).
    await prisma.inventoryValue.updateMany({ where: { itemId: seededId(barangId), variantSku: seededId(M) }, data: { reservedQty: 14 } });
    expect(await kirim([blus(M, 5)], kunci)).toMatchObject({ ok: true, ulang: true, id: pertama.id });
    await prisma.inventoryValue.updateMany({ where: { itemId: seededId(barangId), variantSku: seededId(M) }, data: { reservedQty: 0 } });
    expect(await stok(M)).toBe(15);

    // Kunci lain = kiriman lain (formulir baru).
    const lain = await kirim([blus(M, 5)], `${tag}-lain`);
    expect(lain).toMatchObject({ ok: true, ulang: false });
    expect(await stok(M)).toBe(10);
  });

  it("kunci lama dipakai untuk toko LAIN (admin ganti toko sesudah jawaban hilang): kiriman baru, bukan kiriman ulang", async () => {
    tokoLainId = (await prisma.store.create({ data: { code: `${tag}-T2`, name: `${tag} Toko 2`, address: "uji", termsType: "KONSI", isActive: true } })).id;
    const kunci = `${tag}-ganti-toko`;
    const keA = await kirim([blus(M, 5)], kunci);
    const keB = await kirim([blus(M, 3)], kunci, tokoLainId);
    if (!keA.ok || !keB.ok) throw new Error("kiriman gagal");
    expect(keB).toMatchObject({ ok: true, ulang: false, barangBerubah: [barangId] });
    expect(keB.id).not.toBe(keA.id);
    expect(await prisma.consignmentShipment.count({ where: { storeId: tokoLainId } })).toBe(1);
    expect(await stok(M)).toBe(12);

    // Kirim ulang ke masing-masing toko tetap dikenali sebagai kiriman yang sama.
    expect(await kirim([blus(M, 3)], kunci, tokoLainId)).toMatchObject({ ok: true, ulang: true, id: keB.id });
    expect(await kirim([blus(M, 5)], kunci)).toMatchObject({ ok: true, ulang: true, id: keA.id });
    expect(await stok(M)).toBe(12);
  });

  it("stok kurang: rincian per varian (dua baris M dijumlah), tidak ada yang tersimpan", async () => {
    await prisma.inventoryValue.updateMany({ where: { itemId: seededId(barangId), variantSku: seededId(M) }, data: { reservedQty: 8 } });
    const h = await kirim([blus(S, 4), blus(M, 8), blus(M, 8)], `${tag}-kurang`);
    expect(h).toMatchObject({ ok: false, alasan: "STOK_KURANG" });
    if (h.ok || !("kurang" in h)) throw new Error("bukan STOK_KURANG");
    expect(h.kurang).toEqual([
      { itemId: barangId, variantSku: M, itemName: `${tag} Blus`, variantLabel: `M (${M})`, requested: 16, available: 12 },
    ]);
    expect(await prisma.consignmentShipment.count({ where: { storeId: tokoId } })).toBe(0);
    expect(await stok(M)).toBe(20);
    expect(await stok(S)).toBe(20);
    expect(await prisma.stockAdjustment.count({ where: { itemId: barangId } })).toBe(0);

    // Kunci yang sama boleh dipakai lagi sesudah ditolak: tidak ada yang tersimpan.
    const lagi = await kirim([blus(S, 4), blus(M, 12)], `${tag}-kurang`);
    expect(lagi).toMatchObject({ ok: true, ulang: false });
    expect(await stok(M)).toBe(8);
  });

  it("nomor kiriman memakai tahun WIB: kiriman 1 Januari tidak bernomor tahun sebelumnya di server UTC", async () => {
    const h = await kirimTitipan({
      storeId: tokoId,
      olehUserId: adminId,
      // Bentuk yang dibuat aksi dari tanggal formulir "2027-01-01" (tengah malam WIB = 31 Des UTC).
      shippedAt: new Date("2027-01-01T00:00:00+07:00"),
      items: [blus(M, 1)],
    });
    if (!h.ok) throw new Error(h.alasan);
    kirimIds.push(h.id);
    expect(h.noKirim.startsWith("KKIRIM/2027/")).toBe(true);
  });

  it("varian yang tidak punya baris stok: kurang dengan tersedia 0", async () => {
    const h = await kirim([blus(`${tag}-XL`, 2)]);
    expect(h).toMatchObject({
      ok: false,
      alasan: "STOK_KURANG",
      kurang: [{ itemId: barangId, variantSku: `${tag}-XL`, requested: 2, available: 0 }],
    });
  });
});

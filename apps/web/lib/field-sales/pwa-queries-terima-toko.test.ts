import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { pesananSayaById } from "./pwa-queries";

/*
 * Rincian pesanan salesman membawa hasil hitung SPG per pengiriman ("Diterima
 * toko: N dari M · rusak R") — potong saja. Untuk KONSI tidak ada rupiah di
 * muatan sama sekali (aturan mutlak), diuji pada JSON yang benar-benar keluar.
 *
 * Fixture buatan tes, dibersihkan hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;
const tag = `PTT-${Math.random().toString(36).slice(2, 9)}`;

/** Kunci yang membawa rupiah. */
const KUNCI_HARGA = /price|harga|total|subtotal|diskon|discount|nilai|rupiah|amount|margin|potongan/i;

/** Setiap pasangan [kunci, nilai] di seluruh muatan, sedalam apa pun. */
function pasanganSemua(nilai: unknown, kumpulan: [string, unknown][] = []): [string, unknown][] {
  if (Array.isArray(nilai)) for (const x of nilai) pasanganSemua(x, kumpulan);
  else if (nilai !== null && typeof nilai === "object") {
    for (const [k, v] of Object.entries(nilai)) {
      kumpulan.push([k, v]);
      pasanganSemua(v, kumpulan);
    }
  }
  return kumpulan;
}

d("pesananSayaById — hasil terima toko (test bed only)", () => {
  let uomId = "";
  let itemId = "";
  let salesId = "";
  let spgId = "";
  let tokoPutus = "";
  let tokoKonsi = "";
  const orderIds: string[] = [];
  const deliveryIds: string[] = [];
  const receiptIds: string[] = [];
  let nomor = 0;

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({ data: { sku: tag, nameId: "Kemeja Uji", nameEn: "Test shirt", type: "FINISHED_GOOD", uomId, sellingPrice: 125_000 } })
    ).id;
    salesId = (await prisma.user.create({ data: { email: `${tag}-sales@test.local`.toLowerCase(), name: `Sales ${tag}` } })).id;
    spgId = (await prisma.user.create({ data: { email: `${tag}-spg@test.local`.toLowerCase(), name: `SPG ${tag}` } })).id;
    const toko = async (k: string, termsType: "PUTUS" | "KONSI") =>
      (await prisma.store.create({ data: { code: `${tag}-${k}`, name: `Toko ${k} ${tag}`, address: "uji", termsType, marginPercent: 25 } })).id;
    tokoPutus = await toko("P", "PUTUS");
    tokoKonsi = await toko("K", "KONSI");
  });

  afterAll(async () => {
    await prisma.storeReceipt.deleteMany({ where: { id: { in: seededIds(receiptIds) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoPutus, tokoKonsi].filter(Boolean)) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesId, spgId].filter(Boolean)) } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  async function pesanan(storeId: string, orderType: "PUTUS" | "KONSI", qty: number, deliveredQty = 0) {
    nomor += 1;
    const harga = orderType === "KONSI" ? 166_667 : 125_000;
    const o = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `${tag}-${orderType}-${nomor}`,
        storeId,
        salesmanId: salesId,
        orderType,
        status: "APPROVED",
        deliveryStatus: deliveredQty >= qty ? "DELIVERED" : deliveredQty > 0 ? "PARTIAL" : "PENDING",
        approvedAt: new Date(Date.now() - 86_400_000),
        subtotal: harga * qty,
        total: harga * qty,
        lines: {
          create: [{ itemId, variantSku: `${tag}-M`, productName: "Kemeja Uji — M", qty, deliveredQty, unitPrice: harga, lineTotal: harga * qty }],
        },
      },
      select: { id: true, orderNo: true, lines: { select: { id: true } } },
    });
    orderIds.push(o.id);
    return o;
  }

  async function pengiriman(orderId: string, orderLineId: string, qty: number) {
    nomor += 1;
    const dlv = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `${tag}-DLV-${nomor}`,
        orderId,
        deliveredAt: new Date(Date.now() - 3_600_000 * nomor),
        deliveredById: salesId,
        invoiceDate: new Date(),
        dueDate: new Date(),
        subtotal: 125_000 * qty,
        total: 125_000 * qty,
        lines: { create: [{ orderLineId, itemId, variantSku: `${tag}-M`, productName: "Kemeja Uji — M", qty, unitPrice: 125_000, lineTotal: 125_000 * qty }] },
      },
      select: { id: true, docNo: true },
    });
    deliveryIds.push(dlv.id);
    return dlv;
  }

  async function tandaTerima(
    storeId: string,
    sourceType: "PUTUS_DELIVERY" | "KONSI_ORDER",
    sourceId: string,
    docNo: string,
    baris: { qtySent: number; qtyReceived: number; qtyDamaged?: number }[],
  ) {
    const r = await prisma.storeReceipt.create({
      data: {
        storeId,
        sourceType,
        sourceId,
        sourceDocNo: docNo,
        receivedById: spgId,
        lines: {
          create: baris.map((b, i) => ({
            itemId,
            variantSku: `${tag}-M`,
            productName: `Kemeja Uji ${i}`,
            qtySent: b.qtySent,
            qtyReceived: b.qtyReceived,
            qtyDamaged: b.qtyDamaged ?? 0,
            ...(b.qtyDamaged ? { damageNote: "rusak", damageStatus: "TERBUKA" } : {}),
          })),
        },
      },
      select: { id: true },
    });
    receiptIds.push(r.id);
    return r.id;
  }

  it("putus: each delivery the SPG counted carries arrived/sent/short/damaged; uncounted ones and other orders' receipts are absent", async () => {
    const o = await pesanan(tokoPutus, "PUTUS", 12, 10);
    const pertama = await pengiriman(o.id, o.lines[0].id, 6);
    const kedua = await pengiriman(o.id, o.lines[0].id, 4);
    await tandaTerima(tokoPutus, "PUTUS_DELIVERY", pertama.id, pertama.docNo, [
      { qtySent: 4, qtyReceived: 3, qtyDamaged: 1 },
      { qtySent: 2, qtyReceived: 2 },
    ]);
    // Pengiriman pesanan lain di toko yang sama — tidak boleh ikut.
    const lain = await pesanan(tokoPutus, "PUTUS", 2, 2);
    const kirimLain = await pengiriman(lain.id, lain.lines[0].id, 2);
    await tandaTerima(tokoPutus, "PUTUS_DELIVERY", kirimLain.id, kirimLain.docNo, [{ qtySent: 2, qtyReceived: 1 }]);

    const detail = await pesananSayaById(o.id, salesId);
    expect(detail?.penerimaanToko).toEqual([
      {
        sourceType: "PUTUS_DELIVERY",
        sourceId: pertama.id,
        docNo: pertama.docNo,
        diterimaPada: expect.any(Date),
        dikirim: 6,
        diterima: 5,
        kurang: 1,
        rusak: 1,
      },
    ]);
    expect(detail?.penerimaanToko.some((p) => p.sourceId === kedua.id)).toBe(false);
  });

  it("konsi: the one receipt of the order is summarised, and the payload carries no rupiah anywhere", async () => {
    const o = await pesanan(tokoKonsi, "KONSI", 12);
    await tandaTerima(tokoKonsi, "KONSI_ORDER", o.id, o.orderNo, [{ qtySent: 12, qtyReceived: 9, qtyDamaged: 2 }]);

    const detail = await pesananSayaById(o.id, salesId);
    expect(detail?.penerimaanToko).toEqual([
      expect.objectContaining({ sourceType: "KONSI_ORDER", sourceId: o.id, docNo: o.orderNo, dikirim: 12, diterima: 9, kurang: 3, rusak: 2 }),
    ]);
    const muatan = JSON.parse(JSON.stringify(detail));
    const berharga = pasanganSemua(muatan).filter(([k, v]) => KUNCI_HARGA.test(k) && v !== null);
    expect(berharga).toEqual([]);
    // Angka harga konsi (166.667/pcs, 2.000.004 total) tidak ada di muatan; tag acak dibuang dulu.
    expect(JSON.stringify(muatan).split(tag).join("")).not.toMatch(/166667|166\.667|2000004/);
  });

  it("an order the SPG has not counted yet has no summary; another salesman sees nothing at all", async () => {
    const o = await pesanan(tokoKonsi, "KONSI", 3);
    expect((await pesananSayaById(o.id, salesId))?.penerimaanToko).toEqual([]);
    expect(await pesananSayaById(o.id, spgId)).toBeNull();
  });
});

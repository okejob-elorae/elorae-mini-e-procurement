import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Dua kabar per pengiriman ke SPG toko: berangkat dan diserahkan.
 *
 * Kabar dipalsukan: yang diuji SIAPA yang dikabari, BERAPA kali, dan isinya —
 * bukan pengiriman push-nya. `JENIS_KABAR` tetap yang asli. Basis data
 * sungguhan dengan fixture buatan tes, dibersihkan hanya lewat id yang diseed.
 */
const kabar = vi.hoisted(() => ({ kirim: [] as { userId: string; jenis: string; judul: string; isi: string; data: Record<string, string> }[] }));
vi.mock("@/lib/notifications/recipients", () => ({ sendNotificationToUsers: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", async (asli) => {
  const m = await asli<typeof import("@/lib/notifications/kabar-pengguna")>();
  return {
    ...m,
    kabariPengguna: vi.fn(async (userId: string, k: { jenis: string; judul: string; isi: string; data: Record<string, string> }) => {
      kabar.kirim.push({ userId, ...k });
    }),
  };
});

import { prisma, seededId, seededIds } from "@elorae/db";
import { tautanKabar } from "@/lib/notifications/tautan-kabar";
import {
  JEJAK_PENGIRIMAN_BERANGKAT,
  JEJAK_PENGIRIMAN_DISERAHKAN,
  kabarkanPengirimanBerangkat,
  kabarkanPengirimanDiserahkan,
  susunKabarBerangkat,
  susunKabarDibatalkan,
  susunKabarDiserahkan,
} from "./kabar-pengiriman";

describe("isi kabar (murni)", () => {
  it("departure names the pieces and who carries them — the carrier, or the courier with its tracking number", () => {
    expect(susunKabarBerangkat({ docNo: "DLV/1", pcs: 24, cara: "SALESMAN_CARRY", pengantar: "Budi", ekspedisi: null, resi: null })).toEqual({
      judul: "Barang sedang dalam perjalanan ke toko Anda",
      isi: "24 pcs · dibawa Budi · pengiriman DLV/1. Hitung dan terima setelah barangnya diserahkan di toko.",
    });
    expect(susunKabarBerangkat({ docNo: "DLV/2", pcs: 6, cara: "EXPEDITION", pengantar: null, ekspedisi: "JNE", resi: "R-9" }).isi).toBe(
      "6 pcs · dibawa JNE resi R-9 · pengiriman DLV/2. Hitung dan terima setelah barangnya diserahkan di toko.",
    );
  });

  it("handover asks the SPG to count and receive N pcs; zero says nothing was handed over", () => {
    expect(susunKabarDiserahkan({ docNo: "DLV/1", pcs: 20 })).toEqual({
      judul: "Barang sudah diserahkan",
      isi: "20 pcs · silakan hitung dan terima di menu Terima kiriman · pengiriman DLV/1.",
    });
    expect(susunKabarDiserahkan({ docNo: "DLV/1", pcs: 0 }).judul).toBe("Tidak ada barang yang diserahkan");
  });
});

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;
const tag = `KPG-${Math.random().toString(36).slice(2, 8)}`;

d("kabar pengiriman ke SPG (basis data)", () => {
  let uomId = "";
  let itemId = "";
  let kantorId = "";
  let salesId = "";
  let pengantarId = "";
  let spg1 = "";
  let spg2 = "";
  let tokoKonsi = "";
  let tokoPutus = "";
  let tokoTanpaSpg = "";
  const orderIds: string[] = [];
  const pengirimanIds: string[] = [];
  const transferIds: string[] = [];
  const deliveryIds: string[] = [];
  const receiptIds: string[] = [];
  let nomor = 0;

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (await prisma.item.create({ data: { sku: tag, nameId: "Kaos Uji", nameEn: "Test", type: "FINISHED_GOOD", uomId } })).id;
    const toko = async (k: string, termsType: "PUTUS" | "KONSI") =>
      (await prisma.store.create({ data: { code: `${tag}-${k}`, name: `Toko ${k} ${tag}`, address: "uji", termsType, isActive: true } })).id;
    tokoKonsi = await toko("K", "KONSI");
    tokoPutus = await toko("P", "PUTUS");
    tokoTanpaSpg = await toko("T", "KONSI");
    const orang = async (n: string, assignedStoreId: string | null = null) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}`, assignedStoreId } })).id;
    kantorId = await orang("kantor");
    salesId = await orang("sales");
    pengantarId = await orang("Budi");
    spg1 = await orang("spg1", tokoKonsi);
    spg2 = await orang("spg2", tokoPutus);
  });

  beforeEach(() => {
    kabar.kirim.length = 0;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        action: { in: [JEJAK_PENGIRIMAN_BERANGKAT, JEJAK_PENGIRIMAN_DISERAHKAN] },
        entityType: "DeliveryShipment",
        entityId: { in: seededIds(pengirimanIds) },
      },
    });
    await prisma.storeReceipt.deleteMany({ where: { id: { in: seededIds(receiptIds) } } });
    // Anak relasi 1:1 sebelum induknya: transfer sebelum pengiriman.
    await prisma.konsiTransfer.deleteMany({ where: { id: { in: seededIds(transferIds) } } });
    await prisma.deliveryShipment.deleteMany({ where: { id: { in: seededIds(pengirimanIds) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spg1, spg2, kantorId, salesId, pengantarId]) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoKonsi, tokoPutus, tokoTanpaSpg]) } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  async function pesanan(storeId: string, orderType: "PUTUS" | "KONSI", qty: number) {
    nomor += 1;
    const o = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `${tag}-${nomor}`,
        storeId,
        salesmanId: salesId,
        orderType,
        status: "APPROVED",
        approvedAt: new Date(),
        subtotal: 0,
        total: 0,
        lines: { create: [{ itemId, variantSku: "KU-M", productName: "Kaos Uji", qty, unitPrice: 0, lineTotal: 0 }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    orderIds.push(o.id);
    return o;
  }

  async function pengiriman(
    o: { id: string; lines: { id: string }[] },
    status: "IN_TRANSIT" | "DELIVERED" | "PARTIALLY_DELIVERED",
    planned: number,
    delivered: number | null,
    lain: { method?: "SALESMAN_CARRY" | "EXPEDITION"; deliveryId?: string } = {},
  ) {
    nomor += 1;
    const s = await prisma.deliveryShipment.create({
      data: {
        docNo: `${tag}-SHP-${nomor}`,
        orderId: o.id,
        method: lain.method ?? "SALESMAN_CARRY",
        status,
        packedById: kantorId,
        carriedById: (lain.method ?? "SALESMAN_CARRY") === "SALESMAN_CARRY" ? pengantarId : null,
        carrierName: lain.method === "EXPEDITION" ? "JNE" : null,
        resiNumber: lain.method === "EXPEDITION" ? "JNE-777" : null,
        shippedAt: new Date(),
        deliveryId: lain.deliveryId ?? null,
        lines: { create: [{ orderLineId: o.lines[0].id, itemId, variantSku: "KU-M", plannedQty: planned, deliveredQty: delivered }] },
      },
      select: { id: true, docNo: true },
    });
    pengirimanIds.push(s.id);
    return s;
  }

  async function transfer(o: { id: string; lines: { id: string }[] }, storeId: string, shipmentId: string, qty: number) {
    nomor += 1;
    const t = await prisma.konsiTransfer.create({
      data: {
        docNo: `${tag}-TRF-${nomor}`,
        orderId: o.id,
        storeId,
        shipmentId,
        transferredById: kantorId,
        lines: { create: [{ orderLineId: o.lines[0].id, itemId, variantSku: "KU-M", productName: "Kaos Uji", qty, unitCost: 40_000 }] },
      },
      select: { id: true },
    });
    transferIds.push(t.id);
    return t;
  }

  it("departure: each SPG of the store is told once, naming the carrier — never the office user, never twice", async () => {
    const o = await pesanan(tokoKonsi, "KONSI", 100);
    const s = await pengiriman(o, "IN_TRANSIT", 60, null);
    expect(await kabarkanPengirimanBerangkat({ shipmentId: s.id, pelakuId: kantorId })).toEqual({ penerima: 1 });
    expect(kabar.kirim).toEqual([
      {
        userId: spg1,
        jenis: "KIRIMAN_BERANGKAT",
        judul: "Barang sedang dalam perjalanan ke toko Anda",
        isi: `60 pcs · dibawa Budi ${tag} · pengiriman ${s.docNo}. Hitung dan terima setelah barangnya diserahkan di toko.`,
        data: { storeId: tokoKonsi, shipmentId: s.id },
      },
    ]);
    expect(tautanKabar(kabar.kirim[0].jenis, kabar.kirim[0].data)).toBe("/pwa/spg/terima");

    kabar.kirim.length = 0;
    expect(await kabarkanPengirimanBerangkat({ shipmentId: s.id, pelakuId: kantorId })).toEqual({ penerima: 0 });
    expect(kabar.kirim).toEqual([]);
  });

  it("two simultaneous departures of the same shipment notify once (race)", async () => {
    const o = await pesanan(tokoPutus, "PUTUS", 12);
    const s = await pengiriman(o, "IN_TRANSIT", 12, null, { method: "EXPEDITION" });
    const hasil = await Promise.all([
      kabarkanPengirimanBerangkat({ shipmentId: s.id, pelakuId: kantorId }),
      kabarkanPengirimanBerangkat({ shipmentId: s.id, pelakuId: kantorId }),
    ]);
    expect(hasil.map((h) => h.penerima).sort()).toEqual([0, 1]);
    expect(kabar.kirim).toHaveLength(1);
    expect(kabar.kirim[0].isi).toContain("dibawa JNE resi JNE-777");
    expect(await prisma.auditLog.count({ where: { action: JEJAK_PENGIRIMAN_BERANGKAT, entityType: "DeliveryShipment", entityId: s.id } })).toBe(1);
  });

  it("konsi 100 pcs shipped 60 then 40: two handover notices, each with ITS shipment's pieces, linking to its receive form", async () => {
    const o = await pesanan(tokoKonsi, "KONSI", 100);
    const s1 = await pengiriman(o, "DELIVERED", 60, 60);
    const t1 = await transfer(o, tokoKonsi, s1.id, 60);
    const s2 = await pengiriman(o, "DELIVERED", 40, 40);
    const t2 = await transfer(o, tokoKonsi, s2.id, 40);

    expect(await kabarkanPengirimanDiserahkan({ shipmentId: s1.id, pelakuId: pengantarId })).toEqual({ penerima: 1 });
    expect(await kabarkanPengirimanDiserahkan({ shipmentId: s2.id, pelakuId: pengantarId })).toEqual({ penerima: 1 });
    expect(kabar.kirim.map((k) => [k.jenis, k.judul, k.data.sourceId])).toEqual([
      ["KIRIMAN_DISERAHKAN", "Barang sudah diserahkan", t1.id],
      ["KIRIMAN_DISERAHKAN", "Barang sudah diserahkan", t2.id],
    ]);
    expect(kabar.kirim[0].isi).toContain("60 pcs");
    expect(kabar.kirim[1].isi).toContain("40 pcs");
    expect(tautanKabar(kabar.kirim[0].jenis, kabar.kirim[0].data)).toBe(`/pwa/spg/terima/KONSI_TRANSFER/${t1.id}`);
    // Tanpa harga: 40.000/pcs tidak pernah muncul.
    expect(JSON.stringify(kabar.kirim).split(tag).join("")).not.toMatch(/Rp|40000|40\.000/);

    // Penyelesaian ulang (pelaku sama) tidak mengabari lagi.
    kabar.kirim.length = 0;
    expect(await kabarkanPengirimanDiserahkan({ shipmentId: s1.id, pelakuId: pengantarId })).toEqual({ penerima: 0 });
    expect(kabar.kirim).toEqual([]);
  });

  it("putus: the handover notice counts the delivery's pieces; a received delivery is not announced", async () => {
    const o = await pesanan(tokoPutus, "PUTUS", 24);
    nomor += 1;
    const dlv = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `${tag}-DLV-${nomor}`,
        orderId: o.id,
        deliveredAt: new Date(),
        deliveredById: pengantarId,
        invoiceDate: new Date(),
        dueDate: new Date(),
        subtotal: 0,
        total: 0,
        lines: { create: [{ orderLineId: o.lines[0].id, itemId, variantSku: "KU-M", productName: "Kaos Uji", qty: 20, unitPrice: 0, lineTotal: 0 }] },
      },
      select: { id: true, docNo: true },
    });
    deliveryIds.push(dlv.id);
    const s = await pengiriman(o, "PARTIALLY_DELIVERED", 24, 20, { deliveryId: dlv.id });
    expect(await kabarkanPengirimanDiserahkan({ shipmentId: s.id, pelakuId: pengantarId })).toEqual({ penerima: 1 });
    expect(kabar.kirim[0]).toMatchObject({ userId: spg2, data: { storeId: tokoPutus, shipmentId: s.id, sourceType: "PUTUS_DELIVERY", sourceId: dlv.id } });
    expect(kabar.kirim[0].isi).toContain("20 pcs");

    // Sudah diterima SPG lebih dulu → tidak ada kabar (pengiriman lain dengan nota yang sama tidak mungkin, ini hanya penjaga).
    const s2 = await pengiriman(o, "DELIVERED", 4, 4, { deliveryId: undefined });
    receiptIds.push(
      (await prisma.storeReceipt.create({ data: { storeId: tokoPutus, sourceType: "PUTUS_DELIVERY", sourceId: dlv.id, sourceDocNo: dlv.docNo, receivedById: spg2 } })).id,
    );
    kabar.kirim.length = 0;
    expect(await kabarkanPengirimanDiserahkan({ shipmentId: s2.id, deliveryId: dlv.id, pelakuId: pengantarId })).toEqual({ penerima: 0 });
    expect(kabar.kirim).toEqual([]);
  });

  it("a completion that handed nothing over tells the SPG so; a store without an SPG writes nothing", async () => {
    const o = await pesanan(tokoKonsi, "KONSI", 10);
    const kosong = await pengiriman(o, "PARTIALLY_DELIVERED", 10, 0);
    expect(await kabarkanPengirimanDiserahkan({ shipmentId: kosong.id, pelakuId: pengantarId })).toEqual({ penerima: 1 });
    expect(kabar.kirim[0]).toMatchObject({ judul: "Tidak ada barang yang diserahkan", data: { storeId: tokoKonsi, shipmentId: kosong.id } });
    expect(kabar.kirim[0].data.sourceId).toBeUndefined();
    expect(tautanKabar(kabar.kirim[0].jenis, kabar.kirim[0].data)).toBe("/pwa/spg/terima");

    const lain = await pesanan(tokoTanpaSpg, "KONSI", 5);
    const s = await pengiriman(lain, "IN_TRANSIT", 5, null);
    expect(await kabarkanPengirimanBerangkat({ shipmentId: s.id, pelakuId: kantorId })).toEqual({ penerima: 0 });
    expect(await prisma.auditLog.count({ where: { entityType: "DeliveryShipment", entityId: s.id } })).toBe(0);
  });

  it("a shipment still on the road is not 'handed over', and an unknown one is quietly ignored", async () => {
    const o = await pesanan(tokoKonsi, "KONSI", 3);
    const s = await pengiriman(o, "IN_TRANSIT", 3, null);
    expect(await kabarkanPengirimanDiserahkan({ shipmentId: s.id, pelakuId: pengantarId })).toEqual({ penerima: 0 });
    expect(await kabarkanPengirimanDiserahkan({ shipmentId: `${tag}-tidak-ada`, pelakuId: pengantarId })).toEqual({ penerima: 0 });
    expect(await kabarkanPengirimanBerangkat({ shipmentId: `${tag}-tidak-ada`, pelakuId: pengantarId })).toEqual({ penerima: 0 });
    expect(kabar.kirim).toEqual([]);
  });
});

describe("kabar pengiriman dibatalkan (Q24)", () => {
  it("names the pieces and the shipment, carries no rupiah, and fits 191 characters", () => {
    const k = susunKabarDibatalkan({ docNo: "DLV/2026/11/0001", pcs: 12 });
    expect(k.judul).toBe("Pengiriman dibatalkan");
    expect(k.isi).toContain("12 pcs");
    expect(k.isi).toContain("DLV/2026/11/0001");
    expect(k.isi).not.toMatch(/Rp/);
    expect(Array.from(k.isi).length).toBeLessThanOrEqual(191);
  });
});

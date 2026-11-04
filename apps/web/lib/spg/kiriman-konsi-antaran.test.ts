import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Barang konsinyasi diterima SPG PER ANTARAN (keputusan pemilik 2026-11-01),
 * terhadap basis data sungguhan.
 *
 * Contoh pemilik: pesanan konsi 100 pcs. Antaran pertama membawa 60, Rina
 * menghitung 57 → kurang 3 DI PERJALANAN (cek pengantarnya). 40 sisanya BELUM
 * DIKIRIM GUDANG — bukan kekurangan, bukan barang hilang. Antaran kedua (40)
 * diterima tersendiri. Pesanan yang baru disetujui tidak membuka apa pun.
 * Pesanan LAMA (stok keluar saat disetujui, tanpa pengiriman) tetap diterima
 * sekali per pesanan.
 *
 * Kabar dipalsukan untuk melihat isinya. Basis data dipakai bersama data dev:
 * setiap penghapusan lewat `seededId(s)`, anak relasi 1:1 sebelum induknya.
 */
const kabar = vi.hoisted(() => ({ kirim: [] as { userId: string; jenis: string; judul: string; isi: string; data: Record<string, string> }[] }));
vi.mock("@/lib/notifications/recipients", () => ({ sendNotificationToUsers: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", async (asli) => ({
  ...(await asli<typeof import("@/lib/notifications/kabar-pengguna")>()),
  kabariPengguna: vi.fn(async (userId: string, k: { jenis: string; judul: string; isi: string; data: Record<string, string> }) => {
    kabar.kirim.push({ userId, ...k });
  }),
}));
vi.mock("./titip-tersedia", () => ({ kabariTitipanTersedia: vi.fn(async () => {}) }));

import { prisma, seededId, seededIds } from "@elorae/db";
import { muatInfoAntaran } from "./antaran-queries";
import { KATEGORI_NOTIF_HILANG } from "./hilang";
import { bukaHilangDariPenerimaan } from "./hilang-sumber";
import { kirimanMenunggu, muatKiriman } from "./kiriman";
import { pesananMenujuToko } from "./pesanan-menuju-toko";
import { terimaKiriman } from "./stok-writer";

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;
const tag = `KAN-${Math.random().toString(36).slice(2, 8)}`;
const HARI = 86_400_000;

d("antaran konsinyasi diterima per pengiriman (basis data)", () => {
  let uomId = "";
  let itemId = "";
  let tokoId = "";
  let salesId = "";
  let pengantarId = "";
  let spgId = "";
  const orderIds: string[] = [];
  const lineIds: string[] = [];
  const shipmentIds: string[] = [];
  const transferIds: string[] = [];
  let nomor = 0;

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (await prisma.item.create({ data: { sku: tag, nameId: "Kaos Polos Hitam", nameEn: "Test", type: "FINISHED_GOOD", uomId } })).id;
    tokoId = (await prisma.store.create({ data: { code: tag, name: `Toko Melati ${tag}`, address: "uji", termsType: "KONSI", isActive: true } })).id;
    const orang = async (n: string, assignedStoreId: string | null = null) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}`, assignedStoreId } })).id;
    salesId = await orang("sales");
    pengantarId = await orang("Budi");
    spgId = await orang("Rina", tokoId);
  });

  beforeEach(() => {
    kabar.kirim.length = 0;
  });

  afterAll(async () => {
    // Catatan barang hilang yang dibuka tes ini (dan catatan kantornya, dicocokkan di JS lewat metadata).
    const losses = await prisma.stockLoss.findMany({ where: { storeId: seededId(tokoId) }, select: { id: true } });
    const lossIds = losses.map((l) => l.id);
    const catatan = await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_HILANG }, select: { id: true, metadata: true } });
    const milikUji = catatan
      .filter((c) => {
        const m = c.metadata as Record<string, unknown> | null;
        return typeof m?.lossId === "string" && lossIds.includes(m.lossId);
      })
      .map((c) => c.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(lossIds) } } });
    await prisma.stockLossShare.deleteMany({ where: { lossId: { in: seededIds(lossIds) } } });
    await prisma.stockLossLine.deleteMany({ where: { lossId: { in: seededIds(lossIds) } } });
    await prisma.stockLoss.deleteMany({ where: { id: { in: seededIds(lossIds) } } });
    await prisma.storeStockMovement.deleteMany({ where: { storeId: seededId(tokoId) } });
    await prisma.storeReceipt.deleteMany({ where: { storeId: seededId(tokoId) } });
    await prisma.stockReservation.deleteMany({ where: { fieldSalesLineId: { in: seededIds(lineIds) } } });
    await prisma.konsiTransfer.deleteMany({ where: { id: { in: seededIds(transferIds) } } });
    await prisma.deliveryShipment.deleteMany({ where: { id: { in: seededIds(shipmentIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgId, salesId, pengantarId]) } } });
    await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  /** Pesanan konsi disetujui; `cadangan` = keadaan cadangan stok barisnya (null = tanpa cadangan). */
  async function pesanan(qty: number, lain: { delivered?: number; cancelled?: number; cadangan?: "RESERVED" | "CONSUMED" | "RELEASED" | null }) {
    nomor += 1;
    const delivered = lain.delivered ?? 0;
    const cancelled = lain.cancelled ?? 0;
    const o = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `${tag}-KONSI-${nomor}`,
        storeId: tokoId,
        salesmanId: salesId,
        orderType: "KONSI",
        status: "APPROVED",
        deliveryStatus: delivered + cancelled >= qty ? (cancelled > 0 ? "CLOSED" : "DELIVERED") : delivered > 0 ? "PARTIAL" : "PENDING",
        // Sekarang, bukan kemarin: sesudah tes pertama toko ini mulai dilacak (gerakan buku
        // pertama), dan kiriman sebelum itu dianggap sudah lama di rak.
        approvedAt: new Date(),
        subtotal: 0,
        total: 0,
        lines: { create: [{ itemId, variantSku: "", productName: "Kaos Polos Hitam M", qty, deliveredQty: delivered, cancelledQty: cancelled, unitPrice: 0, lineTotal: 0 }] },
      },
      select: { id: true, orderNo: true, lines: { select: { id: true } } },
    });
    orderIds.push(o.id);
    lineIds.push(o.lines[0].id);
    if (lain.cadangan) {
      await prisma.stockReservation.create({
        data: { source: "FIELD_SALES_KONSI", fieldSalesLineId: o.lines[0].id, itemId, variantSku: "", qty, consumedQty: delivered, state: lain.cadangan },
      });
    }
    return { id: o.id, orderNo: o.orderNo, lineId: o.lines[0].id };
  }

  async function antaran(o: { id: string; lineId: string }, qty: number, status: "DELIVERED" | "IN_TRANSIT" | "PACKED" = "DELIVERED") {
    nomor += 1;
    const shp = await prisma.deliveryShipment.create({
      data: {
        docNo: `${tag}-SHP-${nomor}`,
        orderId: o.id,
        method: "SALESMAN_CARRY",
        status,
        packedById: salesId,
        carriedById: pengantarId,
        proofPhotoUrl: status === "DELIVERED" ? "https://bukti/foto.jpg" : null,
        deliveredAt: status === "DELIVERED" ? new Date(Date.now() - HARI) : null,
        lines: { create: [{ orderLineId: o.lineId, itemId, variantSku: "", plannedQty: qty, deliveredQty: status === "DELIVERED" ? qty : null }] },
      },
      select: { id: true, docNo: true },
    });
    shipmentIds.push(shp.id);
    if (status !== "DELIVERED") return { shipmentId: shp.id, docNo: shp.docNo, transferId: "" };
    const t = await transfer(o, qty, shp.id);
    return { shipmentId: shp.id, docNo: shp.docNo, transferId: t };
  }

  async function transfer(o: { id: string; lineId: string }, qty: number, shipmentId: string | null) {
    nomor += 1;
    const t = await prisma.konsiTransfer.create({
      data: {
        docNo: `${tag}-TRF-${nomor}`,
        orderId: o.id,
        storeId: tokoId,
        shipmentId,
        transferredById: salesId,
        lines: { create: [{ orderLineId: o.lineId, itemId, variantSku: "", productName: "Kaos Polos Hitam M", qty, unitCost: 40_000 }] },
      },
      select: { id: true },
    });
    transferIds.push(t.id);
    return t.id;
  }

  it("100 ordered, 60 then 40 shipped: each shipment is its own delivery to receive, sent = that shipment, and approval opens nothing", async () => {
    const o = await pesanan(100, { delivered: 60, cadangan: "RESERVED" });
    const a1 = await antaran(o, 60);

    const sebelum = await kirimanMenunggu(tokoId);
    const milikPesanan = sebelum.filter((k) => k.pesananNo === o.orderNo || k.sourceId === o.id);
    expect(milikPesanan.map((k) => [k.sourceType, k.sourceId, k.docNo, k.lines.map((l) => l.qty)])).toEqual([
      ["KONSI_TRANSFER", a1.transferId, a1.docNo, [60]],
    ]);
    // Pesanannya sendiri tidak pernah terbuka untuk diterima.
    expect(await muatKiriman(prisma, tokoId, "KONSI_ORDER", o.id)).toBeNull();

    // Sisa 40 belum masuk pengiriman mana pun: belum dikirim gudang.
    expect(await muatInfoAntaran(prisma, tokoId, "KONSI_TRANSFER", a1.transferId)).toMatchObject({
      orderNo: o.orderNo,
      belumDikirimGudang: 40,
      pengiriman: { docNo: a1.docNo, cara: "SALESMAN_CARRY", pengantar: `Budi ${tag}`, adaBuktiSerahTerima: true },
    });
    expect(await pesananMenujuToko(tokoId)).toEqual([expect.objectContaining({ orderNo: o.orderNo, status: "DIKIRIM_SEBAGIAN", belumDikirimGudang: 40 })]);

    // Rina menghitung 57: kurang 3 DI PERJALANAN — sebesar antaran ini, bukan 43.
    const [k1] = milikPesanan;
    const r1 = await terimaKiriman({
      storeId: tokoId,
      userId: spgId,
      sourceType: k1.sourceType,
      sourceId: k1.sourceId,
      diterima: [{ lineId: k1.lines[0].lineId, qtyReceived: 57 }],
    });
    if (!r1.ok) throw new Error(r1.alasan);
    const tt = await prisma.storeReceipt.findUnique({ where: { id: r1.receiptId }, select: { lines: { select: { qtySent: true, qtyReceived: true } } } });
    expect(tt?.lines).toEqual([{ qtySent: 60, qtyReceived: 57 }]);
    expect(kabar.kirim).toHaveLength(1);
    expect(kabar.kirim[0]).toMatchObject({ userId: salesId, jenis: "KIRIMAN_DITERIMA_SELISIH", data: { orderId: o.id, sourceType: "KONSI_TRANSFER" } });
    expect(kabar.kirim[0].judul).toBe(`Kiriman ${a1.docNo}: kurang 3 pcs`);
    expect(kabar.kirim[0].isi.startsWith(`Kurang di perjalanan — cek ke pengantar Budi ${tag}.`)).toBe(true);
    expect(kabar.kirim[0].isi).toContain(`tiba 57 dari 60 pcs yang dikirim gudang di ${a1.docNo}.`);
    expect(Array.from(kabar.kirim[0].isi).length).toBeLessThanOrEqual(191);
    expect(kabar.kirim[0].isi.split(tag).join("")).not.toMatch(/43|Rp|40\.000|40000/);

    // Catatan barang hilang: 3 pcs (bukan 43), dan catatan kantornya menyebut di mana dicek.
    const hilang = await bukaHilangDariPenerimaan(r1.receiptId, spgId);
    if (!hilang.ok) throw new Error(hilang.kode);
    const loss = await prisma.stockLoss.findUnique({ where: { id: hilang.id }, select: { totalQty: true } });
    expect(loss?.totalQty).toBe(3);
    const notif = (await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_HILANG }, select: { message: true, metadata: true } })).find(
      (n) => (n.metadata as Record<string, unknown> | null)?.lossId === hilang.id,
    );
    expect(notif?.message).toContain(
      `Kurang di perjalanan — cek ke pengantar Budi ${tag}. Gudang mengirim 60 pcs di ${a1.docNo}, tiba 57. Foto serah terima ada di pengiriman itu.`,
    );

    // Antaran kedua: 40, diterima tersendiri.
    await prisma.fieldSalesOrderLine.update({ where: { id: o.lineId }, data: { deliveredQty: 100 } });
    await prisma.fieldSalesOrder.update({ where: { id: o.id }, data: { deliveryStatus: "DELIVERED" } });
    const a2 = await antaran(o, 40);
    const kedua = (await kirimanMenunggu(tokoId)).filter((k) => k.pesananNo === o.orderNo);
    expect(kedua.map((k) => [k.sourceType, k.sourceId, k.lines.map((l) => l.qty)])).toEqual([["KONSI_TRANSFER", a2.transferId, [40]]]);
    const r2 = await terimaKiriman({
      storeId: tokoId,
      userId: spgId,
      sourceType: "KONSI_TRANSFER",
      sourceId: a2.transferId,
      diterima: [{ lineId: kedua[0].lines[0].lineId, qtyReceived: 40 }],
    });
    expect(r2.ok).toBe(true);
    expect((await kirimanMenunggu(tokoId)).filter((k) => k.pesananNo === o.orderNo)).toEqual([]);
    expect(await pesananMenujuToko(tokoId)).toEqual([]);
  });

  it("a shipment on the road is not receivable yet; nothing approved-only is ever on the list", async () => {
    const baru = await pesanan(10, { cadangan: "RESERVED" });
    await antaran(baru, 6, "IN_TRANSIT");
    const daftar = await kirimanMenunggu(tokoId);
    expect(daftar.some((k) => k.sourceId === baru.id || k.pesananNo === baru.orderNo)).toBe(false);
    expect((await pesananMenujuToko(tokoId)).find((p) => p.id === baru.id)).toMatchObject({
      status: "DALAM_PERJALANAN",
      dalamPerjalanan: 6,
      belumDikirimGudang: 4,
    });
  });

  it("a remainder closed by the office simply disappears — never a shortfall, never on any list", async () => {
    const tutup = await pesanan(100, { delivered: 0, cancelled: 100, cadangan: "RELEASED" });
    expect(await muatKiriman(prisma, tokoId, "KONSI_ORDER", tutup.id)).toBeNull();
    expect((await kirimanMenunggu(tokoId)).some((k) => k.sourceId === tutup.id)).toBe(false);
    expect((await pesananMenujuToko(tokoId)).some((p) => p.id === tutup.id)).toBe(false);
  });

  it("old orders approved under the old rules stay receivable once per order — and their approval-time transfer is not offered again", async () => {
    // (a) cadangan habis dipakai saat disetujui + transfer TANPA pengiriman.
    const lamaA = await pesanan(12, { delivered: 12, cadangan: "CONSUMED" });
    const trfLama = await transfer(lamaA, 12, null);
    // (b) lebih tua dari cadangan stok: tanpa cadangan, tanpa transfer.
    const lamaB = await pesanan(5, { delivered: 5, cadangan: null });

    const daftar = await kirimanMenunggu(tokoId);
    const lama = daftar.filter((k) => k.sourceId === lamaA.id || k.sourceId === lamaB.id || k.sourceId === trfLama);
    expect(lama.map((k) => [k.sourceType, k.sourceId]).sort()).toEqual(
      [
        ["KONSI_ORDER", lamaA.id],
        ["KONSI_ORDER", lamaB.id],
      ].sort(),
    );
    expect(await muatKiriman(prisma, tokoId, "KONSI_TRANSFER", trfLama)).toBeNull();
    expect((await muatKiriman(prisma, tokoId, "KONSI_ORDER", lamaA.id))?.lines.map((l) => l.qty)).toEqual([12]);
  });
});

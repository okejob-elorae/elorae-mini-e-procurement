import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Kabar dipalsukan: yang diuji adalah SIAPA yang dikabari dan BERAPA kali,
 * bukan pengiriman push-nya. `JENIS_KABAR` tetap yang asli.
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
import {
  JEJAK_KIRIMAN_BERANGKAT,
  hitungPesananDiproses,
  kabarkanKirimanBerangkat,
  pesananMenujuToko,
  pesananMenujuUntukHp,
  susunPesananMenuju,
  type BarisPesananMentah,
  type PesananMenujuToko,
} from "./pesanan-menuju-toko";

/** Kunci yang tidak boleh ada di muatan HP SPG — rupiah dalam bentuk apa pun. */
const KUNCI_HARGA = /price|harga|total|subtotal|diskon|discount|nilai|rupiah|amount|margin|cogs/i;

function kunciSemua(nilai: unknown, kumpulan: string[] = []): string[] {
  if (Array.isArray(nilai)) for (const x of nilai) kunciSemua(x, kumpulan);
  else if (nilai !== null && typeof nilai === "object") {
    for (const [k, v] of Object.entries(nilai)) {
      kumpulan.push(k);
      kunciSemua(v, kumpulan);
    }
  }
  return kumpulan;
}

const HARI = 86_400_000;
const SEKARANG = new Date("2026-10-06T05:00:00.000Z");
const lalu = (n: number) => new Date(SEKARANG.getTime() - n * HARI);

function baris(over: Partial<BarisPesananMentah> & Pick<BarisPesananMentah, "id">): BarisPesananMentah {
  return {
    orderNo: `SO-${over.id}`,
    orderType: "PUTUS",
    status: "PENDING_APPROVAL",
    deliveryStatus: "PENDING",
    createdAt: lalu(1),
    approvedAt: null,
    preorderWindowId: null,
    lines: [],
    ...over,
  };
}

const kemeja = (variantSku: string, qty: number, lain: { id?: string; deliveredQty?: number; cancelledQty?: number } = {}) => ({
  ...(lain.id ? { id: lain.id } : {}),
  itemId: "kemeja",
  variantSku,
  productName: "Kemeja Linen",
  qty,
  deliveredQty: lain.deliveredQty ?? 0,
  cancelledQty: lain.cancelledQty ?? 0,
});

describe("susunPesananMenuju (murni)", () => {
  it("a pending order shows every piece ordered, per item and size", () => {
    const [p] = susunPesananMenuju([baris({ id: "a", lines: [kemeja("KL-M", 6), kemeja("KL-L", 4)] })]);
    expect(p).toMatchObject({ id: "a", orderNo: "SO-a", status: "MENUNGGU_PERSETUJUAN", jumlahPcs: 10, inden: false, belumDikirimGudang: 0 });
    expect(p.barang).toEqual([
      { kunci: "kemeja::KL-L", nama: "Kemeja Linen", varian: "KL-L", pcs: 4 },
      { kunci: "kemeja::KL-M", nama: "Kemeja Linen", varian: "KL-M", pcs: 6 },
    ]);
  });

  it("an approved putus order not yet shipped is all still at the warehouse", () => {
    const [p] = susunPesananMenuju([baris({ id: "b", status: "APPROVED", approvedAt: lalu(1), lines: [kemeja("KL-M", 12)] })]);
    expect(p).toMatchObject({ status: "DISETUJUI", jumlahPcs: 12, belumDikirimGudang: 12, dikemas: 0, dalamPerjalanan: 0 });
  });

  it("a partly shipped putus order lists only what has not reached the store — a finished line drops out", () => {
    const [p] = susunPesananMenuju([
      baris({
        id: "c",
        status: "APPROVED",
        deliveryStatus: "PARTIAL",
        lines: [kemeja("KL-M", 12, { deliveredQty: 5 }), kemeja("KL-S", 6, { deliveredQty: 6 })],
      }),
    ]);
    expect(p.status).toBe("DIKIRIM_SEBAGIAN");
    expect(p.barang).toEqual([{ kunci: "kemeja::KL-M", nama: "Kemeja Linen", varian: "KL-M", pcs: 7 }]);
    expect(p).toMatchObject({ jumlahPcs: 7, belumDikirimGudang: 7 });
  });

  it("an approved konsi order with nothing shipped is approved, not on its way — approve only reserves", () => {
    const konsi = baris({ id: "d", orderType: "KONSI", status: "APPROVED", approvedAt: lalu(2), lines: [kemeja("KL-M", 8, { cancelledQty: 2 })] });
    expect(susunPesananMenuju([konsi])).toEqual([
      expect.objectContaining({ status: "DISETUJUI", jumlahPcs: 6, belumDikirimGudang: 6, dalamPerjalanan: 0 }),
    ]);
  });

  it("konsi 100 pcs: 60 handed over, 30 on the road, 5 packed — the last 5 are 'not yet sent by the warehouse', never a shortfall", () => {
    const [p] = susunPesananMenuju([
      baris({
        id: "k100",
        orderType: "KONSI",
        status: "APPROVED",
        deliveryStatus: "PARTIAL",
        approvedAt: lalu(5),
        lines: [kemeja("KL-M", 100, { id: "l1", deliveredQty: 60 })],
        shipments: [
          { status: "IN_TRANSIT", lines: [{ orderLineId: "l1", plannedQty: 30 }] },
          { status: "PACKED", lines: [{ orderLineId: "l1", plannedQty: 5 }] },
        ],
      }),
    ]);
    expect(p).toMatchObject({ status: "DALAM_PERJALANAN", jumlahPcs: 40, dalamPerjalanan: 30, dikemas: 5, belumDikirimGudang: 5 });
  });

  it("a shipment planning more than is left never drives 'not yet sent' below zero", () => {
    const [p] = susunPesananMenuju([
      baris({
        id: "lebih",
        status: "APPROVED",
        lines: [kemeja("KL-M", 4, { id: "l1" })],
        shipments: [{ status: "IN_TRANSIT", lines: [{ orderLineId: "l1", plannedQty: 9 }] }],
      }),
    ]);
    expect(p).toMatchObject({ dalamPerjalanan: 4, dikemas: 0, belumDikirimGudang: 0 });
  });

  it("delivered, closed, rejected and cancelled orders are not heading to the store — a closed konsi remainder simply disappears", () => {
    const daftar = susunPesananMenuju([
      baris({ id: "f", status: "APPROVED", deliveryStatus: "DELIVERED", lines: [kemeja("KL-M", 3, { deliveredQty: 3 })] }),
      baris({ id: "g", status: "APPROVED", deliveryStatus: "CLOSED", lines: [kemeja("KL-M", 3, { deliveredQty: 1, cancelledQty: 2 })] }),
      baris({ id: "gk", orderType: "KONSI", status: "APPROVED", deliveryStatus: "CLOSED", lines: [kemeja("KL-M", 100, { deliveredQty: 60, cancelledQty: 40 })] }),
      baris({ id: "h", status: "REJECTED", lines: [kemeja("KL-M", 3)] }),
    ]);
    expect(daftar).toEqual([]);
  });

  it("a legacy konsi order (stock left at approval, marked delivered by the backfill) never shows", () => {
    const lama = baris({ id: "e", orderType: "KONSI", status: "APPROVED", deliveryStatus: "DELIVERED", approvedAt: lalu(45), lines: [kemeja("KL-M", 3, { deliveredQty: 3 })] });
    expect(susunPesananMenuju([lama])).toEqual([]);
  });

  it("the same item and size on two lines (a bonus line) is one row", () => {
    const [p] = susunPesananMenuju([baris({ id: "i", lines: [kemeja("KL-M", 6), kemeja("KL-M", 1)] })]);
    expect(p.barang).toEqual([{ kunci: "kemeja::KL-M", nama: "Kemeja Linen", varian: "KL-M", pcs: 7 }]);
  });

  it("an order with nothing left to send is left out", () => {
    const daftar = susunPesananMenuju([
      baris({ id: "j", status: "APPROVED", deliveryStatus: "PARTIAL", lines: [kemeja("KL-M", 4, { deliveredQty: 2, cancelledQty: 2 })] }),
    ]);
    expect(daftar).toEqual([]);
  });

  it("goods on the road come first, then partly shipped, approved, and waiting — oldest first within each", () => {
    const daftar = susunPesananMenuju([
      baris({ id: "tunggu-baru", createdAt: lalu(1), lines: [kemeja("KL-M", 1)] }),
      baris({ id: "tunggu-lama", createdAt: lalu(3), lines: [kemeja("KL-M", 1)] }),
      baris({ id: "setuju", status: "APPROVED", createdAt: lalu(2), lines: [kemeja("KL-M", 1)] }),
      baris({
        id: "jalan",
        orderType: "KONSI",
        status: "APPROVED",
        approvedAt: lalu(1),
        createdAt: lalu(1),
        lines: [kemeja("KL-M", 1, { id: "lj" })],
        shipments: [{ status: "IN_TRANSIT", lines: [{ orderLineId: "lj", plannedQty: 1 }] }],
      }),
      baris({ id: "sebagian", status: "APPROVED", deliveryStatus: "PARTIAL", createdAt: lalu(5), lines: [kemeja("KL-M", 2, { deliveredQty: 1 })] }),
    ]);
    expect(daftar.map((p) => p.id)).toEqual(["jalan", "sebagian", "setuju", "tunggu-lama", "tunggu-baru"]);
  });

  it("a pre-order is marked as such", () => {
    const [p] = susunPesananMenuju([baris({ id: "k", status: "APPROVED", preorderWindowId: "w1", lines: [kemeja("KL-M", 2)] })]);
    expect(p.inden).toBe(true);
  });

  it("the home count counts every order not yet at the store — one on the road cannot be received before it is handed over", () => {
    const daftar = susunPesananMenuju([
      baris({ id: "l", lines: [kemeja("KL-M", 1)] }),
      baris({ id: "m", status: "APPROVED", lines: [kemeja("KL-M", 1)] }),
      baris({
        id: "n",
        orderType: "KONSI",
        status: "APPROVED",
        approvedAt: lalu(1),
        lines: [kemeja("KL-M", 1, { id: "ln" })],
        shipments: [{ status: "IN_TRANSIT", lines: [{ orderLineId: "ln", plannedQty: 1 }] }],
      }),
    ]);
    expect(daftar).toHaveLength(3);
    expect(hitungPesananDiproses(daftar)).toBe(3);
  });
});

describe("pesananMenujuUntukHp (muatan HP SPG)", () => {
  const daftar: PesananMenujuToko[] = [
    {
      id: "a",
      orderNo: "PUTUS/2026/10/0007",
      status: "DIKIRIM_SEBAGIAN",
      dipesanPada: lalu(2),
      inden: false,
      barang: [{ kunci: "kemeja::KL-M", nama: "Kemeja Linen", varian: "KL-M", pcs: 7 }],
      jumlahPcs: 7,
      belumDikirimGudang: 4,
      dikemas: 1,
      dalamPerjalanan: 2,
    },
  ];

  it("dates are formatted on the server; numbers are pieces only", () => {
    const hp = pesananMenujuUntukHp(daftar, () => "4 Okt 2026");
    expect(hp).toEqual([
      {
        id: "a",
        orderNo: "PUTUS/2026/10/0007",
        status: "DIKIRIM_SEBAGIAN",
        tanggalLabel: "4 Okt 2026",
        inden: false,
        barang: [{ kunci: "kemeja::KL-M", nama: "Kemeja Linen", varian: "KL-M", pcs: 7 }],
        jumlahPcs: 7,
        belumDikirimGudang: 4,
        dikemas: 1,
        dalamPerjalanan: 2,
      },
    ]);
  });

  it("the JSON sent to the phone carries no price, total or value key", () => {
    const json = JSON.parse(JSON.stringify(pesananMenujuUntukHp(daftar, () => "x")));
    expect(kunciSemua(json).filter((k) => KUNCI_HARGA.test(k))).toEqual([]);
    expect(JSON.stringify(json)).not.toMatch(/Rp/);
  });
});

/*
 * Basis data sungguhan, dipakai bersama data dev: setiap baris diberi token
 * acak dan dihapus lewat `seededId(s)`. Jangan pernah dijalankan ke produksi.
 */
const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("pesanan menuju toko + kabar kiriman berangkat (basis data)", () => {
  const tag = `PMT-${Math.random().toString(36).slice(2, 8)}`;
  let uomId = "";
  let itemId = "";
  let kantorId = "";
  let salesId = "";
  let spg1 = "";
  let spg2 = "";
  let spgLain = "";
  let tokoPutus = "";
  let tokoKonsi = "";
  let tokoLain = "";
  let tokoTanpaSpg = "";
  const orderIds: string[] = [];
  const deliveryIds: string[] = [];
  const shipmentIds: string[] = [];
  const pengirimanIds: string[] = [];
  const receiptIds: string[] = [];
  let nomor = 0;

  const pesanan = async (data: {
    storeId: string;
    orderType?: "PUTUS" | "KONSI";
    status?: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
    deliveryStatus?: "PENDING" | "PARTIAL" | "DELIVERED" | "CLOSED";
    approvedAt?: Date | null;
    createdAt?: Date;
    lines: { variantSku: string; qty: number; deliveredQty?: number; cancelledQty?: number }[];
  }) => {
    nomor += 1;
    const o = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `${tag}-${nomor}`,
        storeId: data.storeId,
        salesmanId: salesId,
        orderType: data.orderType ?? "PUTUS",
        status: data.status ?? "PENDING_APPROVAL",
        deliveryStatus: data.deliveryStatus ?? "PENDING",
        approvedAt: data.approvedAt ?? null,
        ...(data.createdAt ? { createdAt: data.createdAt } : {}),
        subtotal: 500000,
        total: 500000,
        lines: {
          create: data.lines.map((l) => ({
            itemId,
            variantSku: l.variantSku,
            productName: "Kemeja Uji",
            qty: l.qty,
            deliveredQty: l.deliveredQty ?? 0,
            cancelledQty: l.cancelledQty ?? 0,
            unitPrice: 125000,
            lineTotal: 125000 * l.qty,
          })),
        },
      },
      select: { id: true, orderNo: true, lines: { select: { id: true, variantSku: true, qty: true } } },
    });
    orderIds.push(o.id);
    return o;
  };

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (await prisma.item.create({ data: { sku: tag, nameId: "Kemeja Uji", nameEn: "Test", type: "FINISHED_GOOD", uomId } })).id;
    const toko = async (k: string, termsType: "PUTUS" | "KONSI") =>
      (await prisma.store.create({ data: { code: `${tag}-${k}`, name: `Toko ${k} ${tag}`, address: "uji", termsType, isActive: true } })).id;
    tokoPutus = await toko("P", "PUTUS");
    tokoKonsi = await toko("K", "KONSI");
    tokoLain = await toko("L", "PUTUS");
    tokoTanpaSpg = await toko("T", "KONSI");
    const orang = async (n: string, assignedStoreId: string | null = null) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}`, assignedStoreId } })).id;
    kantorId = await orang("kantor");
    salesId = await orang("sales");
    spg1 = await orang("spg1", tokoPutus);
    spg2 = await orang("spg2", tokoPutus);
    spgLain = await orang("spglain", tokoLain);
  });

  beforeEach(() => {
    kabar.kirim.length = 0;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { action: seededId(JEJAK_KIRIMAN_BERANGKAT), entityId: { in: seededIds([...orderIds, ...deliveryIds, ...shipmentIds]) } },
    });
    await prisma.storeReceipt.deleteMany({ where: { id: { in: seededIds(receiptIds) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
    await prisma.consignmentShipment.deleteMany({ where: { id: { in: seededIds(shipmentIds) } } });
    // Pengiriman sebelum pesanannya (barisnya ikut terhapus).
    await prisma.deliveryShipment.deleteMany({ where: { id: { in: seededIds(pengirimanIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([kantorId, salesId, spg1, spg2, spgLain]) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoPutus, tokoKonsi, tokoLain, tokoTanpaSpg]) } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  describe("pesananMenujuToko", () => {
    it("lists this store's open orders by status with outstanding pieces, and nothing from another store", async () => {
      const tunggu = await pesanan({ storeId: tokoPutus, createdAt: lalu(1), lines: [{ variantSku: "KU-M", qty: 6 }, { variantSku: "KU-L", qty: 6 }] });
      const setuju = await pesanan({ storeId: tokoPutus, status: "APPROVED", approvedAt: lalu(1), createdAt: lalu(2), lines: [{ variantSku: "KU-M", qty: 12 }] });
      const sebagian = await pesanan({
        storeId: tokoPutus,
        status: "APPROVED",
        deliveryStatus: "PARTIAL",
        approvedAt: lalu(3),
        createdAt: lalu(4),
        lines: [{ variantSku: "KU-M", qty: 12, deliveredQty: 5 }],
      });
      await pesanan({ storeId: tokoPutus, status: "APPROVED", deliveryStatus: "DELIVERED", lines: [{ variantSku: "KU-M", qty: 3, deliveredQty: 3 }] });
      await pesanan({ storeId: tokoPutus, status: "REJECTED", lines: [{ variantSku: "KU-M", qty: 3 }] });
      await pesanan({ storeId: tokoLain, lines: [{ variantSku: "KU-M", qty: 9 }] });

      const daftar = await pesananMenujuToko(tokoPutus, SEKARANG);
      expect(daftar.map((p) => [p.orderNo, p.status, p.jumlahPcs])).toEqual([
        [sebagian.orderNo, "DIKIRIM_SEBAGIAN", 7],
        [setuju.orderNo, "DISETUJUI", 12],
        [tunggu.orderNo, "MENUNGGU_PERSETUJUAN", 12],
      ]);
      expect(daftar[2].barang).toEqual([
        { kunci: `${itemId}::KU-L`, nama: "Kemeja Uji", varian: "KU-L", pcs: 6 },
        { kunci: `${itemId}::KU-M`, nama: "Kemeja Uji", varian: "KU-M", pcs: 6 },
      ]);
      // Muatan yang benar-benar keluar dari kueri: tanpa satu pun kunci harga.
      expect(kunciSemua(JSON.parse(JSON.stringify(daftar))).filter((k) => KUNCI_HARGA.test(k))).toEqual([]);
    });

    it("an approved konsi order is 'approved, not yet sent' until a shipment departs; what is not on it stays 'not yet sent by the warehouse'", async () => {
      const o = await pesanan({ storeId: tokoKonsi, orderType: "KONSI", status: "APPROVED", approvedAt: lalu(2), lines: [{ variantSku: "KU-M", qty: 10 }] });

      const sebelum = await pesananMenujuToko(tokoKonsi, SEKARANG);
      expect(sebelum.map((p) => [p.orderNo, p.status, p.jumlahPcs, p.belumDikirimGudang])).toEqual([[o.orderNo, "DISETUJUI", 10, 10]]);

      const shp = await prisma.deliveryShipment.create({
        data: {
          docNo: `${tag}-SHP-${nomor}`,
          orderId: o.id,
          method: "SALESMAN_CARRY",
          status: "IN_TRANSIT",
          packedById: kantorId,
          shippedAt: SEKARANG,
          lines: { create: [{ orderLineId: o.lines[0].id, itemId, variantSku: "KU-M", plannedQty: 6 }] },
        },
        select: { id: true },
      });
      pengirimanIds.push(shp.id);

      const jalan = await pesananMenujuToko(tokoKonsi, SEKARANG);
      expect(jalan).toEqual([expect.objectContaining({ orderNo: o.orderNo, status: "DALAM_PERJALANAN", jumlahPcs: 10, dalamPerjalanan: 6, belumDikirimGudang: 4 })]);
      // Muatan yang benar-benar keluar dari kueri: tanpa satu pun kunci harga.
      expect(kunciSemua(JSON.parse(JSON.stringify(jalan))).filter((k) => KUNCI_HARGA.test(k))).toEqual([]);
    });
  });

  describe("kabarkanKirimanBerangkat", () => {
    async function kiriman(qty = 5) {
      const o = await pesanan({ storeId: tokoPutus, status: "APPROVED", deliveryStatus: "PARTIAL", approvedAt: lalu(1), lines: [{ variantSku: "KU-M", qty: 10, deliveredQty: qty }] });
      const dlv = await prisma.fieldSalesDelivery.create({
        data: {
          docNo: `${tag}-DLV-${nomor}`,
          orderId: o.id,
          deliveredAt: SEKARANG,
          deliveredById: kantorId,
          invoiceDate: SEKARANG,
          dueDate: SEKARANG,
          subtotal: 625000,
          total: 625000,
          lines: { create: [{ orderLineId: o.lines[0].id, itemId, variantSku: "KU-M", productName: "Kemeja Uji", qty, unitPrice: 125000, lineTotal: 125000 * qty }] },
        },
        select: { id: true, docNo: true },
      });
      deliveryIds.push(dlv.id);
      return dlv;
    }

    it("tells every SPG of the store once, in pieces, linking to the receive screen — never the office user, never another store", async () => {
      const dlv = await kiriman(5);
      const hasil = await kabarkanKirimanBerangkat({ sourceType: "PUTUS_DELIVERY", sourceId: dlv.id, pelakuId: kantorId });
      expect(hasil).toEqual({ penerima: 2 });
      expect(kabar.kirim.map((k) => k.userId).sort()).toEqual([spg1, spg2].sort());
      for (const k of kabar.kirim) {
        expect(k.jenis).toBe("KIRIMAN_BERANGKAT");
        expect(k.data).toEqual({ storeId: tokoPutus, sourceType: "PUTUS_DELIVERY", sourceId: dlv.id });
        expect(k.isi).toContain(dlv.docNo);
        expect(k.isi).toContain("5 pcs");
        expect(`${k.judul} ${k.isi}`).not.toMatch(/Rp|125/);
      }

      kabar.kirim.length = 0;
      expect(await kabarkanKirimanBerangkat({ sourceType: "PUTUS_DELIVERY", sourceId: dlv.id, pelakuId: kantorId })).toEqual({ penerima: 0 });
      expect(kabar.kirim).toEqual([]);
    });

    it("two simultaneous calls for the same document notify once (race)", async () => {
      const dlv = await kiriman(3);
      const hasil = await Promise.all([
        kabarkanKirimanBerangkat({ sourceType: "PUTUS_DELIVERY", sourceId: dlv.id, pelakuId: kantorId }),
        kabarkanKirimanBerangkat({ sourceType: "PUTUS_DELIVERY", sourceId: dlv.id, pelakuId: kantorId }),
      ]);
      expect(hasil.map((h) => h.penerima).sort()).toEqual([0, 2]);
      expect(kabar.kirim).toHaveLength(2);
      const jejak = await prisma.auditLog.count({ where: { action: JEJAK_KIRIMAN_BERANGKAT, entityId: dlv.id } });
      expect(jejak).toBe(1);
    });

    it("the person who recorded the shipment is never told about it — the store's other SPG still is", async () => {
      const dlv = await kiriman(4);
      expect(await kabarkanKirimanBerangkat({ sourceType: "PUTUS_DELIVERY", sourceId: dlv.id, pelakuId: spg1 })).toEqual({ penerima: 1 });
      expect(kabar.kirim.map((k) => k.userId)).toEqual([spg2]);
    });

    it("a consignment shipment notifies the store's SPG, in pieces, never with a price", async () => {
      const spgKonsi = (await prisma.user.create({ data: { email: `${tag}-spgk@test.local`.toLowerCase(), name: `SPG K ${tag}`, assignedStoreId: tokoKonsi } })).id;
      try {
        const k = await prisma.consignmentShipment.create({
          data: {
            noKirim: `${tag}-KRM`,
            storeId: tokoKonsi,
            shippedAt: SEKARANG,
            items: { create: [{ itemId, variantSku: "KU-M", itemName: "Kemeja Uji", qty: 6, price: 100000, amount: 600000 }] },
          },
        });
        shipmentIds.push(k.id);
        expect(await kabarkanKirimanBerangkat({ sourceType: "KONSI_SHIPMENT", sourceId: k.id, pelakuId: kantorId })).toEqual({ penerima: 1 });
        expect(kabar.kirim[0]).toMatchObject({ userId: spgKonsi, jenis: "KIRIMAN_BERANGKAT", data: { sourceType: "KONSI_SHIPMENT", sourceId: k.id } });
        expect(kabar.kirim[0].isi).toContain(`${tag}-KRM`);
        expect(kabar.kirim[0].isi).toContain("6 pcs");
        expect(kabar.kirim[0].isi).not.toMatch(/Rp|100\.000|600/);
      } finally {
        await prisma.user.delete({ where: { id: spgKonsi } });
      }
    });

    it("a store without an SPG writes nothing; a document already received is not announced", async () => {
      const k = await prisma.consignmentShipment.create({
        data: {
          noKirim: `${tag}-KRM-T`,
          storeId: tokoTanpaSpg,
          shippedAt: SEKARANG,
          items: { create: [{ itemId, variantSku: "KU-M", itemName: "Kemeja Uji", qty: 2, price: 0, amount: 0 }] },
        },
      });
      shipmentIds.push(k.id);
      expect(await kabarkanKirimanBerangkat({ sourceType: "KONSI_SHIPMENT", sourceId: k.id, pelakuId: kantorId })).toEqual({ penerima: 0 });
      expect(await prisma.auditLog.count({ where: { action: JEJAK_KIRIMAN_BERANGKAT, entityId: k.id } })).toBe(0);

      const dlv = await kiriman(2);
      receiptIds.push(
        (
          await prisma.storeReceipt.create({
            data: { storeId: tokoPutus, sourceType: "PUTUS_DELIVERY", sourceId: dlv.id, sourceDocNo: dlv.docNo, receivedById: spg1 },
          })
        ).id,
      );
      expect(await kabarkanKirimanBerangkat({ sourceType: "PUTUS_DELIVERY", sourceId: dlv.id, pelakuId: kantorId })).toEqual({ penerima: 0 });
      expect(kabar.kirim).toEqual([]);
    });

    it("an unknown document is quietly ignored", async () => {
      expect(await kabarkanKirimanBerangkat({ sourceType: "PUTUS_DELIVERY", sourceId: `${tag}-tidak-ada`, pelakuId: kantorId })).toEqual({ penerima: 0 });
    });
  });
});

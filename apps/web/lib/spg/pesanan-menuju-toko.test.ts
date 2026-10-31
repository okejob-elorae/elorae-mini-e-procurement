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

const kemeja = (variantSku: string, qty: number, lain: { deliveredQty?: number; cancelledQty?: number } = {}) => ({
  itemId: "kemeja",
  variantSku,
  productName: "Kemeja Linen",
  qty,
  deliveredQty: lain.deliveredQty ?? 0,
  cancelledQty: lain.cancelledQty ?? 0,
});

describe("susunPesananMenuju (murni)", () => {
  const opsi = { sejak: lalu(30), konsiDiterima: new Set<string>() };

  it("a pending order shows every piece ordered, per item and size", () => {
    const [p] = susunPesananMenuju([baris({ id: "a", lines: [kemeja("KL-M", 6), kemeja("KL-L", 4)] })], opsi);
    expect(p).toMatchObject({ id: "a", orderNo: "SO-a", status: "MENUNGGU_PERSETUJUAN", jumlahPcs: 10, inden: false });
    expect(p.barang).toEqual([
      { kunci: "kemeja::KL-L", nama: "Kemeja Linen", varian: "KL-L", pcs: 4 },
      { kunci: "kemeja::KL-M", nama: "Kemeja Linen", varian: "KL-M", pcs: 6 },
    ]);
  });

  it("an approved putus order not yet shipped counts what is still outstanding", () => {
    const [p] = susunPesananMenuju(
      [baris({ id: "b", status: "APPROVED", approvedAt: lalu(1), lines: [kemeja("KL-M", 12)] })],
      opsi,
    );
    expect(p).toMatchObject({ status: "DISETUJUI", jumlahPcs: 12 });
  });

  it("a partly shipped putus order lists only what has not left yet — a finished line drops out", () => {
    const [p] = susunPesananMenuju(
      [
        baris({
          id: "c",
          status: "APPROVED",
          deliveryStatus: "PARTIAL",
          lines: [kemeja("KL-M", 12, { deliveredQty: 5 }), kemeja("KL-S", 6, { deliveredQty: 6 })],
        }),
      ],
      opsi,
    );
    expect(p.status).toBe("DIKIRIM_SEBAGIAN");
    expect(p.barang).toEqual([{ kunci: "kemeja::KL-M", nama: "Kemeja Linen", varian: "KL-M", pcs: 7 }]);
    expect(p.jumlahPcs).toBe(7);
  });

  it("an approved konsi order is on its way until the store receives it", () => {
    const konsi = baris({
      id: "d",
      orderType: "KONSI",
      status: "APPROVED",
      approvedAt: lalu(2),
      lines: [kemeja("KL-M", 8, { cancelledQty: 2 })],
    });
    expect(susunPesananMenuju([konsi], opsi)).toEqual([expect.objectContaining({ status: "DALAM_PERJALANAN", jumlahPcs: 6 })]);
    expect(susunPesananMenuju([konsi], { ...opsi, konsiDiterima: new Set(["d"]) })).toEqual([]);
  });

  it("a konsi order approved before the store started tracking is already on the shelf", () => {
    const lama = baris({ id: "e", orderType: "KONSI", status: "APPROVED", approvedAt: lalu(45), lines: [kemeja("KL-M", 3)] });
    expect(susunPesananMenuju([lama], opsi)).toEqual([]);
  });

  it("delivered, closed, rejected and cancelled orders are not heading to the store", () => {
    const daftar = susunPesananMenuju(
      [
        baris({ id: "f", status: "APPROVED", deliveryStatus: "DELIVERED", lines: [kemeja("KL-M", 3, { deliveredQty: 3 })] }),
        baris({ id: "g", status: "APPROVED", deliveryStatus: "CLOSED", lines: [kemeja("KL-M", 3, { deliveredQty: 1, cancelledQty: 2 })] }),
        baris({ id: "h", status: "REJECTED", lines: [kemeja("KL-M", 3)] }),
      ],
      opsi,
    );
    expect(daftar).toEqual([]);
  });

  it("the same item and size on two lines (a bonus line) is one row", () => {
    const [p] = susunPesananMenuju([baris({ id: "i", lines: [kemeja("KL-M", 6), kemeja("KL-M", 1)] })], opsi);
    expect(p.barang).toEqual([{ kunci: "kemeja::KL-M", nama: "Kemeja Linen", varian: "KL-M", pcs: 7 }]);
  });

  it("an order with nothing left to send is left out", () => {
    const daftar = susunPesananMenuju(
      [baris({ id: "j", status: "APPROVED", deliveryStatus: "PARTIAL", lines: [kemeja("KL-M", 4, { deliveredQty: 2, cancelledQty: 2 })] })],
      opsi,
    );
    expect(daftar).toEqual([]);
  });

  it("goods already on the road come first, then partly shipped, approved, and waiting — oldest first within each", () => {
    const daftar = susunPesananMenuju(
      [
        baris({ id: "tunggu-baru", createdAt: lalu(1), lines: [kemeja("KL-M", 1)] }),
        baris({ id: "tunggu-lama", createdAt: lalu(3), lines: [kemeja("KL-M", 1)] }),
        baris({ id: "setuju", status: "APPROVED", createdAt: lalu(2), lines: [kemeja("KL-M", 1)] }),
        baris({ id: "jalan", orderType: "KONSI", status: "APPROVED", approvedAt: lalu(1), createdAt: lalu(1), lines: [kemeja("KL-M", 1)] }),
        baris({ id: "sebagian", status: "APPROVED", deliveryStatus: "PARTIAL", createdAt: lalu(5), lines: [kemeja("KL-M", 2, { deliveredQty: 1 })] }),
      ],
      opsi,
    );
    expect(daftar.map((p) => p.id)).toEqual(["jalan", "sebagian", "setuju", "tunggu-lama", "tunggu-baru"]);
  });

  it("a pre-order is marked as such", () => {
    const [p] = susunPesananMenuju([baris({ id: "k", status: "APPROVED", preorderWindowId: "w1", lines: [kemeja("KL-M", 2)] })], opsi);
    expect(p.inden).toBe(true);
  });

  it("the home count leaves out orders already on the road — those are counted as deliveries to receive", () => {
    const daftar = susunPesananMenuju(
      [
        baris({ id: "l", lines: [kemeja("KL-M", 1)] }),
        baris({ id: "m", status: "APPROVED", lines: [kemeja("KL-M", 1)] }),
        baris({ id: "n", orderType: "KONSI", status: "APPROVED", approvedAt: lalu(1), lines: [kemeja("KL-M", 1)] }),
      ],
      opsi,
    );
    expect(daftar).toHaveLength(3);
    expect(hitungPesananDiproses(daftar)).toBe(2);
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

    it("an approved konsi order stays on the list until the store receives it; one from before tracking never shows", async () => {
      const jalan = await pesanan({ storeId: tokoKonsi, orderType: "KONSI", status: "APPROVED", approvedAt: lalu(2), lines: [{ variantSku: "KU-M", qty: 4 }] });
      const lama = await pesanan({ storeId: tokoKonsi, orderType: "KONSI", status: "APPROVED", approvedAt: lalu(45), lines: [{ variantSku: "KU-M", qty: 4 }] });

      const sebelum = await pesananMenujuToko(tokoKonsi, SEKARANG);
      expect(sebelum.map((p) => [p.orderNo, p.status, p.jumlahPcs])).toEqual([[jalan.orderNo, "DALAM_PERJALANAN", 4]]);
      expect(sebelum.some((p) => p.orderNo === lama.orderNo)).toBe(false);

      receiptIds.push(
        (
          await prisma.storeReceipt.create({
            data: { storeId: tokoKonsi, sourceType: "KONSI_ORDER", sourceId: jalan.id, sourceDocNo: jalan.orderNo, receivedById: kantorId },
          })
        ).id,
      );
      expect(await pesananMenujuToko(tokoKonsi, SEKARANG)).toEqual([]);
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

    it("approving a putus order ships nothing, so no SPG is told", async () => {
      const o = await pesanan({ storeId: tokoPutus, status: "APPROVED", approvedAt: lalu(0), lines: [{ variantSku: "KU-M", qty: 2 }] });
      expect(await kabarkanKirimanBerangkat({ sourceType: "KONSI_ORDER", sourceId: o.id, pelakuId: kantorId })).toEqual({ penerima: 0 });
      expect(kabar.kirim).toEqual([]);
    });

    it("an approved konsi order and a consignment shipment each notify the store's SPG", async () => {
      const spgKonsi = (await prisma.user.create({ data: { email: `${tag}-spgk@test.local`.toLowerCase(), name: `SPG K ${tag}`, assignedStoreId: tokoKonsi } })).id;
      try {
        const o = await pesanan({ storeId: tokoKonsi, orderType: "KONSI", status: "APPROVED", approvedAt: lalu(0), lines: [{ variantSku: "KU-M", qty: 4, cancelledQty: 1 }] });
        expect(await kabarkanKirimanBerangkat({ sourceType: "KONSI_ORDER", sourceId: o.id, pelakuId: kantorId })).toEqual({ penerima: 1 });
        expect(kabar.kirim[0]).toMatchObject({ userId: spgKonsi, jenis: "KIRIMAN_BERANGKAT", data: { sourceType: "KONSI_ORDER", sourceId: o.id } });
        expect(kabar.kirim[0].isi).toContain("3 pcs");

        const k = await prisma.consignmentShipment.create({
          data: {
            noKirim: `${tag}-KRM`,
            storeId: tokoKonsi,
            shippedAt: SEKARANG,
            items: { create: [{ itemId, variantSku: "KU-M", itemName: "Kemeja Uji", qty: 6, price: 100000, amount: 600000 }] },
          },
        });
        shipmentIds.push(k.id);
        kabar.kirim.length = 0;
        expect(await kabarkanKirimanBerangkat({ sourceType: "KONSI_SHIPMENT", sourceId: k.id, pelakuId: kantorId })).toEqual({ penerima: 1 });
        expect(kabar.kirim[0].isi).toContain(`${tag}-KRM`);
        expect(kabar.kirim[0].isi).toContain("6 pcs");
        expect(kabar.kirim[0].isi).not.toMatch(/Rp|100\.000|600/);
      } finally {
        await prisma.user.delete({ where: { id: spgKonsi } });
      }
    });

    it("a store without an SPG writes nothing; a document already received is not announced", async () => {
      const o = await pesanan({ storeId: tokoTanpaSpg, orderType: "KONSI", status: "APPROVED", approvedAt: lalu(0), lines: [{ variantSku: "KU-M", qty: 2 }] });
      expect(await kabarkanKirimanBerangkat({ sourceType: "KONSI_ORDER", sourceId: o.id, pelakuId: kantorId })).toEqual({ penerima: 0 });
      expect(await prisma.auditLog.count({ where: { action: JEJAK_KIRIMAN_BERANGKAT, entityId: o.id } })).toBe(0);

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

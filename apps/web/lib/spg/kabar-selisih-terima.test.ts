import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Hasil terima kiriman (kurang/rusak) sampai ke salesman yang mengirim.
 *
 * Kabar dipalsukan: yang diuji SIAPA yang dikabari, BERAPA kali, dan angkanya
 * — bukan pengiriman push-nya. `JENIS_KABAR` tetap yang asli. Tes DB lewat
 * penulis sungguhan (`terimaKiriman`), terhadap fixture buatan tes yang
 * dibersihkan hanya lewat id yang diseed.
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
/*
 * Percobaan transaksi yang DIULANG (MariaDB 1213 di produksi; di Postgres lokal
 * balapan berkunci sama selesai lewat P2002, jadi jalur ini tidak pernah lewat).
 * Bila `uji.selaUlang` diisi: percobaan pertama berjalan penuh lalu dibatalkan,
 * `selaUlang` dijalankan (mis. HP lain menang), lalu transaksinya diulang.
 */
const uji = vi.hoisted(() => ({ selaUlang: null as null | (() => Promise<void>) }));
vi.mock("@/lib/db/tx-retry", async (asli) => {
  const m = await asli<typeof import("@/lib/db/tx-retry")>();
  const { prisma } = await import("@elorae/db");
  return {
    ...m,
    runSerializable: async (cb: Parameters<typeof m.runSerializable>[0]) => {
      const sela = uji.selaUlang;
      if (!sela) return m.runSerializable(cb);
      uji.selaUlang = null;
      const batal = new Error("percobaan pertama dibatalkan");
      await prisma
        .$transaction(async (tx) => {
          await cb(tx);
          throw batal;
        })
        .catch((e) => {
          if (e !== batal) throw e;
        });
      await sela();
      return m.runSerializable(cb);
    },
  };
});

import { prisma, seededId, seededIds } from "@elorae/db";
import { tautanKabar } from "@/lib/notifications/tautan-kabar";
import { adaSelisih, hitungSelisihTerima, teksSelisih } from "./selisih-terima";
import { susunKabarSelisih } from "./kabar-selisih-terima";
import { terimaKiriman } from "./stok-writer";
import { KATEGORI_NOTIF_RUSAK } from "./rusak";

/** Kunci/teks yang tidak boleh ada di kabar ke HP salesman — rupiah dalam bentuk apa pun. */
const KUNCI_HARGA = /price|harga|total|subtotal|diskon|discount|nilai|rupiah|amount|margin/i;

describe("selisih terima (murni)", () => {
  it("counts sent, arrived, short and damaged per line — an extra piece on one line never covers a short one", () => {
    const s = hitungSelisihTerima([
      { qtySent: 10, qtyReceived: 8, qtyDamaged: 1 },
      { qtySent: 4, qtyReceived: 5, qtyDamaged: 0 },
      { qtySent: 3, qtyReceived: 3 },
    ]);
    expect(s).toEqual({ dikirim: 17, diterima: 16, kurang: 2, rusak: 1 });
    expect(adaSelisih(s)).toBe(true);
    expect(teksSelisih(s)).toBe("kurang 2 pcs, rusak 1 pcs");
  });

  it("an exact receipt has nothing to tell; a zero part is not written", () => {
    const pas = hitungSelisihTerima([{ qtySent: 6, qtyReceived: 6, qtyDamaged: 0 }]);
    expect(adaSelisih(pas)).toBe(false);
    expect(teksSelisih(pas)).toBe("");
    expect(teksSelisih({ kurang: 3, rusak: 0 })).toBe("kurang 3 pcs");
    expect(teksSelisih({ kurang: 0, rusak: 2 })).toBe("rusak 2 pcs");
  });

  it("the message names the document, the store and the pieces — never rupiah — and links to the order or the store", () => {
    const k = susunKabarSelisih({
      sourceType: "KONSI_ORDER",
      sourceId: "o1",
      storeId: "s1",
      docNo: "KONSI/2026/10/0003",
      namaToko: "Toko Melati",
      orderId: "o1",
      selisih: { dikirim: 12, diterima: 10, kurang: 2, rusak: 1 },
    });
    expect(k.jenis).toBe("KIRIMAN_DITERIMA_SELISIH");
    expect(k.judul).toBe("Kiriman KONSI/2026/10/0003: kurang 2 pcs, rusak 1 pcs");
    expect(k.isi).toBe("Toko Melati: tiba 10 dari 12 pcs — kurang 2 pcs, rusak 1 pcs.");
    expect(`${k.judul} ${k.isi}`).not.toMatch(/Rp/);
    expect(Object.keys(k.data).filter((x) => KUNCI_HARGA.test(x))).toEqual([]);
    expect(tautanKabar(k.jenis, k.data)).toBe("/pwa/orders/o1");

    const titipan = susunKabarSelisih({
      sourceType: "KONSI_SHIPMENT",
      sourceId: "k1",
      storeId: "s1",
      docNo: "KRM-1",
      namaToko: "Toko Melati",
      orderId: null,
      selisih: { dikirim: 5, diterima: 5, kurang: 0, rusak: 2 },
    });
    expect(titipan.data).toEqual({ storeId: "s1", sourceType: "KONSI_SHIPMENT", sourceId: "k1" });
    expect(tautanKabar(titipan.jenis, titipan.data)).toBe("/pwa/stores/s1");
    expect(tautanKabar("KIRIMAN_DITERIMA_SELISIH", {})).toBe("/pwa/orders");
  });
});

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;
const tag = `KST-${Math.random().toString(36).slice(2, 9)}`;
/** Tag acak bisa memuat angka apa pun — buang dulu sebelum mencari angka harga di teks. */
const tanpaTag = (teks: string) => teks.split(tag).join("");
const HARI = 86_400_000;

d("kabar hasil terima kiriman ke salesman (test bed only)", () => {
  let uomId = "";
  let itemId = "";
  let tokoPutus = "";
  let tokoKonsi = "";
  let tokoTanpaPemegang = "";
  let salesPesanan = "";
  let pemegang = "";
  let kantor = "";
  let spgPutus = "";
  let spgKonsi = "";
  let spgTanpa = "";
  let nomor = 0;
  const orderIds: string[] = [];
  const deliveryIds: string[] = [];
  const shipmentIds: string[] = [];

  const tokoIds = () => seededIds([tokoPutus, tokoKonsi, tokoTanpaPemegang].filter(Boolean));

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tag, nameId: "Kemeja Uji", nameEn: "Test shirt", type: "FINISHED_GOOD", uomId, sellingPrice: 125_000 },
      })
    ).id;
    const orang = async (n: string, assignedStoreId: string | null = null) =>
      (await prisma.user.create({ data: { email: `${tag}-${n}@test.local`.toLowerCase(), name: `${n} ${tag}`, assignedStoreId } })).id;
    salesPesanan = await orang("sales");
    pemegang = await orang("pemegang");
    kantor = await orang("kantor");
    const toko = async (k: string, termsType: "PUTUS" | "KONSI", salesmanId: string | null) =>
      (
        await prisma.store.create({
          data: { code: `${tag}-${k}`, name: `Toko ${k} ${tag}`, address: "uji", termsType, marginPercent: 25, isActive: true, salesmanId },
        })
      ).id;
    // Pemegang toko SENGAJA bukan salesman pesanannya: kabar pesanan ke salesman pesanan, titipan ke pemegang.
    tokoPutus = await toko("P", "PUTUS", pemegang);
    tokoKonsi = await toko("K", "KONSI", pemegang);
    tokoTanpaPemegang = await toko("T", "KONSI", null);
    spgPutus = await orang("spg-p", tokoPutus);
    spgKonsi = await orang("spg-k", tokoKonsi);
    spgTanpa = await orang("spg-t", tokoTanpaPemegang);
  });

  beforeEach(() => {
    kabar.kirim.length = 0;
    uji.selaUlang = null;
  });

  afterEach(async () => {
    const receipts = await prisma.storeReceipt.findMany({ where: { storeId: { in: tokoIds() } }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    // Catatan kantor barang rusak dicocokkan di JS lewat metadata, lalu dihapus per id.
    const catatan = await prisma.adminNotification.findMany({ where: { category: KATEGORI_NOTIF_RUSAK }, select: { id: true, metadata: true } });
    const milikUji = catatan
      .filter((c) => {
        const m = c.metadata as Record<string, unknown> | null;
        return typeof m?.receiptId === "string" && receiptIds.includes(m.receiptId);
      })
      .map((c) => c.id);
    await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.storeReceipt.deleteMany({ where: { id: { in: seededIds(receiptIds) } } });
  });

  afterAll(async () => {
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
    await prisma.consignmentShipment.deleteMany({ where: { id: { in: seededIds(shipmentIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    // SPG menunjuk tokonya, toko menunjuk pemegangnya: SPG dulu, lalu toko, lalu sisanya.
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgPutus, spgKonsi, spgTanpa].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesPesanan, pemegang, kantor].filter(Boolean)) } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  async function pesanan(storeId: string, orderType: "PUTUS" | "KONSI", qty: number) {
    nomor += 1;
    const o = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `${tag}-${orderType}-${nomor}`,
        storeId,
        salesmanId: salesPesanan,
        orderType,
        status: "APPROVED",
        deliveryStatus: orderType === "PUTUS" ? "DELIVERED" : "PENDING",
        approvedAt: new Date(Date.now() - HARI),
        subtotal: 125_000 * qty,
        total: 125_000 * qty,
        lines: {
          create: [{ itemId, variantSku: `${tag}-M`, productName: "Kemeja Uji — M", qty, deliveredQty: orderType === "PUTUS" ? qty : 0, unitPrice: 125_000, lineTotal: 125_000 * qty }],
        },
      },
      select: { id: true, orderNo: true, lines: { select: { id: true } } },
    });
    orderIds.push(o.id);
    return o;
  }

  /** Pengiriman putus `qty` potong ke toko putus. */
  async function pengirimanPutus(qty: number) {
    const o = await pesanan(tokoPutus, "PUTUS", qty);
    const dlv = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `${tag}-DLV-${nomor}`,
        orderId: o.id,
        deliveredAt: new Date(Date.now() - HARI),
        deliveredById: kantor,
        invoiceDate: new Date(),
        dueDate: new Date(),
        subtotal: 125_000 * qty,
        total: 125_000 * qty,
        lines: {
          create: [{ orderLineId: o.lines[0].id, itemId, variantSku: `${tag}-M`, productName: "Kemeja Uji — M", qty, unitPrice: 125_000, lineTotal: 125_000 * qty }],
        },
      },
      select: { id: true, docNo: true, lines: { select: { id: true } } },
    });
    deliveryIds.push(dlv.id);
    return { orderId: o.id, id: dlv.id, docNo: dlv.docNo, line: dlv.lines[0].id };
  }

  async function titipan(storeId: string, qty: number) {
    nomor += 1;
    const k = await prisma.consignmentShipment.create({
      data: {
        noKirim: `${tag}-KRM-${nomor}`,
        storeId,
        shippedAt: new Date(Date.now() - HARI),
        items: { create: [{ itemId, variantSku: `${tag}-M`, itemName: "Kemeja Uji", qty, price: 100_000, amount: 100_000 * qty }] },
      },
      select: { id: true, noKirim: true, items: { select: { id: true } } },
    });
    shipmentIds.push(k.id);
    return { id: k.id, docNo: k.noKirim, line: k.items[0].id };
  }

  it("a short putus delivery with damage tells the order's salesman once, in pieces, linking to the order", async () => {
    const dlv = await pengirimanPutus(10);
    const r = await terimaKiriman({
      storeId: tokoPutus,
      userId: spgPutus,
      sourceType: "PUTUS_DELIVERY",
      sourceId: dlv.id,
      diterima: [{ lineId: dlv.line, qtyReceived: 8, qtyDamaged: 1, damageNote: "Sobek" }],
    });
    expect(r.ok).toBe(true);
    expect(kabar.kirim).toHaveLength(1);
    const [k] = kabar.kirim;
    expect(k.userId).toBe(salesPesanan);
    expect(k.jenis).toBe("KIRIMAN_DITERIMA_SELISIH");
    expect(k.judul).toBe(`Kiriman ${dlv.docNo}: kurang 2 pcs, rusak 1 pcs`);
    expect(k.isi).toBe(`Toko P ${tag}: tiba 8 dari 10 pcs — kurang 2 pcs, rusak 1 pcs.`);
    expect(k.data).toEqual({ orderId: dlv.orderId, storeId: tokoPutus, sourceType: "PUTUS_DELIVERY", sourceId: dlv.id });
    expect(tanpaTag(`${k.judul} ${k.isi}`)).not.toMatch(/Rp|125/);
  });

  it("an exact receipt tells nobody", async () => {
    const dlv = await pengirimanPutus(6);
    const r = await terimaKiriman({
      storeId: tokoPutus,
      userId: spgPutus,
      sourceType: "PUTUS_DELIVERY",
      sourceId: dlv.id,
      diterima: [{ lineId: dlv.line, qtyReceived: 6 }],
    });
    expect(r.ok).toBe(true);
    expect(kabar.kirim).toEqual([]);
  });

  it("a short konsi order goes to the order's salesman, never with a price", async () => {
    const o = await pesanan(tokoKonsi, "KONSI", 12);
    const r = await terimaKiriman({
      storeId: tokoKonsi,
      userId: spgKonsi,
      sourceType: "KONSI_ORDER",
      sourceId: o.id,
      diterima: [{ lineId: o.lines[0].id, qtyReceived: 9 }],
    });
    expect(r.ok).toBe(true);
    expect(kabar.kirim).toEqual([
      expect.objectContaining({
        userId: salesPesanan,
        jenis: "KIRIMAN_DITERIMA_SELISIH",
        judul: `Kiriman ${o.orderNo}: kurang 3 pcs`,
        data: { orderId: o.id, storeId: tokoKonsi, sourceType: "KONSI_ORDER", sourceId: o.id },
      }),
    ]);
    const muatan = tanpaTag(JSON.stringify(kabar.kirim.map((k) => ({ judul: k.judul, isi: k.isi, data: Object.keys(k.data) }))));
    expect(muatan).not.toMatch(/Rp|125000|125\.000|100000/);
  });

  it("a consignment shipment goes to the store's holder; a store with no holder tells nobody", async () => {
    const k = await titipan(tokoKonsi, 5);
    await terimaKiriman({
      storeId: tokoKonsi,
      userId: spgKonsi,
      sourceType: "KONSI_SHIPMENT",
      sourceId: k.id,
      diterima: [{ lineId: k.line, qtyReceived: 5, qtyDamaged: 2, damageNote: "Noda" }],
    });
    expect(kabar.kirim).toEqual([
      expect.objectContaining({
        userId: pemegang,
        judul: `Kiriman ${k.docNo}: rusak 2 pcs`,
        data: { storeId: tokoKonsi, sourceType: "KONSI_SHIPMENT", sourceId: k.id },
      }),
    ]);
    expect(tautanKabar(kabar.kirim[0].jenis, kabar.kirim[0].data)).toBe(`/pwa/stores/${tokoKonsi}`);

    kabar.kirim.length = 0;
    const tanpa = await titipan(tokoTanpaPemegang, 5);
    const r = await terimaKiriman({
      storeId: tokoTanpaPemegang,
      userId: spgTanpa,
      sourceType: "KONSI_SHIPMENT",
      sourceId: tanpa.id,
      diterima: [{ lineId: tanpa.line, qtyReceived: 3 }],
    });
    expect(r.ok).toBe(true);
    expect(kabar.kirim).toEqual([]);
  });

  it("resending with the same key (lost answer, offline queue) returns the same receipt and tells nobody again", async () => {
    const dlv = await pengirimanPutus(10);
    const kirim = () =>
      terimaKiriman({
        storeId: tokoPutus,
        userId: spgPutus,
        sourceType: "PUTUS_DELIVERY",
        sourceId: dlv.id,
        diterima: [{ lineId: dlv.line, qtyReceived: 7 }],
        idempotencyKey: `${tag}-kunci-${dlv.id}`,
      });
    const pertama = await kirim();
    const kedua = await kirim();
    expect(pertama).toEqual(kedua);
    expect(kabar.kirim).toHaveLength(1);
    expect(kabar.kirim[0].judul).toBe(`Kiriman ${dlv.docNo}: kurang 3 pcs`);
  });

  it("two phones sending the same key at once record one receipt and one message", async () => {
    const dlv = await pengirimanPutus(10);
    const kirim = () =>
      terimaKiriman({
        storeId: tokoPutus,
        userId: spgPutus,
        sourceType: "PUTUS_DELIVERY",
        sourceId: dlv.id,
        diterima: [{ lineId: dlv.line, qtyReceived: 4 }],
        idempotencyKey: `${tag}-balap-${dlv.id}`,
      });
    const hasil = await Promise.all([kirim(), kirim()]);
    expect(hasil.every((h) => h.ok)).toBe(true);
    expect(await prisma.storeReceipt.count({ where: { sourceType: "PUTUS_DELIVERY", sourceId: dlv.id } })).toBe(1);
    expect(kabar.kirim).toHaveLength(1);
    expect(kabar.kirim[0].userId).toBe(salesPesanan);
  });

  it("a retried transaction that finds the winner's receipt by key tells nobody — the aborted attempt's numbers are dropped", async () => {
    const dlv = await pengirimanPutus(10);
    const kunci = `${tag}-ulang-${dlv.id}`;
    let pemenang = "";
    uji.selaUlang = async () => {
      // HP lain dengan kunci yang sama menang di antara dua percobaan; kabarnya dikirim panggilannya sendiri.
      pemenang = (
        await prisma.storeReceipt.create({
          data: {
            storeId: tokoPutus,
            sourceType: "PUTUS_DELIVERY",
            sourceId: dlv.id,
            sourceDocNo: dlv.docNo,
            receivedById: spgPutus,
            idempotencyKey: kunci,
            lines: { create: [{ itemId, variantSku: `${tag}-M`, productName: "Kemeja Uji — M", qtySent: 10, qtyReceived: 6 }] },
          },
          select: { id: true },
        })
      ).id;
    };
    const r = await terimaKiriman({
      storeId: tokoPutus,
      userId: spgPutus,
      sourceType: "PUTUS_DELIVERY",
      sourceId: dlv.id,
      diterima: [{ lineId: dlv.line, qtyReceived: 6 }],
      idempotencyKey: kunci,
    });
    // Skenarionya benar-benar berjalan: percobaan pertama dibatalkan, pemenang tercatat.
    expect(uji.selaUlang).toBeNull();
    expect(pemenang).not.toBe("");
    expect(r).toEqual({ ok: true, receiptId: pemenang });
    expect(await prisma.storeReceipt.count({ where: { sourceType: "PUTUS_DELIVERY", sourceId: dlv.id } })).toBe(1);
    expect(kabar.kirim).toEqual([]);
  });
});

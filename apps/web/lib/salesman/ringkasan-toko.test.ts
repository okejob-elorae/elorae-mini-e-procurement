import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { gabungFavorit, pilihFakturRingkas, ringkasanToko, HARI_FAVORIT } from "./ringkasan-toko";
import { bacaAturanKreditDb } from "./tagihan-toko";

const iso = (s: string) => new Date(s).toISOString();

describe("pilihFakturRingkas", () => {
  const baris = [
    { id: "a", invoiceNo: "INV-A", keadaan: "belum" as const, outstanding: 100, dueDate: iso("2026-10-20"), alasan: {} },
    { id: "b", invoiceNo: "INV-B", keadaan: "lewat" as const, outstanding: 200, dueDate: iso("2026-10-30"), alasan: { janjiBayar: iso("2026-09-20"), hariTerlambat: 10 } },
    { id: "c", invoiceNo: "INV-C", keadaan: "tt" as const, outstanding: 300, dueDate: iso("2026-11-30"), alasan: { janjiBayar: iso("2026-10-05") } },
    { id: "d", invoiceNo: "INV-D", keadaan: "lunas" as const, outstanding: 0, dueDate: iso("2026-09-01"), alasan: {} },
    { id: "e", invoiceNo: "INV-E", keadaan: "lewat" as const, outstanding: 50, dueDate: iso("2026-10-01"), alasan: { janjiBayar: iso("2026-09-28"), hariTerlambat: 2 } },
  ];

  it("yang lewat janji dulu, lalu tanggal terdekat; yang lunas tidak ikut", () => {
    const { faktur, lebih } = pilihFakturRingkas(baris, 0);
    expect(faktur.map((f) => f.invoiceNo)).toEqual(["INV-B", "INV-E", "INV-C", "INV-A"]);
    expect(lebih).toBe(0);
  });

  it("tanggal acuan = janji bayar bila ada, selain itu jatuh tempo", () => {
    const { faktur } = pilihFakturRingkas(baris, 0);
    const byNo = new Map(faktur.map((f) => [f.invoiceNo, f]));
    expect(byNo.get("INV-C")).toMatchObject({ jenisTanggal: "janji", tanggal: iso("2026-10-05") });
    expect(byNo.get("INV-A")).toMatchObject({ jenisTanggal: "jatuhTempo", tanggal: iso("2026-10-20") });
  });

  it("toleransi hari: lewat 2 hari dengan toleransi 3 bukan 'lewat'", () => {
    const { faktur } = pilihFakturRingkas(baris, 3);
    expect(faktur.find((f) => f.invoiceNo === "INV-E")?.lewat).toBe(false);
    expect(faktur.find((f) => f.invoiceNo === "INV-B")?.lewat).toBe(true);
    expect(faktur[0].invoiceNo).toBe("INV-B");
  });

  it("dibatasi, sisanya dihitung", () => {
    const { faktur, lebih } = pilihFakturRingkas(baris, 0, 2);
    expect(faktur).toHaveLength(2);
    expect(lebih).toBe(2);
  });
});

describe("gabungFavorit", () => {
  it("menjumlahkan antarsumber, terbanyak dulu, dibatasi, nol dibuang", () => {
    expect(
      gabungFavorit(
        [
          { itemId: "x", pcs: 5 },
          { itemId: "y", pcs: 12 },
          { itemId: "x", pcs: 9 },
          { itemId: "z", pcs: 0 },
          { itemId: "w", pcs: 1 },
        ],
        2,
      ),
    ).toEqual([
      { itemId: "x", pcs: 14 },
      { itemId: "y", pcs: 12 },
    ]);
  });

  it("seri diurutkan pasti", () => {
    expect(gabungFavorit([{ itemId: "b", pcs: 3 }, { itemId: "a", pcs: 3 }]).map((f) => f.itemId)).toEqual(["a", "b"]);
  });
});

/*
 * Bagian di bawah menulis ke basis data. Jangan pernah dijalankan ke basis data
 * produksi (terowongan :3307 / host VPS).
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("ringkasanToko (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const HARI = 86_400_000;
  const sekarang = new Date();
  let uomId = "";
  let itemIds: string[] = [];
  let salesAId = "";
  let salesBId = "";
  let tokoPutusId = "";
  let tokoKonsiId = "";
  let tokoTanpaPemegangId = "";
  let orderIds: string[] = [];
  let deliveryIds: string[] = [];
  let receivableIds: string[] = [];
  let noteIds: string[] = [];
  let visitIds: string[] = [];

  beforeAll(async () => {
    uomId = "";
    itemIds = [];
    salesAId = "";
    salesBId = "";
    tokoPutusId = "";
    tokoKonsiId = "";
    tokoTanpaPemegangId = "";
    orderIds = [];
    deliveryIds = [];
    receivableIds = [];
    noteIds = [];
    visitIds = [];

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-RT-${token}`, nameId: "t", nameEn: "t" } })).id;
    for (const k of ["A", "B", "C"]) {
      const it = await prisma.item.create({
        data: { sku: `TEST-RT-${k}-${token}`, nameId: `Barang ${k}`, nameEn: `Item ${k}`, type: "FINISHED_GOOD", uomId },
      });
      itemIds.push(it.id);
    }
    const [itemA, itemB, itemC] = itemIds;
    salesAId = (await prisma.user.create({ data: { email: `test-rt-a-${token}@example.com`, name: "Sales A" } })).id;
    salesBId = (await prisma.user.create({ data: { email: `test-rt-b-${token}@example.com`, name: "Sales B" } })).id;
    tokoPutusId = (
      await prisma.store.create({
        data: { code: `TEST-RT-P-${token}`, name: "Toko RT Putus", address: "x", termsType: "PUTUS", salesmanId: salesAId },
      })
    ).id;
    tokoKonsiId = (
      await prisma.store.create({ data: { code: `TEST-RT-K-${token}`, name: "Toko RT Konsi", address: "x", termsType: "KONSI" } })
    ).id;
    tokoTanpaPemegangId = (
      await prisma.store.create({ data: { code: `TEST-RT-N-${token}`, name: "Toko RT Bebas", address: "x", termsType: "PUTUS" } })
    ).id;

    // Pesanan PUTUS dengan dua kiriman: satu baru (ikut), satu 200 hari lalu (di luar jendela).
    const o = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `TEST-RT-${token}-1`,
        storeId: tokoPutusId,
        salesmanId: salesBId,
        status: "APPROVED",
        orderType: "PUTUS",
        deliveryStatus: "DELIVERED",
        subtotal: 100000,
        total: 100000,
        approvedAt: new Date(sekarang.getTime() - 1 * HARI),
        lines: {
          create: [
            { itemId: itemA, productName: "Barang A", qty: 10, unitPrice: 5000, lineTotal: 50000, deliveredQty: 10 },
            { itemId: itemB, productName: "Barang B", qty: 10, unitPrice: 5000, lineTotal: 50000, deliveredQty: 10 },
          ],
        },
      },
      include: { lines: true },
    });
    orderIds.push(o.id);
    const lineA = o.lines.find((l) => l.itemId === itemA)!;
    const lineB = o.lines.find((l) => l.itemId === itemB)!;
    const kirim = async (n: number, hariLalu: number, lines: Array<{ orderLineId: string; itemId: string; qty: number }>) => {
      const dlv = await prisma.fieldSalesDelivery.create({
        data: {
          docNo: `TEST-RT-DLV-${token}-${n}`,
          orderId: o.id,
          deliveredAt: new Date(sekarang.getTime() - hariLalu * HARI),
          deliveredById: salesBId,
          invoiceDate: new Date(),
          dueDate: new Date(),
          subtotal: 0,
          total: 0,
          lines: { create: lines.map((l) => ({ ...l, productName: "x" })) },
        },
      });
      deliveryIds.push(dlv.id);
    };
    await kirim(1, 3, [{ orderLineId: lineA.id, itemId: itemA, qty: 4 }, { orderLineId: lineB.id, itemId: itemB, qty: 9 }]);
    await kirim(2, HARI_FAVORIT + 20, [{ orderLineId: lineA.id, itemId: itemA, qty: 50 }]);

    // Pesanan lebih baru tapi DITOLAK — bukan pesanan terakhir.
    const tolak = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `TEST-RT-${token}-2`, storeId: tokoPutusId, salesmanId: salesAId, status: "REJECTED", orderType: "PUTUS",
        subtotal: 1, total: 1, rejectedAt: new Date(),
      },
    });
    orderIds.push(tolak.id);

    // Toko konsi: pesanan disetujui menyumbang favorit; yang menunggu tidak.
    const konsiOk = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `TEST-RT-${token}-3`, storeId: tokoKonsiId, salesmanId: salesAId, status: "APPROVED", orderType: "KONSI",
        subtotal: 0, total: 0, approvedAt: new Date(),
        lines: { create: [{ itemId: itemC, productName: "Barang C", qty: 7, unitPrice: 0, lineTotal: 0 }] },
      },
    });
    const konsiTunggu = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `TEST-RT-${token}-4`, storeId: tokoKonsiId, salesmanId: salesAId, status: "PENDING_APPROVAL", orderType: "KONSI",
        subtotal: 0, total: 0,
        lines: { create: [{ itemId: itemA, productName: "Barang A", qty: 99, unitPrice: 0, lineTotal: 0 }] },
      },
    });
    orderIds.push(konsiOk.id, konsiTunggu.id);

    // Piutang toko putus: satu lewat janji (kontrabon 60 hari lalu), satu belum.
    const r1 = await prisma.receivable.create({
      data: {
        invoiceNo: `TEST-RT-INV-${token}-1`, storeId: tokoPutusId, invoiceDate: new Date(), dueDate: new Date(sekarang.getTime() + 10 * HARI),
        amount: 100000, outstanding: 100000, salesmanId: salesBId,
      },
    });
    const r2 = await prisma.receivable.create({
      data: {
        invoiceNo: `TEST-RT-INV-${token}-2`, storeId: tokoPutusId, invoiceDate: new Date(), dueDate: new Date(sekarang.getTime() + 20 * HARI),
        amount: 50000, outstanding: 50000, salesmanId: salesBId,
      },
    });
    receivableIds.push(r1.id, r2.id);
    const note = await prisma.collectionNote.create({
      data: {
        docNo: `TEST-RT-KB-${token}`, storeId: tokoPutusId, salesmanId: salesBId,
        handoverDate: new Date(sekarang.getTime() - 70 * HARI), promisedDate: new Date(sekarang.getTime() - 60 * HARI),
        receivableLinks: { create: [{ receivableId: r1.id, amount: 100000 }] },
      },
    });
    noteIds.push(note.id);

    // Piutang di toko tanpa pemegang, dijual B.
    const r3 = await prisma.receivable.create({
      data: {
        invoiceNo: `TEST-RT-INV-${token}-3`, storeId: tokoTanpaPemegangId, invoiceDate: new Date(), dueDate: new Date(),
        amount: 1000, outstanding: 1000, salesmanId: salesBId,
      },
    });
    receivableIds.push(r3.id);

    // Kunjungan: B kemarin (selesai), A sekarang (masih berjalan).
    const v1 = await prisma.storeVisit.create({
      data: {
        storeId: tokoPutusId, userId: salesBId, checkinAt: new Date(sekarang.getTime() - HARI),
        checkoutAt: new Date(sekarang.getTime() - HARI + 3_600_000), checkinLat: 0, checkinLng: 0,
      },
    });
    const v2 = await prisma.storeVisit.create({ data: { storeId: tokoPutusId, userId: salesAId, checkinLat: 0, checkinLng: 0 } });
    visitIds.push(v1.id, v2.id);
  });

  afterAll(async () => {
    await prisma.storeVisit.deleteMany({ where: { id: { in: seededIds(visitIds) } } });
    await prisma.collectionNoteReceivable.deleteMany({ where: { collectionNoteId: { in: seededIds(noteIds) } } });
    await prisma.collectionNote.deleteMany({ where: { id: { in: seededIds(noteIds) } } });
    await prisma.receivable.deleteMany({ where: { id: { in: seededIds(receivableIds) } } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { deliveryId: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds(itemIds) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoPutusId, tokoKonsiId, tokoTanpaPemegangId]) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesAId, salesBId]) } } });
  });

  it("toko yang tidak ada → null", async () => {
    expect(await ringkasanToko("tidak-ada")).toBeNull();
  });

  it("tagihan toko putus: total, faktur mendesak dulu, dan boleh dilihat pemegangnya", async () => {
    const tol = (await bacaAturanKreditDb()).hariToleransi;
    const r = await ringkasanToko(tokoPutusId, { penontonId: salesAId });
    expect(r!.jenisToko).toBe("PUTUS");
    expect(r!.tagihan).toMatchObject({ sisa: 150000, fakturTerbuka: 2, lebih: 0, bolehLihat: true });
    expect(r!.tagihan!.lewatJanji).toBe(60 > tol ? 100000 : 0);
    expect(r!.tagihan!.faktur[0]).toMatchObject({ invoiceNo: `TEST-RT-INV-${token}-1`, keadaan: "lewat", jenisTanggal: "janji" });
    expect(r!.tagihan!.faktur[1]).toMatchObject({ keadaan: "belum", jenisTanggal: "jatuhTempo", sisa: 50000 });
  });

  it("penjual yang bukan pemegang toko tidak diberi tautan tagihan", async () => {
    const r = await ringkasanToko(tokoPutusId, { penontonId: salesBId });
    expect(r!.tagihan!.bolehLihat).toBe(false);
  });

  it("toko tanpa pemegang: penjual fakturnya yang boleh melihat", async () => {
    expect((await ringkasanToko(tokoTanpaPemegangId, { penontonId: salesBId }))!.tagihan!.bolehLihat).toBe(true);
    expect((await ringkasanToko(tokoTanpaPemegangId, { penontonId: salesAId }))!.tagihan!.bolehLihat).toBe(false);
  });

  it("favorit dari kiriman 180 hari terakhir, pesanan terakhir bukan yang ditolak", async () => {
    const r = await ringkasanToko(tokoPutusId, { penontonId: salesAId });
    expect(r!.favorit.map((f) => [f.nama, f.pcs])).toEqual([
      ["Barang B", 9],
      ["Barang A", 4],
    ]);
    expect(r!.pesananTerakhir).toMatchObject({ orderNo: `TEST-RT-${token}-1`, total: 100000, milikSaya: false, keadaan: "TERKIRIM" });
  });

  it("kunjungan terakhir melewati kunjungan penonton yang masih berjalan", async () => {
    const a = await ringkasanToko(tokoPutusId, { penontonId: salesAId });
    expect(a!.kunjunganTerakhir).toMatchObject({ oleh: "Sales B", olehSaya: false });
    const b = await ringkasanToko(tokoPutusId, { penontonId: salesBId });
    expect(b!.kunjunganTerakhir).toMatchObject({ oleh: "Sales A", olehSaya: false });
  });

  it("toko konsi: tanpa tagihan, favorit dari pesanan disetujui saja, nilai konsi tunggu disembunyikan", async () => {
    const r = await ringkasanToko(tokoKonsiId, { penontonId: salesAId });
    expect(r!.jenisToko).toBe("KONSI");
    expect(r!.tagihan).toBeNull();
    expect(r!.favorit.map((f) => [f.nama, f.pcs])).toEqual([["Barang C", 7]]);
    expect(r!.pesananTerakhir).toMatchObject({ orderNo: `TEST-RT-${token}-4`, total: null, milikSaya: true, keadaan: "MENUNGGU" });
    expect(r!.kunjunganTerakhir).toBeNull();
  });
});

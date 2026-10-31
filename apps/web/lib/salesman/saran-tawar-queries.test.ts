import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bahanSaranTawar, beliTokoIni, jualTokoSejenis, saranTawarToko } from "./saran-tawar-queries";
import { susunSaranTawar } from "./saran-tawar";

/*
 * Menulis ke basis data. Jangan pernah dijalankan ke basis data produksi
 * (terowongan :3307 / host VPS). Semua baris diberi token acak dan dihapus lewat
 * `seededId(s)`; area uji punya kode unik sehingga "toko se-area" hanya berisi
 * toko uji.
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("saran tawar — kueri (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const HARI = 86_400_000;
  const sekarang = new Date();
  const lalu = (n: number) => new Date(sekarang.getTime() - n * HARI);
  const lama = new Date("2024-01-01T00:00:00Z");

  let uomId = "";
  let salesId = "";
  let areaId = "";
  let areaSepiId = "";
  let tokoId = "";
  let tokoSepiId = "";
  let peerSpgId = "";
  let peerKonsiId = "";
  let peerPutusId = "";
  let luarId = "";
  let siklusId = "";
  let item: Record<string, string> = {};
  let orderIds: string[] = [];
  let deliveryIds: string[] = [];
  let spgIds: string[] = [];

  beforeAll(async () => {
    uomId = "";
    salesId = "";
    areaId = "";
    areaSepiId = "";
    tokoId = "";
    tokoSepiId = "";
    peerSpgId = "";
    peerKonsiId = "";
    peerPutusId = "";
    luarId = "";
    siklusId = "";
    item = {};
    orderIds = [];
    deliveryIds = [];
    spgIds = [];

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-ST-${token}`, nameId: "t", nameEn: "t" } })).id;
    // A andalan · L laris (SPG) · P dibeli toko SPG (harus diabaikan) · K laku konsi
    // Q dibeli toko putus · N baru · H laris tapi habis · X laku di luar area · W dipesan, belum dikirim
    const stok: Record<string, number> = { A: 20, L: 10, P: 10, K: 10, Q: 10, N: 5, H: 0, X: 10, W: 10 };
    for (const k of Object.keys(stok)) {
      const it = await prisma.item.create({
        data: {
          sku: `TEST-ST-${k}-${token}`,
          nameId: `Barang ${k}`,
          nameEn: `Item ${k}`,
          type: "FINISHED_GOOD",
          uomId,
          createdAt: k === "N" ? new Date() : lama,
          inventoryValues: { create: { variantSku: null, qtyOnHand: stok[k] } },
        },
      });
      item[k] = it.id;
    }
    await prisma.itemImage.create({ data: { itemId: item.A, url: `https://example.com/${token}/a.jpg` } });

    salesId = (await prisma.user.create({ data: { email: `test-st-${token}@example.com`, name: "Sales ST" } })).id;
    areaId = (await prisma.storeGroup.create({ data: { code: `TST-${token}`, name: "Area Uji" } })).id;
    areaSepiId = (await prisma.storeGroup.create({ data: { code: `TSS-${token}`, name: "Area Sepi" } })).id;
    const toko = async (k: string, termsType: "PUTUS" | "KONSI", groupId: string | null) =>
      (
        await prisma.store.create({
          data: { code: `TEST-ST-${k}-${token}`, name: `Toko ${k}`, address: "x", termsType, groupId },
        })
      ).id;
    tokoId = await toko("T", "PUTUS", areaId);
    peerSpgId = await toko("S", "KONSI", areaId);
    peerKonsiId = await toko("K", "KONSI", areaId);
    peerPutusId = await toko("P", "PUTUS", areaId);
    luarId = await toko("O", "PUTUS", null);
    tokoSepiId = await toko("Z", "PUTUS", areaSepiId);

    let n = 0;
    /** Pesanan putus disetujui + satu kiriman penuh `hariLalu` hari lalu. */
    const putusTerkirim = async (storeId: string, itemKey: string, qty: number, hariLalu: number) => {
      n += 1;
      const o = await prisma.fieldSalesOrder.create({
        data: {
          orderNo: `TEST-ST-${token}-${n}`,
          storeId,
          salesmanId: salesId,
          status: "APPROVED",
          orderType: "PUTUS",
          deliveryStatus: "DELIVERED",
          subtotal: 0,
          total: 0,
          approvedAt: lalu(hariLalu),
          createdAt: lalu(hariLalu + 1),
          lines: { create: [{ itemId: item[itemKey], productName: itemKey, qty, unitPrice: 0, lineTotal: 0, deliveredQty: qty }] },
        },
        include: { lines: true },
      });
      orderIds.push(o.id);
      const dlv = await prisma.fieldSalesDelivery.create({
        data: {
          docNo: `TEST-ST-DLV-${token}-${n}`,
          orderId: o.id,
          deliveredAt: lalu(hariLalu),
          deliveredById: salesId,
          invoiceDate: lalu(hariLalu),
          dueDate: lalu(hariLalu),
          subtotal: 0,
          total: 0,
          lines: { create: [{ orderLineId: o.lines[0].id, itemId: item[itemKey], productName: itemKey, qty }] },
        },
      });
      deliveryIds.push(dlv.id);
    };

    // Toko ini: A dipesan tiap 30 hari, terakhir 90 hari lalu.
    await putusTerkirim(tokoId, "A", 6, 150);
    await putusTerkirim(tokoId, "A", 6, 120);
    await putusTerkirim(tokoId, "A", 6, 90);
    // W sedang dipesan (belum dikirim), 2 dari 8 dibatalkan.
    n += 1;
    const menunggu = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `TEST-ST-${token}-${n}`, storeId: tokoId, salesmanId: salesId, status: "PENDING_APPROVAL", orderType: "PUTUS",
        subtotal: 0, total: 0,
        lines: { create: [{ itemId: item.W, productName: "W", qty: 8, cancelledQty: 2, unitPrice: 0, lineTotal: 0 }] },
      },
    });
    orderIds.push(menunggu.id);
    // L pernah dipesan tapi DITOLAK — bukan pesanan toko.
    n += 1;
    const tolak = await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `TEST-ST-${token}-${n}`, storeId: tokoId, salesmanId: salesId, status: "REJECTED", orderType: "PUTUS",
        subtotal: 0, total: 0, rejectedAt: lalu(5),
        lines: { create: [{ itemId: item.L, productName: "L", qty: 50, unitPrice: 0, lineTotal: 0 }] },
      },
    });
    orderIds.push(tolak.id);

    // Toko SPG: penjualan SPG L 30 pcs dan H 40 pcs — dipakai. Pembelian P 40 pcs diabaikan.
    const jualSpg = await prisma.spgSale.create({
      data: {
        docNo: `TEST-ST-SPG-${token}`, salesmanId: salesId, createdById: salesId, storeId: peerSpgId,
        subtotal: 0, total: 0, cashReceived: 0, changeGiven: 0, createdAt: lalu(7),
        lines: {
          create: [
            { itemId: item.L, productName: "L", qty: 30, unitPrice: 0, lineTotal: 0 },
            { itemId: item.H, productName: "H", qty: 40, unitPrice: 0, lineTotal: 0 },
          ],
        },
      },
    });
    spgIds.push(jualSpg.id);
    await putusTerkirim(peerSpgId, "P", 40, 10);

    // Toko konsi: laku K 31 pcs di bulan lalu (terkunci, porsi utuh).
    const bulanLalu = new Date(sekarang.getTime() + 7 * 3_600_000);
    bulanLalu.setUTCDate(1);
    bulanLalu.setUTCMonth(bulanLalu.getUTCMonth() - 1);
    siklusId = (
      await prisma.consignmentCycle.create({
        data: {
          noKonsi: `TEST-ST-KNS-${token}`, storeId: peerKonsiId,
          periodYear: bulanLalu.getUTCFullYear(), periodMonth: bulanLalu.getUTCMonth() + 1, lockedAt: new Date(),
          sold: { create: [{ itemId: item.K, itemName: "K", qty: 31, price: 0, amount: 0 }] },
        },
      })
    ).id;

    // Toko putus biasa: Q 12 pcs dibeli.
    await putusTerkirim(peerPutusId, "Q", 12, 20);
    // Toko di luar area: X 99 pcs — tidak boleh terhitung.
    await putusTerkirim(luarId, "X", 99, 20);
  });

  afterAll(async () => {
    await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: { in: seededIds(spgIds) } } });
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: (await prisma.spgSale.findMany({ where: { id: { in: seededIds(spgIds) } }, select: { id: true } })).map((x) => x.id) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(spgIds) } } });
    await prisma.consignmentSold.deleteMany({ where: { cycleId: seededId(siklusId) } });
    await prisma.consignmentCycle.deleteMany({ where: { id: seededId(siklusId) } });
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { deliveryId: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(orderIds) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    const itemIds = Object.values(item);
    await prisma.itemImage.deleteMany({ where: { itemId: { in: seededIds(itemIds) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: seededIds(itemIds) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds(itemIds) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({
      where: { id: { in: seededIds([tokoId, tokoSepiId, peerSpgId, peerKonsiId, peerPutusId, luarId]) } },
    });
    await prisma.storeGroup.deleteMany({ where: { id: { in: seededIds([areaId, areaSepiId]) } } });
    await prisma.user.deleteMany({ where: { id: seededId(salesId) } });
  });

  it("beliTokoIni: satu peristiwa per pesanan per barang; yang menunggu ikut, yang ditolak tidak", async () => {
    const beli = await beliTokoIni(tokoId, lalu(365));
    const a = beli.filter((b) => b.itemId === item.A);
    expect(a).toHaveLength(3);
    expect(a.every((b) => b.pcs === 6)).toBe(true);
    expect(beli.filter((b) => b.itemId === item.W).map((b) => b.pcs)).toEqual([6]);
    expect(beli.some((b) => b.itemId === item.L)).toBe(false);
  });

  it("jualTokoSejenis: per toko satu sumber — SPG mengalahkan pembelian, laku konsi utuh untuk bulan penuh", async () => {
    const jual = await jualTokoSejenis([peerSpgId, peerKonsiId, peerPutusId], sekarang);
    const per = new Map(jual.map((j) => [j.itemId, j]));
    expect(per.get(item.L)).toEqual({ itemId: item.L, pcs: 30, toko: 1 });
    expect(per.get(item.K)).toEqual({ itemId: item.K, pcs: 31, toko: 1 });
    expect(per.get(item.Q)).toEqual({ itemId: item.Q, pcs: 12, toko: 1 });
    // Toko SPG juga MEMBELI P, tapi penjualan SPG-nya yang dipakai.
    expect(per.has(item.P)).toBe(false);
    expect(per.has(item.X)).toBe(false);
  });

  it("bahanSaranTawar: pembanding area, dan saran yang tersusun dari bahan itu", async () => {
    const b = await bahanSaranTawar(tokoId, sekarang);
    expect(b).not.toBeNull();
    expect(b!.pembanding).toEqual({ jenis: "AREA", kode: `TST-${token}`, nama: "Area Uji" });

    // Disaring ke barang uji, supaya barang lain di basis data dev tidak ikut.
    const milikUji = new Set(Object.values(item));
    const saran = susunSaranTawar(
      { ...b!.bahan, barang: b!.bahan.barang.filter((x) => milikUji.has(x.itemId)) },
      sekarang,
      { batas: 50 },
    );
    const alasan = new Map(saran.map((s) => [s.itemId, s.alasan]));
    expect(alasan.get(item.A)).toBe("ANDALAN_TOKO");
    expect(alasan.get(item.K)).toBe("LARIS_DI_AREA");
    expect(alasan.get(item.L)).toBe("LARIS_DI_AREA");
    expect(alasan.get(item.Q)).toBe("LARIS_DI_AREA");
    expect(alasan.get(item.N)).toBe("BARU");
    // Habis stok, dipesan dan masih menunggu, laku di luar area, dibeli toko SPG: bukan saran.
    for (const k of ["H", "W", "X", "P"]) expect(alasan.has(item[k])).toBe(false);
  });

  it("saranTawarToko: andalan paling depan, lengkap dengan SKU, nama, dan gambar", async () => {
    const hasil = await saranTawarToko(tokoId, sekarang);
    expect(hasil).not.toBeNull();
    expect(hasil!.hariArea).toBe(90);
    expect(hasil!.saran[0]).toMatchObject({
      itemId: item.A,
      alasan: "ANDALAN_TOKO",
      sku: `TEST-ST-A-${token}`,
      nama: "Barang A",
      gambarUrl: `https://example.com/${token}/a.jpg`,
      tersedia: 20,
      jedaBiasa: 30,
      hariSejakPesan: 90,
    });
    expect(hasil!.baru.map((x) => x.itemId)).toContain(item.N);
  });

  it("area tanpa toko aktif lain → dibandingkan dengan toko sejenis", async () => {
    const b = await bahanSaranTawar(tokoSepiId, sekarang);
    expect(b!.pembanding).toEqual({ jenis: "JENIS", termsType: "PUTUS" });
  });

  it("toko yang tidak ada → null", async () => {
    expect(await saranTawarToko("tidak-ada", sekarang)).toBeNull();
  });
});

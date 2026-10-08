import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { PPN_BAWAAN, type PengaturanPpn } from "@/lib/finance/pajak/ppn";

/*
 * Bug 6 uji akuntansi 2: retur toko membalik HPP sebesar harga rata-rata SAAT
 * DIHITUNG, bukan HPP saat barangnya dijual. Kemeja M dijual dengan HPP
 * 81.222,22, kembali sesudah rata-ratanya naik ke 103.528,91 (produksi Oktober
 * dengan ongkos jahit) — HPP dibalik 22.306,69 terlalu besar.
 *
 * Lewat PENULIS ASLI (`catatHitunganGudang`, jurnal retur) terhadap basis data
 * sungguhan. Yang ditiru: pemetaan akun (ke akun milik tes ini), tanggal mulai
 * buku besar, pengaturan PPN, notifikasi, push stok Jubelio. Pengguna, toko,
 * barang, dan akun milik tes sendiri; penjualan bertanggal 2003; semua baris
 * dihapus lewat `seededId()`/`seededIds()`.
 */

const h = vi.hoisted(() => ({
  akun: new Map<string, string>(),
  mulai: new Date("2003-01-01T00:00:00+07:00") as Date | null,
  ppn: null as unknown as PengaturanPpn,
}));

vi.mock("@/lib/finance/journals/mapping", async (asli) => {
  const m = await asli<typeof import("@/lib/finance/journals/mapping")>();
  return {
    ...m,
    resolveAccount: vi.fn(async (role: string) => {
      const id = h.akun.get(role);
      if (!id) throw new m.UnmappedRoleError(role);
      return id;
    }),
  };
});
vi.mock("@/lib/finance/sales/sweep", async (asli) => ({
  ...(await asli<typeof import("@/lib/finance/sales/sweep")>()),
  readGlCutover: vi.fn(async () => h.mulai),
}));
vi.mock("@/lib/finance/pajak/ppn-pengaturan", () => ({ bacaPengaturanPpn: vi.fn(async () => h.ppn) }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/jubelio/antre-push-stok", () => ({ antrekanPushStok: vi.fn(async () => undefined) }));

import { catatHitunganGudang } from "@/lib/receivables/return-writer";
import { hppJualTerakhir } from "@/lib/receivables/hpp-retur";
import { kunciStokPengiriman, kunciStokReturMasuk, SUMBER_LAPANGAN } from "./aturan";
import { selaraskanJurnalRetur } from "./jurnal";

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `UJHPP-${Math.random().toString(36).slice(2, 8)}`;
const wib = (t: string) => new Date(`${t}+07:00`);
const NON_PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "NON_PKP" };
const VARIAN = "KMJ-M";

const PERAN_UJI: Array<[string, "ASET" | "LIABILITAS" | "PENDAPATAN" | "HPP" | "BEBAN"]> = [
  ["AR_STORE", "ASET"],
  ["SALES_RETURN", "PENDAPATAN"],
  ["PPN_KELUARAN", "LIABILITAS"],
  ["COGS", "HPP"],
  ["INVENTORY_FG", "ASET"],
  ["INVENTORY", "ASET"],
  ["INVENTORY_DAMAGED", "ASET"],
  ["INVENTORY_VARIANCE", "BEBAN"],
  ["LOSS_EXPENSE", "BEBAN"],
];

d("retur toko — HPP dibalik sebesar HPP saat dijual (test bed only)", () => {
  let akunIds: string[] = [];
  let salesId = "";
  let gudangId = "";
  let uomId = "";
  let tokoId = "";
  let tokoLainId = "";
  let barangId = "";
  let orderIds: string[] = [];
  let deliveryIds: string[] = [];
  let adjIds: string[] = [];
  let nrtIds: string[] = [];
  let nriIds: string[] = [];
  let invIds: string[] = [];
  let urut = 0;

  beforeAll(async () => {
    akunIds = [];
    salesId = "";
    gudangId = "";
    uomId = "";
    h.akun.clear();
    for (const [role, type] of PERAN_UJI) {
      const a = await prisma.chartAccount.create({ data: { code: `${tag}-${role}`, name: `${tag} ${role}`, type, depth: 1 } });
      akunIds.push(a.id);
      h.akun.set(role, a.id);
    }
    salesId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-sales@uji.local`, name: `${tag} Sales` } })).id;
    gudangId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-gudang@uji.local`, name: `${tag} Gudang` } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `${tag}-PCS`, nameId: "pcs", nameEn: "pcs" } })).id;
  });

  afterAll(async () => {
    if (akunIds.length) {
      const jurnal = await prisma.journalLine.findMany({ where: { chartAccountId: { in: seededIds(akunIds) } }, select: { journalId: true } });
      if (jurnal.length) await prisma.journal.deleteMany({ where: { id: { in: seededIds([...new Set(jurnal.map((j) => j.journalId))]) } } });
      await prisma.chartAccount.deleteMany({ where: { id: { in: seededIds(akunIds) } } });
    }
    if (salesId) await prisma.user.delete({ where: { id: seededId(salesId) } });
    if (gudangId) await prisma.user.delete({ where: { id: seededId(gudangId) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  beforeEach(async () => {
    tokoId = "";
    tokoLainId = "";
    barangId = "";
    orderIds = [];
    deliveryIds = [];
    adjIds = [];
    nrtIds = [];
    nriIds = [];
    invIds = [];
    h.mulai = wib("2003-01-01T00:00:00");
    h.ppn = NON_PKP;
    urut += 1;
    tokoId = (await prisma.store.create({ data: { code: `${tag}-T${urut}`, name: `${tag} Butik ${urut}`, address: "uji", termsType: "PUTUS", isActive: true } })).id;
    tokoLainId = (await prisma.store.create({ data: { code: `${tag}-L${urut}`, name: `${tag} Toko lain ${urut}`, address: "uji", termsType: "PUTUS", isActive: true } })).id;
    barangId = (
      await prisma.item.create({ data: { sku: `${tag}-KMJ-${urut}`, nameId: `${tag} Kemeja`, nameEn: `${tag} Shirt`, type: "FINISHED_GOOD", uomId } })
    ).id;
    // Rata-rata SEKARANG, sesudah produksi dengan ongkos jahit menaikkannya.
    const inv = await prisma.inventoryValue.create({
      data: { itemId: barangId, variantSku: VARIAN, qtyOnHand: 10, avgCost: 103_528.91, totalValue: 1_035_289.1 },
    });
    invIds.push(inv.id);
  });

  afterEach(async () => {
    if (akunIds.length) {
      const jurnal = await prisma.journalLine.findMany({ where: { chartAccountId: { in: seededIds(akunIds) } }, select: { journalId: true } });
      if (jurnal.length) await prisma.journal.deleteMany({ where: { id: { in: seededIds([...new Set(jurnal.map((j) => j.journalId))]) } } });
    }
    const gerak = barangId ? await prisma.damagedStockMovement.findMany({ where: { itemId: seededId(barangId) }, select: { id: true } }) : [];
    const beban = nrtIds.length ? await prisma.returnCharge.findMany({ where: { storeReturnId: { in: seededIds(nrtIds) } }, select: { id: true } }) : [];
    const entitas = [...nriIds, ...nrtIds, ...gerak.map((g) => g.id), ...beban.map((b) => b.id)];
    if (entitas.length) await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(entitas) } } });
    const notif = await prisma.adminNotification.findMany({ where: { category: "JOURNAL_PENDING" }, select: { id: true, metadata: true }, orderBy: { createdAt: "desc" }, take: 200 });
    const milik = notif.filter((n) => nriIds.includes(String((n.metadata as Record<string, unknown> | null)?.docId ?? "")));
    if (milik.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milik.map((n) => n.id)) } } });
    if (beban.length) await prisma.returnCharge.deleteMany({ where: { id: { in: seededIds(beban.map((b) => b.id)) } } });
    if (gerak.length) await prisma.damagedStockMovement.deleteMany({ where: { id: { in: seededIds(gerak.map((g) => g.id)) } } });
    if (nriIds.length) await prisma.warehouseReturn.deleteMany({ where: { id: { in: seededIds(nriIds) } } });
    if (nrtIds.length) await prisma.storeReturn.deleteMany({ where: { id: { in: seededIds(nrtIds) } } });
    if (barangId) await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(barangId) } });
    if (deliveryIds.length) await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: seededIds(deliveryIds) } } });
    if (orderIds.length) await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    if (invIds.length) await prisma.inventoryValue.deleteMany({ where: { id: { in: seededIds(invIds) } } });
    if (barangId) {
      await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(barangId) } });
      await prisma.item.delete({ where: { id: seededId(barangId) } });
    }
    if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
    if (tokoLainId) await prisma.store.delete({ where: { id: seededId(tokoLainId) } });
  });

  /** Penjualan putus satu pcs ke sebuah toko: pesanan, pengiriman, dan penyesuaian stok keluarnya (HPP saat itu). */
  async function jual(o: { storeId: string; pada: Date; hpp: number; varian?: string }) {
    const n = ++urut;
    const orderNo = `${tag}-SO-${n}`;
    const order = await prisma.fieldSalesOrder.create({
      data: {
        orderNo,
        storeId: o.storeId,
        salesmanId: salesId,
        status: "APPROVED",
        orderType: "PUTUS",
        subtotal: 289_000,
        total: 289_000,
        createdAt: o.pada,
        lines: { create: [{ itemId: barangId, variantSku: o.varian ?? VARIAN, productName: `${tag} Kemeja`, qty: 1, unitPrice: 289_000, lineTotal: 289_000 }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    orderIds.push(order.id);
    const lineId = order.lines[0].id;
    const dlv = await prisma.fieldSalesDelivery.create({
      data: {
        docNo: `${tag}-DLV-${n}`,
        orderId: order.id,
        deliveredAt: o.pada,
        deliveredById: gudangId,
        invoiceDate: o.pada,
        dueDate: o.pada,
        subtotal: 289_000,
        total: 289_000,
        createdAt: o.pada,
        lines: { create: [{ orderLineId: lineId, itemId: barangId, variantSku: o.varian ?? VARIAN, productName: `${tag} Kemeja`, qty: 1, unitPrice: 289_000, lineTotal: 289_000 }] },
      },
      select: { id: true },
    });
    deliveryIds.push(dlv.id);
    const a = await prisma.stockAdjustment.create({
      data: {
        docNumber: `${tag}-ADJ-${n}`,
        itemId: barangId,
        type: "NEGATIVE",
        qtyChange: -1,
        reason: "uji",
        prevQty: 11,
        newQty: 10,
        prevAvgCost: o.hpp,
        newAvgCost: o.hpp,
        source: "FIELD_SALES_CONSUME",
        idempotencyKey: kunciStokPengiriman(orderNo, dlv.id, lineId),
        createdAt: o.pada,
      },
    });
    adjIds.push(a.id);
  }

  async function hitungRetur(kondisi: "LAYAK" | "RUSAK") {
    const nrt = await prisma.storeReturn.create({
      data: { noNrt: `${tag}-NRT-${++urut}`, storeId: tokoId, salesmanId: salesId, claimDate: wib("2003-03-01T10:00:00"), claimedAmount: 289_000 },
    });
    nrtIds.push(nrt.id);
    const r = await catatHitunganGudang({
      storeReturnId: nrt.id,
      warehouseUserId: gudangId,
      receivedAt: wib("2003-03-05T10:00:00"),
      deliveryMethod: "SALES",
      items: [{ itemId: barangId, variantSku: VARIAN, itemName: `${tag} Kemeja M`, qty: 1, price: 289_000, condition: kondisi }],
    });
    if (!r.ok) throw new Error(`hitungan gudang gagal: ${r.alasan}`);
    nriIds.push(r.id);
    return r.id;
  }

  async function saldoPeran(id: string): Promise<Record<string, number>> {
    const j = await prisma.journal.findMany({
      where: { sourceType: SUMBER_LAPANGAN.RETUR, OR: [{ sourceId: id }, { sourceId: { startsWith: `${id}#` } }] },
      select: { lines: { select: { chartAccountId: true, debit: true, credit: true } } },
    });
    const peranDari = new Map([...h.akun.entries()].map(([r, a]) => [a, r]));
    const hasil: Record<string, number> = {};
    for (const l of j.flatMap((x) => x.lines)) {
      const r = peranDari.get(l.chartAccountId) ?? "?";
      hasil[r] = Math.round(((hasil[r] ?? 0) + Number(l.debit) - Number(l.credit)) * 100) / 100;
    }
    for (const k of Object.keys(hasil)) if (hasil[k] === 0) delete hasil[k];
    return hasil;
  }

  it("HPP penjualan terakhir SEBELUM tanggal itu, ke toko itu, varian itu; null bila belum pernah dijual", async () => {
    await jual({ storeId: tokoId, pada: wib("2003-01-15T10:00:00"), hpp: 70_000 });
    await jual({ storeId: tokoId, pada: wib("2003-02-10T10:00:00"), hpp: 81_222.22 });
    await jual({ storeId: tokoLainId, pada: wib("2003-02-20T10:00:00"), hpp: 95_000 });
    await jual({ storeId: tokoId, pada: wib("2003-02-25T10:00:00"), hpp: 60_000, varian: "KMJ-L" });

    const cari = (storeId: string, sebelum: string, variantSku = VARIAN) =>
      hppJualTerakhir(prisma, { storeId, itemId: barangId, variantSku, sebelum: wib(sebelum) });
    expect(await cari(tokoId, "2003-03-05T10:00:00")).toBe(81_222.22);
    expect(await cari(tokoId, "2003-02-01T00:00:00")).toBe(70_000);
    expect(await cari(tokoId, "2003-01-01T00:00:00")).toBeNull();
    expect(await cari(tokoLainId, "2003-03-05T10:00:00")).toBe(95_000);
    expect(await cari(tokoId, "2003-03-05T10:00:00", "KMJ-L")).toBe(60_000);
    expect(await cari(tokoId, "2003-03-05T10:00:00", "KMJ-XL")).toBeNull();
  });

  it("kemeja M kembali RUSAK: gudang rusak dan jurnal memakai HPP saat dijual (81.222,22), bukan rata-rata sekarang", async () => {
    await jual({ storeId: tokoId, pada: wib("2003-02-10T10:00:00"), hpp: 81_222.22 });
    const nriId = await hitungRetur("RUSAK");

    const gerak = await prisma.damagedStockMovement.findMany({ where: { itemId: barangId }, select: { kind: true, qty: true, value: true } });
    expect(gerak.map((g) => ({ kind: g.kind, qty: g.qty, value: Number(g.value) }))).toEqual([{ kind: "MASUK_RETUR", qty: 1, value: 81_222.22 }]);

    expect(await selaraskanJurnalRetur(nriId, gudangId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(nriId)).toEqual({
      INVENTORY_DAMAGED: 81_222.22,
      COGS: -81_222.22,
      SALES_RETURN: 289_000,
      AR_STORE: -289_000,
    });
  });

  it("kemeja M kembali LAYAK: kartu stok tetap pada rata-rata (103.528,91), HPP dibalik 81.222,22, selisih 22.306,69 ke selisih persediaan", async () => {
    await jual({ storeId: tokoId, pada: wib("2003-02-10T10:00:00"), hpp: 81_222.22 });
    const nriId = await hitungRetur("LAYAK");

    const baris = await prisma.warehouseReturnItem.findFirstOrThrow({ where: { warehouseReturnId: nriId }, select: { id: true } });
    const masuk = await prisma.stockAdjustment.findUniqueOrThrow({ where: { idempotencyKey: kunciStokReturMasuk(baris.id) }, select: { qtyChange: true, prevAvgCost: true, source: true } });
    expect({ qty: Number(masuk.qtyChange), harga: Number(masuk.prevAvgCost), source: masuk.source }).toEqual({ qty: 1, harga: 103_528.91, source: "STORE_RETURN_RECEIVE" });
    const stok = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: barangId, variantSku: VARIAN }, select: { qtyOnHand: true, avgCost: true, totalValue: true } });
    expect({ qty: Number(stok.qtyOnHand), avg: Number(stok.avgCost), nilai: Number(stok.totalValue) }).toEqual({ qty: 11, avg: 103_528.91, nilai: 1_138_818.01 });

    expect(await selaraskanJurnalRetur(nriId, gudangId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(nriId)).toEqual({
      INVENTORY_FG: 103_528.91,
      COGS: -81_222.22,
      INVENTORY_VARIANCE: -22_306.69,
      SALES_RETURN: 289_000,
      AR_STORE: -289_000,
    });
    // Dijalankan ulang: tidak ada generasi baru.
    expect(await selaraskanJurnalRetur(nriId, gudangId)).toMatchObject({ ok: true, created: false });
  });

  it("belum pernah dijual ke toko itu: HPP dibalik sebesar rata-rata saat dihitung, tanpa selisih (perilaku lama)", async () => {
    await jual({ storeId: tokoLainId, pada: wib("2003-02-10T10:00:00"), hpp: 81_222.22 });
    const nriRusak = await hitungRetur("RUSAK");
    const nriLayak = await hitungRetur("LAYAK");
    const gerak = await prisma.damagedStockMovement.findFirstOrThrow({ where: { itemId: barangId }, select: { value: true } });
    expect(Number(gerak.value)).toBe(103_528.91);

    await selaraskanJurnalRetur(nriRusak, gudangId);
    await selaraskanJurnalRetur(nriLayak, gudangId);
    expect(await saldoPeran(nriRusak)).toEqual({ INVENTORY_DAMAGED: 103_528.91, COGS: -103_528.91, SALES_RETURN: 289_000, AR_STORE: -289_000 });
    expect(await saldoPeran(nriLayak)).toEqual({ INVENTORY_FG: 103_528.91, COGS: -103_528.91, SALES_RETURN: 289_000, AR_STORE: -289_000 });
  });

  it("HPP yang dibalik dibekukan sejak jurnal pertama: penjualan yang baru tercatat sesudahnya tidak menggeser jurnal lama", async () => {
    const nriId = await hitungRetur("LAYAK");
    expect(await selaraskanJurnalRetur(nriId, gudangId)).toMatchObject({ ok: true, created: true });
    expect(await saldoPeran(nriId)).toMatchObject({ INVENTORY_FG: 103_528.91, COGS: -103_528.91 });
    // Data penjualan lama yang baru masuk (mis. impor) — jurnal yang sudah berdiri tidak diubah diam-diam.
    await jual({ storeId: tokoId, pada: wib("2003-02-10T10:00:00"), hpp: 81_222.22 });
    expect(await selaraskanJurnalRetur(nriId, gudangId)).toMatchObject({ ok: true, created: false });
    expect(await saldoPeran(nriId)).not.toHaveProperty("INVENTORY_VARIANCE");
  });
});

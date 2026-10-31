import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { AKSI_JEJAK_KREDIT_RETUR, catatKreditReturPo } from "./kredit-retur-writer";
import { kreditReturPerPo, returUntukPo } from "./kredit-retur-queries";
import { hitungUtangPo } from "./utang";
import { getPOById, listPOs } from "./queries";

/*
 * Retur ke pemasok yang selesai dulu tidak mengurangi apa pun: barang keluar
 * dari stok, tetapi utang PO-nya tetap penuh. Sekarang penyelesaian retur
 * mencatat PO yang dikurangi (`poId`) dan besarnya (`poCreditAmount`, harga
 * BELI di PO — bukan harga rata-rata stok di `totalValue`), dengan jejak
 * AuditLog di transaksi yang sama. GL tidak disentuh.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("catatKreditReturPo (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let supplierId = "";
  let supplierLainId = "";
  let uomId = "";
  let kancingId = "";
  let topiId = "";
  let poId = "";
  let grnId = "";
  let returIds: string[] = [];
  let urut = 0;

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `kredit-retur-${token}@uji.local` }, select: { id: true } })).id;
    typeId = (
      await prisma.supplierType.create({ data: { code: `TKR-${token}`, name: `Jenis retur ${token}` }, select: { id: true } })
    ).id;
    supplierId = (
      await prisma.supplier.create({
        data: { code: `SUP-KR-${token}`, name: "Pemasok retur uji", typeId, status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    supplierLainId = (
      await prisma.supplier.create({
        data: { code: `SUP-KR2-${token}`, name: "Pemasok lain uji", typeId, status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    uomId = (
      await prisma.uOM.create({ data: { code: `R${token}`.slice(0, 10), nameId: "Uji", nameEn: "Test" }, select: { id: true } })
    ).id;
    kancingId = (
      await prisma.item.create({
        data: { sku: `KR-KANCING-${token}`, nameId: "Kancing uji", nameEn: "Test button", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
    topiId = (
      await prisma.item.create({
        data: { sku: `KR-TOPI-${token}`, nameId: "Topi uji", nameEn: "Test hat", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
    // PO 20 kancing @50.000 termasuk PPN → total 1.000.000, sudah diterima lengkap.
    poId = (
      await prisma.purchaseOrder.create({
        data: {
          docNumber: `PO-KR-${token}`,
          supplierId,
          status: "CLOSED",
          totalAmount: 1_000_000,
          taxAmount: 0,
          grandTotal: 1_000_000,
          ppnRatePercent: 11,
          createdById: userId,
          items: {
            create: [{ itemId: kancingId, qty: 20, price: 50_000, ppnIncluded: true, receivedQty: 20, uomId }],
          },
        },
        select: { id: true },
      })
    ).id;
    grnId = (
      await prisma.gRN.create({
        data: {
          docNumber: `GRN-KR-${token}`,
          poId,
          supplierId,
          receivedBy: userId,
          totalAmount: 1_000_000,
          items: JSON.stringify([{ itemId: kancingId, qty: 20, unitCost: 50_000 }]),
        },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(() => {
    returIds = [];
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "VendorReturn", entityId: { in: seededIds(returIds) } } });
    await prisma.vendorReturn.deleteMany({ where: { id: { in: seededIds(returIds) } } });
  });

  afterAll(async () => {
    await prisma.gRN.deleteMany({ where: { id: seededId(grnId) } });
    await prisma.pOItem.deleteMany({ where: { poId: seededId(poId) } });
    await prisma.purchaseOrder.deleteMany({ where: { id: seededId(poId) } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kancingId, topiId]) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: { in: seededIds([supplierId, supplierLainId]) } } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  async function buatRetur(opts: {
    lines: Array<{ itemId: string; qty: number; variantSku?: string }>;
    tanpaGrn?: boolean;
    vendorId?: string;
    status?: "PROCESSED" | "COMPLETED";
  }) {
    urut += 1;
    const ret = await prisma.vendorReturn.create({
      data: {
        docNumber: `RET-KR-${token}-${urut}`,
        vendorId: opts.vendorId ?? supplierId,
        grnId: opts.tanpaGrn ? null : grnId,
        // Seperti createVendorReturn: JSON string, harga rata-rata stok (bukan harga PO).
        lines: JSON.stringify(opts.lines.map((l) => ({ type: "ACCESSORIES", costValue: l.qty * 40_000, ...l }))),
        totalItems: opts.lines.length,
        totalValue: opts.lines.reduce((t, l) => t + l.qty * 40_000, 0),
        status: opts.status ?? "PROCESSED",
        createdById: userId,
      },
      select: { id: true },
    });
    returIds.push(ret.id);
    return ret.id;
  }

  const baca = (id: string) =>
    prisma.vendorReturn.findUniqueOrThrow({ where: { id: seededId(id) }, select: { poId: true, poCreditAmount: true } });
  const jejak = (id: string) =>
    prisma.auditLog.findMany({ where: { entityType: "VendorReturn", entityId: seededId(id), action: AKSI_JEJAK_KREDIT_RETUR } });

  it("retur 2 kancing @50.000 → utang PO berkurang 100.000 (bukan 80.000 harga rata-rata stok)", async () => {
    const id = await buatRetur({ lines: [{ itemId: kancingId, qty: 2 }] });
    const hasil = await runSerializable((tx) => catatKreditReturPo(tx, { returnId: id, userId }));
    expect(hasil).toMatchObject({ poId, kredit: 100_000 });

    const ret = await baca(id);
    expect(ret.poId).toBe(poId);
    expect(Number(ret.poCreditAmount)).toBe(100_000);

    const rows = await jejak(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId });
    expect(rows[0].metadata).toMatchObject({ poId, kredit: 100_000, dasar: 100_000, ppn: 0 });

    // Hanya retur yang SELESAI dihitung dalam utang.
    expect((await kreditReturPerPo([poId])).get(poId) ?? 0).toBe(0);
    await prisma.vendorReturn.update({ where: { id: seededId(id) }, data: { status: "COMPLETED" } });
    const kredit = (await kreditReturPerPo([poId])).get(poId) ?? 0;
    expect(kredit).toBe(100_000);
    const po = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: seededId(poId) },
      select: { status: true, grandTotal: true, ppnRatePercent: true, closedAt: true, items: true },
    });
    expect(hitungUtangPo(po, kredit).utang).toBe(900_000);

    const daftar = await returUntukPo(poId);
    expect(daftar).toEqual([
      expect.objectContaining({ id, docNumber: `RET-KR-${token}-${urut}`, poCreditAmount: 100_000 }),
    ]);

    // Terlihat di detail PO dan di baris daftar (register pembayaran memakai daftar ini).
    const detail = await getPOById(poId);
    expect(detail?.utang).toEqual({ nilaiPo: 1_000_000, nilaiTidakDatang: 0, kreditRetur: 100_000, utang: 900_000 });
    expect(detail?.returPemasok).toHaveLength(1);
    const baris = await listPOs({ supplierId });
    expect(baris).toHaveLength(1);
    expect(Array.isArray(baris) ? baris[0] : null).toMatchObject({ kreditRetur: 100_000, utang: { utang: 900_000 } });
  });

  it("dua kali dipanggil untuk retur yang sama: kredit tidak berlipat", async () => {
    const id = await buatRetur({ lines: [{ itemId: kancingId, qty: 2 }] });
    await runSerializable((tx) => catatKreditReturPo(tx, { returnId: id, userId }));
    const kedua = await runSerializable((tx) => catatKreditReturPo(tx, { returnId: id, userId }));
    expect(kedua).toMatchObject({ poId, kredit: 100_000 });
    expect(Number((await baca(id)).poCreditAmount)).toBe(100_000);
    expect(await jejak(id)).toHaveLength(1);
  });

  it("barang yang tidak ada di PO tidak mengurangi utang; dicatat di jejak", async () => {
    const id = await buatRetur({
      lines: [
        { itemId: kancingId, qty: 1 },
        { itemId: topiId, qty: 3 },
      ],
    });
    const hasil = await runSerializable((tx) => catatKreditReturPo(tx, { returnId: id, userId }));
    expect(hasil).toMatchObject({ poId, kredit: 50_000 });
    expect(Number((await baca(id)).poCreditAmount)).toBe(50_000);
    expect((await jejak(id))[0].metadata).toMatchObject({
      tanpaPadanan: [{ itemId: topiId, variantSku: null, qty: 3, sebab: "TIDAK_ADA_DI_PO" }],
    });
  });

  it("retur tanpa GRN (dari produksi/WO): tidak terkait PO, utang tidak berubah", async () => {
    const id = await buatRetur({ lines: [{ itemId: kancingId, qty: 2 }], tanpaGrn: true });
    expect(await runSerializable((tx) => catatKreditReturPo(tx, { returnId: id, userId }))).toEqual({
      poId: null,
      kredit: 0,
      sebab: "TANPA_PO",
    });
    expect(await baca(id)).toEqual({ poId: null, poCreditAmount: null });
    expect(await jejak(id)).toHaveLength(0);
  });

  it("pemasok retur berbeda dari pemasok PO: tidak mengurangi utang PO itu", async () => {
    const id = await buatRetur({ lines: [{ itemId: kancingId, qty: 2 }], vendorId: supplierLainId });
    expect(await runSerializable((tx) => catatKreditReturPo(tx, { returnId: id, userId }))).toEqual({
      poId: null,
      kredit: 0,
      sebab: "PEMASOK_BERBEDA",
    });
    expect(await baca(id)).toEqual({ poId: null, poCreditAmount: null });
  });
});

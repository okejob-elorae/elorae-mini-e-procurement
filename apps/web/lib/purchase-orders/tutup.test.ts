import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { Decimal } from "decimal.js";
import { runSerializable } from "@/lib/db/tx-retry";
import { tutupPurchaseOrder } from "./tutup";
import { alasanTolakPenerimaanPo } from "./penerimaan";

/*
 * "Tutup PO": PO yang kurang kirim dulu tidak bisa ditutup — statusnya PARTIAL
 * selamanya, terlambat selamanya di beranda, dan sisanya tetap tampak "akan
 * datang". Penutupan butuh alasan, menulis jejak AuditLog DI DALAM transaksinya,
 * dan berjalan di `runSerializable` (Prisma 7 `updateMany` bukan
 * compare-and-swap) sehingga dua penutupan serentak hanya menang satu.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("tutupPurchaseOrder (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let supplierId = "";
  let uomId = "";
  let kaosId = "";
  let celanaId = "";
  let poIds: string[] = [];
  let grnIds: string[] = [];
  let urut = 0;

  beforeAll(async () => {
    userId = "";
    typeId = "";
    supplierId = "";
    uomId = "";
    kaosId = "";
    celanaId = "";
    userId = (await prisma.user.create({ data: { email: `tutup-po-${token}@uji.local` }, select: { id: true } })).id;
    typeId = (
      await prisma.supplierType.create({ data: { code: `TTP-${token}`, name: `Jenis tutup ${token}` }, select: { id: true } })
    ).id;
    supplierId = (
      await prisma.supplier.create({
        data: { code: `SUP-TP-${token}`, name: "Pemasok tutup uji", typeId, status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    uomId = (
      await prisma.uOM.create({ data: { code: `T${token}`.slice(0, 10), nameId: "Uji", nameEn: "Test" }, select: { id: true } })
    ).id;
    kaosId = (
      await prisma.item.create({
        data: { sku: `TP-KAOS-${token}`, nameId: "Kaos uji", nameEn: "Test tee", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
    celanaId = (
      await prisma.item.create({
        data: { sku: `TP-CLN-${token}`, nameId: "Celana uji", nameEn: "Test pants", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(() => {
    poIds = [];
    grnIds = [];
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "PurchaseOrder", entityId: { in: seededIds(poIds) } } });
    await prisma.pOStatusHistory.deleteMany({ where: { poId: { in: seededIds(poIds) } } });
    await prisma.gRN.deleteMany({ where: { id: { in: seededIds(grnIds) } } });
    await prisma.pOItem.deleteMany({ where: { poId: { in: seededIds(poIds) } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: seededIds(poIds) } } });
  });

  afterAll(async () => {
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kaosId, celanaId]) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(supplierId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  /** PO 100 kaos @85.000 (Exclude PPN) + 20 celana @50.000 (Include PPN), tarif 11%. */
  async function buatPo(opts: { status: "DRAFT" | "SUBMITTED" | "PARTIAL" | "CLOSED" | "OVER" | "CANCELLED"; kaosDiterima: number; celanaDiterima: number }) {
    urut += 1;
    const po = await prisma.purchaseOrder.create({
      data: {
        docNumber: `PO-TUTUP-${token}-${urut}`,
        supplierId,
        status: opts.status,
        totalAmount: 9_500_000,
        taxAmount: 935_000,
        grandTotal: 10_435_000,
        ppnRatePercent: 11,
        createdById: userId,
        items: {
          create: [
            { itemId: kaosId, qty: 100, price: 85_000, ppnIncluded: false, receivedQty: opts.kaosDiterima, uomId },
            { itemId: celanaId, qty: 20, price: 50_000, ppnIncluded: true, receivedQty: opts.celanaDiterima, uomId },
          ],
        },
      },
      select: { id: true },
    });
    poIds.push(po.id);
    return po.id;
  }

  async function bacaPo(id: string) {
    return prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: seededId(id) },
      select: { status: true, closedAt: true, closedById: true, closeReason: true },
    });
  }

  const jejak = (id: string) =>
    prisma.auditLog.findMany({ where: { entityType: "PurchaseOrder", entityId: seededId(id), action: "PO_CLOSED_SHORT" } });
  const riwayatTutup = (id: string) => prisma.pOStatusHistory.count({ where: { poId: seededId(id), status: "CLOSED" } });

  it("PO kurang kirim ditutup: status CLOSED, alasan + pelaku tercatat, jejak berisi sisa pcs dan rupiah", async () => {
    // Kaos 60 dari 100 datang, celana 20 dari 20 lengkap.
    const id = await buatPo({ status: "PARTIAL", kaosDiterima: 60, celanaDiterima: 20 });
    const hasil = await tutupPurchaseOrder({ poId: id, userId, alasan: "  Pemasok tidak sanggup kirim sisa  " });

    // Sisa 40 kaos × 85.000 = 3.400.000; PPN 11% = 374.000 → 3.774.000.
    expect(hasil).toMatchObject({ ok: true, statusSebelum: "PARTIAL", qtySisa: 40, nilaiSisa: 3_774_000 });
    if (!hasil.ok) throw new Error("harus berhasil");
    expect(hasil.sisa).toEqual([{ itemId: kaosId, variantSku: null, dipesan: 100, diterima: 60, sisa: 40 }]);

    const po = await bacaPo(id);
    expect(po.status).toBe("CLOSED");
    expect(po.closedById).toBe(userId);
    expect(po.closeReason).toBe("Pemasok tidak sanggup kirim sisa");
    expect(po.closedAt).toBeInstanceOf(Date);

    const rows = await jejak(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId, reason: "Pemasok tidak sanggup kirim sisa" });
    expect(rows[0].changes).toEqual({ before: { status: "PARTIAL" }, after: { status: "CLOSED" } });
    expect(rows[0].metadata).toMatchObject({ qtySisa: 40, nilaiSisa: 3_774_000 });
    expect(await riwayatTutup(id)).toBe(1);
  });

  it("alasan wajib: kosong atau spasi saja ditolak, tidak ada yang ditulis", async () => {
    const id = await buatPo({ status: "PARTIAL", kaosDiterima: 60, celanaDiterima: 0 });
    expect(await tutupPurchaseOrder({ poId: id, userId, alasan: "   " })).toEqual({ ok: false, code: "ALASAN_WAJIB" });
    expect((await bacaPo(id)).status).toBe("PARTIAL");
    expect(await jejak(id)).toHaveLength(0);
  });

  it.each([
    ["DRAFT", "MASIH_DRAF"],
    ["CANCELLED", "DIBATALKAN"],
    ["CLOSED", "SUDAH_DITUTUP"],
    ["OVER", "SUDAH_LENGKAP"],
  ] as const)("status %s ditolak (%s)", async (status, code) => {
    const id = await buatPo({ status, kaosDiterima: status === "OVER" ? 105 : 0, celanaDiterima: status === "OVER" ? 20 : 0 });
    expect(await tutupPurchaseOrder({ poId: id, userId, alasan: "uji" })).toEqual({ ok: false, code });
    expect((await bacaPo(id)).status).toBe(status);
    expect(await jejak(id)).toHaveLength(0);
  });

  it("belum ada barang diterima: ditolak (batalkan PO, bukan menutupnya)", async () => {
    const id = await buatPo({ status: "SUBMITTED", kaosDiterima: 0, celanaDiterima: 0 });
    expect(await tutupPurchaseOrder({ poId: id, userId, alasan: "uji" })).toEqual({
      ok: false,
      code: "BELUM_ADA_PENERIMAAN",
    });
    expect((await bacaPo(id)).status).toBe("SUBMITTED");
  });

  it("GRN terima-lebih yang belum diputus pemilik: ditolak sampai pemilik memutuskan", async () => {
    const id = await buatPo({ status: "PARTIAL", kaosDiterima: 60, celanaDiterima: 0 });
    const grn = await prisma.gRN.create({
      data: {
        docNumber: `GRN-TUTUP-${token}-${urut}`,
        poId: id,
        supplierId,
        receivedBy: userId,
        totalAmount: 5_100_000,
        items: [],
        requiresOwnerApproval: true,
      },
      select: { id: true },
    });
    grnIds.push(grn.id);
    expect(await tutupPurchaseOrder({ poId: id, userId, alasan: "uji" })).toEqual({
      ok: false,
      code: "GRN_MENUNGGU_PEMILIK",
    });
    expect((await bacaPo(id)).status).toBe("PARTIAL");

    // Sesudah pemilik memutuskan, PO boleh ditutup.
    await prisma.gRN.update({ where: { id: seededId(grn.id) }, data: { ownerApprovedAt: new Date(), ownerApprovedById: userId } });
    expect((await tutupPurchaseOrder({ poId: id, userId, alasan: "uji" })).ok).toBe(true);
  });

  it("PO tidak ditemukan", async () => {
    expect(await tutupPurchaseOrder({ poId: `tidak-ada-${token}`, userId, alasan: "uji" })).toEqual({
      ok: false,
      code: "TIDAK_DITEMUKAN",
    });
  });

  it("dua penutupan serentak: tepat satu menang, satu jejak, satu riwayat", async () => {
    const id = await buatPo({ status: "PARTIAL", kaosDiterima: 60, celanaDiterima: 20 });
    const hasil = await Promise.all([
      tutupPurchaseOrder({ poId: id, userId, alasan: "balapan A" }),
      tutupPurchaseOrder({ poId: id, userId, alasan: "balapan B" }),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, code: "SUDAH_DITUTUP" }]);
    expect(await jejak(id)).toHaveLength(1);
    expect(await riwayatTutup(id)).toBe(1);
  });

  /*
   * Penerimaan berbentuk GRN: urutan yang sama dengan kepala `createGRN` —
   * baca status PO di transaksi serializable, tolak lewat
   * `alasanTolakPenerimaanPo`, tulis baris PO, tambah `receivedQty`, hitung
   * ulang status. (createGRN sendiri belum memakai penjaga CLOSED — lihat
   * catatan tugas; tes ini mengunci kontraknya.)
   */
  async function terimaKaos(poId: string, qty: number) {
    return runSerializable(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: poId }, select: { status: true } });
      if (!po) return { ok: false as const, code: "PO_TIDAK_DITEMUKAN" };
      const tolak = alasanTolakPenerimaanPo(po.status);
      if (tolak) return { ok: false as const, code: tolak };
      await tx.purchaseOrder.update({ where: { id: poId }, data: { updatedAt: new Date() } });
      await tx.pOItem.updateMany({
        where: { poId: seededId(poId), itemId: seededId(kaosId) },
        data: { receivedQty: { increment: qty } },
      });
      const baris = await tx.pOItem.findMany({ where: { poId }, select: { qty: true, receivedQty: true } });
      const lengkap = baris.every((b) => new Decimal(b.receivedQty.toString()).gte(b.qty.toString()));
      await tx.purchaseOrder.update({ where: { id: poId }, data: { status: lengkap ? "CLOSED" : "PARTIAL" } });
      return { ok: true as const };
    });
  }

  const kaosDiterima = async (poId: string) =>
    Number(
      (await prisma.pOItem.findFirstOrThrow({ where: { poId: seededId(poId), itemId: seededId(kaosId) } })).receivedQty,
    );

  it("PO yang sudah ditutup menolak penerimaan berikutnya (PO_DITUTUP), stok PO tidak bertambah", async () => {
    const id = await buatPo({ status: "PARTIAL", kaosDiterima: 60, celanaDiterima: 20 });
    expect((await tutupPurchaseOrder({ poId: id, userId, alasan: "sisa tidak dikirim" })).ok).toBe(true);
    expect(await terimaKaos(id, 10)).toEqual({ ok: false, code: "PO_DITUTUP" });
    expect(await kaosDiterima(id)).toBe(60);
    const po = await bacaPo(id);
    expect(po.status).toBe("CLOSED");
    expect(po.closedAt).toBeInstanceOf(Date);
  });

  it("balapan tutup vs penerimaan: sisa yang dicatat penutupan selalu cocok dengan barang yang benar-benar diterima", async () => {
    for (let putaran = 0; putaran < 3; putaran += 1) {
      const id = await buatPo({ status: "PARTIAL", kaosDiterima: 60, celanaDiterima: 20 });
      const [tutup, terima] = await Promise.all([
        tutupPurchaseOrder({ poId: id, userId, alasan: `balapan ${putaran}` }),
        terimaKaos(id, 10),
      ]);
      const diterima = await kaosDiterima(id);
      expect(tutup.ok).toBe(true);
      if (!tutup.ok) return;
      // Tutup dulu → penerimaan ditolak, sisa 40. Terima dulu → 70 diterima, sisa 30.
      expect(diterima + tutup.qtySisa).toBe(100);
      if (terima.ok) {
        expect(tutup).toMatchObject({ qtySisa: 30, nilaiSisa: 2_830_500 });
      } else {
        expect(terima).toEqual({ ok: false, code: "PO_DITUTUP" });
        expect(tutup).toMatchObject({ qtySisa: 40, nilaiSisa: 3_774_000 });
      }
      expect((await bacaPo(id)).status).toBe("CLOSED");
      expect(await jejak(id)).toHaveLength(1);
    }
  });
});

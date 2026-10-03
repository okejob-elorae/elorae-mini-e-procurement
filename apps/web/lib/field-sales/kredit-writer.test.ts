import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { ATURAN_KREDIT_BAWAAN, type AturanKredit, type KeadaanTagihan } from "@/lib/salesman/kredit";
import type { KreditToko } from "./kredit-toko";

/*
 * Kredit toko di penulis pesanan, terhadap basis data uji. Bacaan kreditnya
 * (`muatKreditToko`) DITIRUKAN: aturan pemilik adalah `SystemSetting` bersama
 * yang tidak boleh diubah tes, dan piutang toko butuh rantai klaim yang
 * berat untuk diseed. Yang diuji di sini adalah apa yang dilakukan PENULIS
 * dengan hasil penilaian — menolak, menahan, mencatat, dan kiriman ulang.
 */
const { mockMuat, mockKabar } = vi.hoisted(() => ({ mockMuat: vi.fn(), mockKabar: vi.fn() }));
vi.mock("./kredit-toko", () => ({ muatKreditToko: mockMuat }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({ kabariPengguna: mockKabar }));

import { createFieldSalesOrder, approveFieldSalesOrder } from "./writer";
import { CATATAN_KREDIT_TAK_TERBACA, KreditBelumDiperiksaError, KreditDiblokirError } from "./kredit-pesanan";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const bersih: KeadaanTagihan = { sisa: 0, fakturTerbuka: 0, lewatJanji: 0, fakturLewatJanji: 0 };
const kredit = (aturan: Partial<AturanKredit>, keadaan: KeadaanTagihan | null, creditLimit: number | null = null): KreditToko => ({
  aturan: { ...ATURAN_KREDIT_BAWAAN, ...aturan },
  batas: { creditLimit, maxOpenInvoices: null },
  keadaan,
  baris: [],
});

d("createFieldSalesOrder — kredit toko (test bed only)", () => {
  const sku = `TEST-FSK-${Math.random().toString(36).slice(2, 10)}`;
  const mulai = new Date();
  let uomId = "";
  let itemId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";
  let orderIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    storeId = "";
    salesmanId = "";
    visitId = "";
    orderIds = [];
    mockMuat.mockReset();
    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku, nameId: "T", nameEn: "T", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 35000, minOrderQty: 1 },
    });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 100, reservedQty: 0, avgCost: 1000, totalValue: 100000 } });
    const store = await prisma.store.create({ data: { code: `S-${sku}`, name: "T", address: "T", termsType: "PUTUS", isActive: true } });
    storeId = store.id;
    const user = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    salesmanId = user!.id;
    const visit = await prisma.storeVisit.create({ data: { storeId, userId: salesmanId, checkinLat: 0, checkinLng: 0 } });
    visitId = visit.id;
  });

  afterEach(async () => {
    const pesanan = await prisma.fieldSalesOrder.findMany({ where: { storeId: seededId(storeId) }, select: { id: true, orderNo: true } });
    const semua = [...orderIds, ...pesanan.map((p) => p.id)];
    for (const p of pesanan) {
      // Notifikasi admin yang ditulis penulis untuk pesanan ini saja: kategori + sejak tes mulai + nomor pesanannya.
      await prisma.adminNotification.deleteMany({
        where: { category: "PENDING_ORDER_APPROVAL", createdAt: { gte: new Date(mulai) }, message: { contains: seededId(p.orderNo) } },
      });
    }
    await prisma.stockReservation.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: seededIds(semua) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(semua) } } });
    await prisma.storeVisit.deleteMany({ where: { id: seededId(visitId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  // Harga dari klien sengaja salah (1): penilaian harus memakai total yang dihitung SERVER (6 × 35.000).
  const baris = () => [{ itemId, variantSku: "", productName: "T", qty: 6, unitPrice: 1 }];
  const buat = (idempotencyKey?: string) =>
    createFieldSalesOrder({ storeId, salesmanId, visitId, lines: baris(), idempotencyKey });

  it("BLOKIR menolak dan tidak meninggalkan pesanan maupun reservasi", async () => {
    mockMuat.mockResolvedValue(kredit({ mode: "BLOKIR" }, bersih, 100_000));
    const err = await buat().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KreditDiblokirError);
    expect((err as KreditDiblokirError).alasan).toEqual([{ kode: "MELEBIHI_BATAS_NILAI", sisaSesudah: 210_000, batas: 100_000 }]);
    expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(storeId) } })).toBe(0);
    expect(await prisma.stockReservation.count({ where: { itemId: seededId(itemId) } })).toBe(0);
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId: seededId(itemId) } });
    expect(Number(inv!.reservedQty)).toBe(0);
  });

  it("TAHAN mencatat pesanan dengan kredit ditahan, dan persetujuan butuh centang", async () => {
    mockMuat.mockResolvedValue(kredit({ mode: "TAHAN" }, { sisa: 1_000_000, fakturTerbuka: 2, lewatJanji: 400_000, fakturLewatJanji: 1 }));
    const res = await buat();
    orderIds.push(res.orderId);
    expect(res.kreditDitahan).toBe(true);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order.kreditDitahan).toBe(true);
    expect(order.kreditCatatan?.replace(/ /g, " ")).toBe("Saat dibuat: tagihan lewat janji Rp 400.000 (1 faktur)");

    await expect(approveFieldSalesOrder({ orderId: res.orderId, approvedById: salesmanId })).rejects.toBeInstanceOf(
      KreditBelumDiperiksaError,
    );
    expect((await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } })).status).toBe("PENDING_APPROVAL");

    await approveFieldSalesOrder({ orderId: res.orderId, approvedById: salesmanId, kreditDiperiksa: true });
    expect((await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } })).status).toBe("APPROVED");
    // Kabar tidak dikirim dari proses tes (penjaga VITEST di penulis).
    expect(mockKabar).not.toHaveBeenCalled();
  });

  it("PERINGATAN: pesanan jalan dengan catatan, tidak ditahan", async () => {
    mockMuat.mockResolvedValue(kredit({ mode: "PERINGATAN" }, bersih, 100_000));
    const res = await buat();
    orderIds.push(res.orderId);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order.kreditDitahan).toBe(false);
    expect(order.kreditCatatan?.replace(/ /g, " ")).toBe(
      "Saat dibuat: sisa Rp 210.000 termasuk pesanan ini, dari batas Rp 100.000",
    );
    // Pesanan yang tidak ditahan disetujui tanpa centang, seperti sebelumnya.
    await approveFieldSalesOrder({ orderId: res.orderId, approvedById: salesmanId });
    expect((await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } })).status).toBe("APPROVED");
  });

  it("toko aman: tanpa catatan", async () => {
    mockMuat.mockResolvedValue(kredit({ mode: "BLOKIR" }, bersih));
    const res = await buat();
    orderIds.push(res.orderId);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order.kreditDitahan).toBe(false);
    expect(order.kreditCatatan).toBeNull();
  });

  it("tagihan gagal dibaca di mode ketat: pesanan ditahan, tidak diblokir", async () => {
    mockMuat.mockResolvedValue(kredit({ mode: "BLOKIR" }, null));
    const res = await buat();
    orderIds.push(res.orderId);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order.kreditDitahan).toBe(true);
    expect(order.kreditCatatan).toBe(CATATAN_KREDIT_TAK_TERBACA);
  });

  it("kiriman ulang dengan kunci yang sama mengembalikan pesanan lama apa adanya, walau kredit kini BLOKIR", async () => {
    const kunci = `k-${sku}`;
    mockMuat.mockResolvedValue(kredit({ mode: "PERINGATAN" }, bersih));
    const pertama = await buat(kunci);
    orderIds.push(pertama.orderId);

    mockMuat.mockResolvedValue(kredit({ mode: "BLOKIR" }, bersih, 1));
    const ulang = await buat(kunci);
    expect(ulang.orderId).toBe(pertama.orderId);
    expect(ulang.kreditDitahan).toBe(false);
    expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(storeId) } })).toBe(1);
  });

  it("toko konsinyasi (bacaan kredit null) tidak pernah dinilai", async () => {
    await prisma.store.update({ where: { id: storeId }, data: { termsType: "KONSI" } });
    mockMuat.mockResolvedValue(null);
    const res = await buat();
    orderIds.push(res.orderId);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order.kreditDitahan).toBe(false);
    expect(order.kreditCatatan).toBeNull();
  });
});

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
 *
 * Batas kredit toko juga ditulis ke baris tokonya (`setel`), karena kedua lapis
 * kredit membaca batasnya langsung dari toko lewat `batasKreditBerlaku`: lewat
 * batas menandai `creditHoldAtCreate`, dan persetujuannya butuh alasan override
 * di mode apa pun, PERINGATAN juga. Gerbang persetujuan membaca aturan pemilik
 * sendiri di transaksinya; bacaan itu (`bacaAturanKredit`) juga DITIRUKAN dengan
 * aturan yang sama, supaya tes tidak bergantung pada `SystemSetting` bed uji.
 */
const { mockMuat, mockKabar, mockAturan } = vi.hoisted(() => ({ mockMuat: vi.fn(), mockKabar: vi.fn(), mockAturan: vi.fn() }));
vi.mock("./kredit-toko", () => ({ muatKreditToko: mockMuat }));
vi.mock("@/lib/salesman/kredit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/salesman/kredit")>()),
  bacaAturanKredit: mockAturan,
}));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({ kabariPengguna: mockKabar }));

import { createFieldSalesOrder, approveFieldSalesOrder } from "./writer";
import { CATATAN_KREDIT_TAK_TERBACA, KreditBelumDiperiksaError, KreditDiblokirError } from "./kredit-pesanan";
import { CreditLimitExceededError } from "./errors";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const bersih: KeadaanTagihan = { sisa: 0, fakturTerbuka: 0, lewatJanji: 0, fakturLewatJanji: 0 };
const kredit = (
  aturan: Partial<AturanKredit>,
  keadaan: KeadaanTagihan | null,
  creditLimit: number | null = null,
  noCreditLimit = false,
): KreditToko => ({
  aturan: { ...ATURAN_KREDIT_BAWAAN, ...aturan },
  batas: { creditLimit, maxOpenInvoices: null, noCreditLimit },
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
    mockAturan.mockReset();
    mockAturan.mockReturnValue(ATURAN_KREDIT_BAWAAN);
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
        where: {
          category: { in: ["PENDING_ORDER_APPROVAL", "CREDIT_LIMIT_HOLD"] },
          createdAt: { gte: new Date(mulai) },
          message: { contains: seededId(p.orderNo) },
        },
      });
    }
    // Jejak override batas kredit tidak punya foreign key ke pesanannya.
    await prisma.auditLog.deleteMany({ where: { entityType: "FieldSalesOrder", entityId: { in: seededIds(semua) } } });
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
  /** Bacaan kredit tiruan, dan batas kredit yang sama di baris tokonya — keduanya dibaca penulis. */
  const setel = async (k: KreditToko | null) => {
    mockMuat.mockResolvedValue(k);
    mockAturan.mockReturnValue(k?.aturan ?? ATURAN_KREDIT_BAWAAN);
    await prisma.store.update({
      where: { id: storeId },
      data: { creditLimit: k?.batas.creditLimit ?? null, noCreditLimit: k?.batas.noCreditLimit ?? false },
    });
  };

  it("BLOKIR menolak dan tidak meninggalkan pesanan maupun reservasi", async () => {
    await setel(kredit({ mode: "BLOKIR" }, bersih, 100_000));
    const err = await buat().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KreditDiblokirError);
    expect((err as KreditDiblokirError).alasan).toEqual([{ kode: "MELEBIHI_BATAS_NILAI", sisaSesudah: 210_000, batas: 100_000 }]);
    expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(storeId) } })).toBe(0);
    expect(await prisma.stockReservation.count({ where: { itemId: seededId(itemId) } })).toBe(0);
    const inv = await prisma.inventoryValue.findFirst({ where: { itemId: seededId(itemId) } });
    expect(Number(inv!.reservedQty)).toBe(0);
  });

  it("TAHAN mencatat pesanan dengan kredit ditahan, dan persetujuan butuh centang", async () => {
    await setel(kredit({ mode: "TAHAN" }, { sisa: 1_000_000, fakturTerbuka: 2, lewatJanji: 400_000, fakturLewatJanji: 1 }));
    const res = await buat();
    orderIds.push(res.orderId);
    expect(res.kreditDitahan).toBe(true);
    // Toko tanpa batas nilai: dasar kreditnya tidak menahan apa pun.
    expect(res.creditHold).toBe(false);
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

  it("PERINGATAN: pesanan jalan dengan catatan, tidak ditahan — tapi lewat batas toko persetujuannya butuh alasan override", async () => {
    await setel(kredit({ mode: "PERINGATAN" }, bersih, 100_000));
    const res = await buat();
    orderIds.push(res.orderId);
    expect(res.kreditDitahan).toBe(false);
    expect(res.creditHold).toBe(true);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order.kreditDitahan).toBe(false);
    expect(order.creditHoldAtCreate).toBe(true);
    expect(order.kreditCatatan?.replace(/ /g, " ")).toBe(
      "Saat dibuat: sisa Rp 210.000 termasuk pesanan ini, dari batas Rp 100.000",
    );
    // Tidak ditahan, jadi tanpa centang "sudah memeriksa tagihan" — tapi tanpa alasan override tetap ditolak.
    await expect(approveFieldSalesOrder({ orderId: res.orderId, approvedById: salesmanId })).rejects.toBeInstanceOf(
      CreditLimitExceededError,
    );
    expect((await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } })).status).toBe("PENDING_APPROVAL");

    await approveFieldSalesOrder({ orderId: res.orderId, approvedById: salesmanId, creditOverrideReason: "Toko janji bayar minggu ini" });
    const disetujui = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(disetujui.status).toBe("APPROVED");
    expect(disetujui.creditOverrideReason).toBe("Toko janji bayar minggu ini");
  });

  it("PERINGATAN di dalam batas toko: tanpa catatan, disetujui tanpa centang maupun alasan", async () => {
    await setel(kredit({ mode: "PERINGATAN" }, bersih, 500_000));
    const res = await buat();
    orderIds.push(res.orderId);
    expect(res.creditHold).toBe(false);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order.creditHoldAtCreate).toBe(false);
    expect(order.kreditCatatan).toBeNull();
    await approveFieldSalesOrder({ orderId: res.orderId, approvedById: salesmanId });
    expect((await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } })).status).toBe("APPROVED");
  });

  it("toko aman: tanpa catatan", async () => {
    await setel(kredit({ mode: "BLOKIR" }, bersih));
    const res = await buat();
    orderIds.push(res.orderId);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order.kreditDitahan).toBe(false);
    expect(order.kreditCatatan).toBeNull();
  });

  it("tagihan gagal dibaca di mode ketat: pesanan ditahan, tidak diblokir", async () => {
    await setel(kredit({ mode: "BLOKIR" }, null));
    const res = await buat();
    orderIds.push(res.orderId);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order.kreditDitahan).toBe(true);
    expect(order.kreditCatatan).toBe(CATATAN_KREDIT_TAK_TERBACA);
  });

  it("kiriman ulang dengan kunci yang sama mengembalikan pesanan lama apa adanya, walau kredit kini BLOKIR", async () => {
    const kunci = `k-${sku}`;
    await setel(kredit({ mode: "PERINGATAN" }, bersih));
    const pertama = await buat(kunci);
    orderIds.push(pertama.orderId);

    await setel(kredit({ mode: "BLOKIR" }, bersih, 1));
    const ulang = await buat(kunci);
    expect(ulang.orderId).toBe(pertama.orderId);
    // Kedua tanda dibaca dari pesanan yang tercatat, bukan dinilai ulang dengan batas baru.
    expect(ulang.kreditDitahan).toBe(false);
    expect(ulang.creditHold).toBe(false);
    expect(await prisma.fieldSalesOrder.count({ where: { storeId: seededId(storeId) } })).toBe(1);
  });

  it("kiriman ulang pesanan yang lewat batas toko mengembalikan tanda tahan kreditnya juga", async () => {
    const kunci = `kh-${sku}`;
    await setel(kredit({ mode: "PERINGATAN" }, bersih, 100_000));
    const pertama = await buat(kunci);
    orderIds.push(pertama.orderId);
    expect(pertama.creditHold).toBe(true);

    const ulang = await buat(kunci);
    expect(ulang).toMatchObject({ orderId: pertama.orderId, orderNo: pertama.orderNo, creditHold: true, kreditDitahan: false });
  });

  it("batas toko kosong ikut bawaan Pengaturan — di kedua lapis, saat dibuat dan saat disetujui", async () => {
    await setel(kredit({ mode: "PERINGATAN", batasNilai: 100_000 }, bersih, null));
    const res = await buat();
    orderIds.push(res.orderId);
    expect(res.creditHold).toBe(true);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(Number(order.creditLimitAtCreate)).toBe(100_000);
    expect(order.kreditCatatan?.replace(/ /g, " ")).toBe(
      "Saat dibuat: sisa Rp 210.000 termasuk pesanan ini, dari batas Rp 100.000",
    );

    const err = await approveFieldSalesOrder({ orderId: res.orderId, approvedById: salesmanId }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CreditLimitExceededError);
    expect((err as CreditLimitExceededError).creditLimit).toBe(100_000);

    await approveFieldSalesOrder({ orderId: res.orderId, approvedById: salesmanId, creditOverrideReason: "Toko langganan" });
    const disetujui = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(disetujui.status).toBe("APPROVED");
    expect(Number(disetujui.creditLimitAtApprove)).toBe(100_000);
  });

  it("bawaan Pengaturan kosong: batas toko kosong tetap tidak dibatasi (keadaan pabrik)", async () => {
    await setel(kredit({ mode: "BLOKIR" }, { sisa: 99_000_000, fakturTerbuka: 40, lewatJanji: 0, fakturLewatJanji: 0 }, null));
    const res = await buat();
    orderIds.push(res.orderId);
    expect(res.creditHold).toBe(false);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order.creditLimitAtCreate).toBeNull();
    expect(order.kreditCatatan).toBeNull();
    await approveFieldSalesOrder({ orderId: res.orderId, approvedById: salesmanId });
    expect((await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } })).status).toBe("APPROVED");
  });

  it("Tanpa batas kredit: lolos batas nilai dan batas faktur di kedua lapis, tapi lewat janji tetap ditahan", async () => {
    const ketat = { mode: "TAHAN" as const, batasNilai: 1, batasFaktur: 0 };
    await setel(kredit(ketat, { sisa: 5_000_000, fakturTerbuka: 3, lewatJanji: 0, fakturLewatJanji: 0 }, 1, true));
    const aman = await buat();
    orderIds.push(aman.orderId);
    expect(aman).toMatchObject({ creditHold: false, kreditDitahan: false });
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: aman.orderId } });
    expect(order.creditLimitAtCreate).toBeNull();
    expect(order.kreditCatatan).toBeNull();
    // Tanpa centang dan tanpa alasan: tidak ada batas yang digerbangkan.
    await approveFieldSalesOrder({ orderId: aman.orderId, approvedById: salesmanId });
    expect((await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: aman.orderId } })).status).toBe("APPROVED");

    await setel(kredit(ketat, { sisa: 5_000_000, fakturTerbuka: 3, lewatJanji: 400_000, fakturLewatJanji: 1 }, 1, true));
    const menunggak = await buat();
    orderIds.push(menunggak.orderId);
    expect(menunggak).toMatchObject({ creditHold: false, kreditDitahan: true });
    const tertahan = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: menunggak.orderId } });
    expect(tertahan.kreditCatatan?.replace(/ /g, " ")).toBe("Saat dibuat: tagihan lewat janji Rp 400.000 (1 faktur)");
  });

  it("toko konsinyasi (bacaan kredit null) tidak pernah dinilai", async () => {
    await prisma.store.update({ where: { id: storeId }, data: { termsType: "KONSI" } });
    await setel(null);
    const res = await buat();
    orderIds.push(res.orderId);
    const order = await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order.kreditDitahan).toBe(false);
    expect(order.kreditCatatan).toBeNull();
  });
});

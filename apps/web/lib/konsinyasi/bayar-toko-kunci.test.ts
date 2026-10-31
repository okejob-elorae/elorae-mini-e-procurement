import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/**
 * Kunci kiriman pembayaran toko konsinyasi (`ConsignmentPayment.idempotencyKey`),
 * terhadap basis data sungguhan.
 *
 * Dulu pembayaran toko tanpa kunci: jawaban "Simpan" yang hilang lalu ditekan
 * lagi mencatat uang yang sama dua kali — sisa tagihan turun dua kali, toko
 * tampak lunas padahal belum. Angka uji: 10 Blus × Rp150.000 = tagihan
 * Rp1.500.000.
 */

/*
 * `sembunyikan`: sebanyak itu pembacaan kunci berikutnya menjawab "tidak ada" —
 * meniru pembacaan sebelum kembarannya commit (MariaDB tanpa konflik
 * serialisasi), supaya kunci bentrok di indeks unik (P2002).
 */
const tiru = vi.hoisted(() => ({ sembunyikan: 0 }));
vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@elorae/db")>();
  type Fungsi = (...args: unknown[]) => unknown;
  const ikat = (t: object, v: unknown) => (typeof v === "function" ? (v as Fungsi).bind(t) : v);
  const bungkusBayar = (delegasi: object) =>
    new Proxy(delegasi, {
      get(t, p) {
        const v = Reflect.get(t, p);
        if (p !== "findUnique" || typeof v !== "function") return ikat(t, v);
        return async (...args: unknown[]) => {
          const where = (args[0] as { where?: Record<string, unknown> } | undefined)?.where ?? {};
          if ("idempotencyKey" in where && tiru.sembunyikan > 0) {
            tiru.sembunyikan -= 1;
            return null;
          }
          return (v as Fungsi).apply(t, args);
        };
      },
    });
  const bungkusKlien = (k: object) =>
    new Proxy(k, {
      get(t, p) {
        const v = Reflect.get(t, p);
        if (p === "consignmentPayment" && v && typeof v === "object") return bungkusBayar(v);
        if (p === "$transaction" && typeof v === "function") {
          return (arg: unknown, opsi?: unknown) =>
            typeof arg === "function"
              ? (v as Fungsi).call(t, (tx: object) => (arg as Fungsi)(bungkusKlien(tx)), opsi)
              : (v as Fungsi).call(t, arg, opsi);
        }
        return ikat(t, v);
      },
    });
  return { ...asli, prisma: bungkusKlien(asli.prisma) };
});

const { catatPembayaranToko, kunciAngka } = await import("./writer");

const tag = `KBK${Math.random().toString(36).slice(2, 8)}`;

let tokoId = "";
let uomId = "";
let barangId = "";
let adminId = "";
let siklusId = "";

beforeEach(async () => {
  tokoId = "";
  uomId = "";
  barangId = "";
  adminId = "";
  siklusId = "";
  tiru.sembunyikan = 0;

  tokoId = (await prisma.store.create({ data: { code: `${tag}-S`, name: `${tag} Konsi`, address: "uji", termsType: "KONSI", isActive: true } })).id;
  uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
  barangId = (
    await prisma.item.create({
      data: { sku: `${tag}-A`, nameId: `${tag} Blus`, nameEn: `${tag} Blouse`, type: "FINISHED_GOOD", uomId, commissionPerPcs: 2_000 },
    })
  ).id;
  adminId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-adm@uji.local`, name: `${tag} Admin`, passwordHash: "x" } })).id;
  siklusId = (await prisma.consignmentCycle.create({ data: { noKonsi: `${tag}/K`, storeId: tokoId, periodYear: 2026, periodMonth: 9 } })).id;
  for (const source of ["SPG", "TOKO"] as const) {
    await prisma.consignmentReport.create({
      data: { cycleId: siklusId, source, reportedAt: new Date(), items: { create: [{ itemId: barangId, itemName: `${tag} Blus`, qty: 10 }] } },
    });
  }
  const dikunci = await kunciAngka({
    cycleId: siklusId,
    olehUserId: adminId,
    baris: [{ itemId: barangId, itemName: `${tag} Blus`, qty: 10, price: 150_000 }],
  });
  expect(dikunci).toMatchObject({ ok: true });
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: seededId(adminId) } });
  await prisma.consignmentPayment.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentReportItem.deleteMany({ where: { report: { cycleId: seededId(siklusId) } } });
  await prisma.consignmentReport.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentSold.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentCommission.deleteMany({ where: { cycleId: seededId(siklusId) } });
  await prisma.consignmentCycle.deleteMany({ where: { id: seededId(siklusId) } });
  await prisma.item.deleteMany({ where: { id: seededId(barangId) } });
  await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  await prisma.user.deleteMany({ where: { id: { in: seededIds([adminId].filter(Boolean)) } } });
  await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
});

const bayar = (jumlah: number, idempotencyKey?: string) =>
  catatPembayaranToko({
    cycleId: siklusId,
    jumlah,
    tanggal: new Date("2026-10-03T00:00:00+07:00"),
    cara: "transfer",
    catatan: "uji",
    olehUserId: adminId,
    idempotencyKey,
  });

const pembayaran = () =>
  prisma.consignmentPayment.findMany({
    where: { cycleId: seededId(siklusId) },
    select: { id: true, amount: true, idempotencyKey: true },
  });

describe("kunci kiriman pembayaran toko", () => {
  it("kunci sama dua kali → pembayaran yang sama (ulang), sisa 900.000 bukan 300.000; jejak satu", async () => {
    const kunci = `bayar-${tag}-a`;
    const pertama = await bayar(600_000, kunci);
    expect(pertama).toMatchObject({ ok: true, sisa: 900_000 });
    expect(pertama).not.toHaveProperty("ulang");
    const kedua = await bayar(600_000, kunci);
    expect(kedua).toEqual({ ok: true, id: pertama.ok ? pertama.id : "", sisa: 900_000, ulang: true });
    const baris = await pembayaran();
    expect(baris.map((b) => [Number(b.amount), b.idempotencyKey])).toEqual([[600_000, `${siklusId}:${kunci}`]]);
    expect(
      await prisma.auditLog.count({ where: { entityId: seededId(siklusId), action: "CONSIGNMENT_STORE_PAYMENT_RECORDED" } }),
    ).toBe(1);
  });

  it("pelunasan penuh lalu simpan ulang berkunci sama → pembayaran yang sama, BUKAN 'melebihi sisa'", async () => {
    const kunci = `bayar-${tag}-b`;
    const pertama = await bayar(1_500_000, kunci);
    expect(pertama).toMatchObject({ ok: true, sisa: 0 });
    expect(await bayar(1_500_000, kunci)).toMatchObject({ ok: true, sisa: 0, ulang: true });
    // Isian lain (tanpa kunci yang sama) tetap ditolak: tagihannya sudah lunas.
    expect(await bayar(1_500_000, `bayar-${tag}-b2`)).toEqual({ ok: false, alasan: "MELEBIHI_SISA" });
    expect(await pembayaran()).toHaveLength(1);
  });

  it("kunci berbeda = isian berbeda → dua cicilan, sisa 400.000", async () => {
    expect(await bayar(600_000, `bayar-${tag}-c1`)).toMatchObject({ ok: true, sisa: 900_000 });
    expect(await bayar(500_000, `bayar-${tag}-c2`)).toMatchObject({ ok: true, sisa: 400_000 });
    expect(await pembayaran()).toHaveLength(2);
  });

  it("tanpa kunci (pemanggil lama) tetap mencatat; kolom kunci kosong", async () => {
    expect(await bayar(100_000)).toMatchObject({ ok: true, sisa: 1_400_000 });
    expect((await pembayaran()).map((b) => b.idempotencyKey)).toEqual([null]);
  });

  it("Promise.all tiga simpan berkunci sama → satu pembayaran, satu id, sisa 900.000", async () => {
    const kunci = `bayar-${tag}-d`;
    const hasil = await Promise.all([1, 2, 3].map(() => bayar(600_000, kunci)));
    expect(hasil.every((h) => h.ok)).toBe(true);
    expect(new Set(hasil.map((h) => (h.ok ? h.id : "")))).toHaveProperty("size", 1);
    expect(hasil.filter((h) => h.ok && !h.ulang)).toHaveLength(1);
    expect(await pembayaran()).toHaveLength(1);
  });

  it("kembaran yang lolos kedua pembacaan kunci bentrok di indeks unik → pembayaran yang sama, tidak melempar", async () => {
    const kunci = `bayar-${tag}-e`;
    const pertama = await bayar(600_000, kunci);
    tiru.sembunyikan = 2;
    const kedua = await bayar(600_000, kunci);
    expect(tiru.sembunyikan).toBe(0);
    expect(kedua).toMatchObject({ ok: true, id: pertama.ok ? pertama.id : "", ulang: true, sisa: 900_000 });
    expect(await pembayaran()).toHaveLength(1);
  });

  it("pembayaran yang sudah dibatalkan lalu kuncinya dikirim ulang → tetap pembayaran itu (tidak mencatat baru)", async () => {
    const kunci = `bayar-${tag}-f`;
    const pertama = await bayar(600_000, kunci);
    if (!pertama.ok) throw new Error("gagal");
    await prisma.consignmentPayment.update({
      where: { id: seededId(pertama.id) },
      data: { cancelledAt: new Date(), cancelledById: adminId, cancelReason: "uji" },
    });
    expect(await bayar(600_000, kunci)).toEqual({ ok: true, id: pertama.id, sisa: 1_500_000, ulang: true });
    expect(await pembayaran()).toHaveLength(1);
  });
});

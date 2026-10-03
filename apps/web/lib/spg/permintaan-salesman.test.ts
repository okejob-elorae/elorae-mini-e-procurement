import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import {
  daftarPermintaanMasuk,
  hitungPermintaanMasuk,
  namaPemegangToko,
  rincianPermintaanMasuk,
  saringBawaan,
  tokoDipegang,
} from "./permintaan-salesman";
import { permintaanToko } from "./permintaan-queries";

/*
 * Menulis ke basis data. Jangan pernah dijalankan ke basis data produksi
 * (terowongan :3307 / host VPS). Semua baris diberi token acak dan dihapus lewat
 * `seededId(s)`.
 *
 * Yang dijaga: kotak masuk salesman HANYA berisi permintaan dari toko yang ia
 * pegang — permintaan toko orang lain sama dengan tidak ada, kecuali untuk
 * kantor (`kelolaSemua`).
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("kotak masuk permintaan SPG — kueri (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const HARI = 86_400_000;
  const lalu = (n: number) => new Date(Date.now() - n * HARI);

  let uomId = "";
  let itemId = "";
  let salesA = "";
  let salesB = "";
  let spgId = "";
  let tokoA = "";
  let tokoB = "";
  let tokoC = "";
  let orderId = "";
  let rA1 = "";
  let rA2 = "";
  let rA3 = "";
  let rB1 = "";
  let rC1 = "";

  beforeAll(async () => {
    uomId = "";
    itemId = "";
    salesA = "";
    salesB = "";
    spgId = "";
    tokoA = "";
    tokoB = "";
    tokoC = "";
    orderId = "";
    rA1 = "";
    rA2 = "";
    rA3 = "";
    rB1 = "";
    rC1 = "";

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-PSM-${token}`, nameId: "t", nameEn: "t" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `TEST-PSM-${token}`, nameId: "Kaos Uji", nameEn: "Test tee", type: "FINISHED_GOOD", uomId },
      })
    ).id;
    salesA = (await prisma.user.create({ data: { email: `test-psm-a-${token}@example.com`, name: "Sales A" } })).id;
    salesB = (await prisma.user.create({ data: { email: `test-psm-b-${token}@example.com`, name: "Sales B" } })).id;
    spgId = (await prisma.user.create({ data: { email: `test-psm-spg-${token}@example.com`, name: "SPG Uji" } })).id;
    const toko = async (k: string, salesmanId: string | null) =>
      (await prisma.store.create({ data: { code: `TEST-PSM-${k}-${token}`, name: `Toko ${k}`, address: "x", termsType: "KONSI", salesmanId } })).id;
    tokoA = await toko("A", salesA);
    tokoB = await toko("B", salesB);
    tokoC = await toko("C", null);

    orderId = (
      await prisma.fieldSalesOrder.create({
        data: { orderNo: `TEST-PSM-${token}`, storeId: tokoA, salesmanId: salesA, status: "PENDING_APPROVAL", orderType: "KONSI", subtotal: 0, total: 0 },
      })
    ).id;

    const minta = async (storeId: string, createdAt: Date, data: Record<string, unknown> = {}, lines?: { qty: number; alasan: string | null; productName: string }[]) =>
      (
        await prisma.stockRequest.create({
          data: {
            storeId,
            requestedById: spgId,
            createdAt,
            ...data,
            lines: {
              create: (lines ?? [{ qty: 2, alasan: null, productName: "Kaos Uji" }]).map((l) => ({ itemId, variantSku: "", ...l })),
            },
          },
        })
      ).id;
    rA1 = await minta(tokoA, lalu(1), {}, [
      { qty: 3, alasan: "LAKU_DI_TOKO_LAIN", productName: "Kaos Uji — M" },
      { qty: 2, alasan: null, productName: "Kaos Uji — L" },
    ]);
    rA2 = await minta(tokoA, lalu(3), { status: "DITOLAK", handledById: salesA, handledAt: lalu(2), handleNote: "gudang kosong" });
    rA3 = await minta(tokoA, lalu(2), {
      status: "DIPROSES",
      fieldSalesOrderId: orderId,
      handledById: salesA,
      handledAt: lalu(1),
      handleNote: `Dibuatkan pesanan TEST-PSM-${token}`,
    });
    rB1 = await minta(tokoB, lalu(1));
    rC1 = await minta(tokoC, lalu(1));
  });

  afterAll(async () => {
    await prisma.stockRequest.deleteMany({ where: { id: { in: seededIds([rA1, rA2, rA3, rB1, rC1]) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: seededId(orderId) } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoA, tokoB, tokoC]) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesA, salesB, spgId]) } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("lists only requests from stores the salesperson holds, newest first", async () => {
    const daftar = await daftarPermintaanMasuk(salesA);
    expect(daftar.map((p) => p.id)).toEqual([rA1, rA3, rA2]);
    expect(daftar[0]).toMatchObject({
      status: "BARU",
      toko: { id: tokoA, nama: "Toko A" },
      peminta: "SPG Uji",
      jumlahBaris: 2,
      totalQty: 5,
      contoh: ["Kaos Uji — L", "Kaos Uji — M"],
      pesanan: null,
    });
    expect(daftar[1].pesanan).toEqual({ orderNo: `TEST-PSM-${token}` });
    // Toko tanpa pemegang tidak masuk kotak masuk siapa pun.
    expect((await daftarPermintaanMasuk(salesB)).map((p) => p.id)).toEqual([rB1]);
  });

  it("filters by status, and a store filter on someone else's store finds nothing", async () => {
    expect((await daftarPermintaanMasuk(salesA, { status: "BARU" })).map((p) => p.id)).toEqual([rA1]);
    expect(await daftarPermintaanMasuk(salesA, { storeId: tokoB })).toEqual([]);
    expect(await tokoDipegang(salesA, tokoB)).toBeNull();
    expect(await tokoDipegang(salesA, tokoA)).toEqual({ id: tokoA, nama: "Toko A" });
  });

  it("counts per status for the tabs", async () => {
    const hitung = await hitungPermintaanMasuk(salesA);
    expect(hitung).toEqual({ BARU: 1, DIPROSES: 1, SELESAI: 0, DITOLAK: 1 });
    expect(saringBawaan(hitung)).toBe("BARU");
    expect(await hitungPermintaanMasuk(salesA, tokoB)).toEqual({ BARU: 0, DIPROSES: 0, SELESAI: 0, DITOLAK: 0 });
  });

  it("detail: the holder sees reasons per line; another salesperson sees nothing; the office sees it as non-holder", async () => {
    const r = await rincianPermintaanMasuk(rA1, salesA, { kelolaSemua: false });
    expect(r).toMatchObject({ pemegang: true, totalQty: 5, toko: { id: tokoA, termsType: "KONSI" } });
    expect(r!.baris.map((b) => [b.productName, b.alasan])).toEqual([
      ["Kaos Uji — L", null],
      ["Kaos Uji — M", "LAKU_DI_TOKO_LAIN"],
    ]);
    expect(await rincianPermintaanMasuk(rB1, salesA, { kelolaSemua: false })).toBeNull();
    expect(await rincianPermintaanMasuk(rB1, salesA, { kelolaSemua: true })).toMatchObject({ id: rB1, pemegang: false });
  });

  it("detail: linked order opens only for its own salesperson; who decided is named", async () => {
    expect((await rincianPermintaanMasuk(rA3, salesA, { kelolaSemua: false }))!.pesanan).toEqual({
      id: orderId,
      orderNo: `TEST-PSM-${token}`,
      status: "PENDING_APPROVAL",
      milikSaya: true,
    });
    expect((await rincianPermintaanMasuk(rA3, salesB, { kelolaSemua: true }))!.pesanan?.milikSaya).toBe(false);
    expect((await rincianPermintaanMasuk(rA2, salesA, { kelolaSemua: false }))!.ditangani).toMatchObject({ oleh: "Sales A", catatan: "gudang kosong" });
  });

  it("names the store holder for the SPG's form", async () => {
    expect(await namaPemegangToko(tokoA)).toBe("Sales A");
    expect(await namaPemegangToko(tokoC)).toBeNull();
  });

  it("SPG's own list carries the reason per line, the order number and who decided", async () => {
    const daftar = await permintaanToko(tokoA);
    const per = new Map(daftar.map((p) => [p.id, p]));
    expect(per.get(rA1)!.baris.map((b) => b.alasan)).toEqual([null, "LAKU_DI_TOKO_LAIN"]);
    expect(per.get(rA3)!.pesanan).toEqual({ orderNo: `TEST-PSM-${token}` });
    expect(per.get(rA2)).toMatchObject({ status: "DITOLAK", ditanganiOleh: "Sales A", catatanKantor: "gudang kosong", pesanan: null });
    // Tanpa nilai pesanan apa pun di payload SPG.
    expect(JSON.stringify(daftar)).not.toMatch(/"(sub)?total"|price|harga|"nilai"|Rp/i);
  });
});

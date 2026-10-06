import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { returSaya } from "./pwa-queries";

/*
 * Daftar retur di HP (`/pwa/retur`) terhadap basis data uji.
 *
 * Salesman melihat nota yang ia catat sendiri DAN nota yang dilaporkan SPG di
 * toko yang ia pegang (hanya untuk dilihat). SPG tetap hanya melihat notanya
 * sendiri. Nilai nota toko KONSI tidak pernah sampai ke HP. Teardown hanya lewat
 * id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const token = Math.random().toString(36).slice(2, 10);
const TANGGAL = new Date("2026-09-15T03:00:00.000Z");

d("returSaya — retur yang dilaporkan SPG di toko yang dipegang (test bed only)", () => {
  let sales = "";
  let salesLain = "";
  let spgPutus = "";
  let spgKonsi = "";
  let spgOrang = "";
  let tokoPutus = "";
  let tokoKonsi = "";
  let tokoOrang = "";
  const nrt: Record<string, string> = {};

  beforeAll(async () => {
    sales = "";
    salesLain = "";
    spgPutus = "";
    spgKonsi = "";
    spgOrang = "";
    tokoPutus = "";
    tokoKonsi = "";
    tokoOrang = "";
    for (const k of Object.keys(nrt)) delete nrt[k];

    const orang = async (kode: string, assignedStoreId?: string) =>
      (
        await prisma.user.create({
          data: { email: `rs-${kode}-${token}@test.local`, name: `RS ${kode} ${token}`, assignedStoreId },
        })
      ).id;
    sales = await orang("sales");
    salesLain = await orang("lain");
    const toko = async (kode: string, termsType: "PUTUS" | "KONSI", salesmanId: string) =>
      (
        await prisma.store.create({
          data: { code: `T-RS-${kode}-${token}`, name: `RS ${kode} ${token}`, address: `Jl. ${kode}`, termsType, salesmanId },
        })
      ).id;
    tokoPutus = await toko("P", "PUTUS", sales);
    tokoKonsi = await toko("K", "KONSI", sales);
    tokoOrang = await toko("O", "PUTUS", salesLain);
    spgPutus = await orang("spgp", tokoPutus);
    spgKonsi = await orang("spgk", tokoKonsi);
    spgOrang = await orang("spgo", tokoOrang);

    const catat = async (
      kunci: string,
      m: { storeId: string; salesmanId: string; reportedBySpg: boolean; nilai: number; potong?: number[] },
    ) => {
      const r = await prisma.storeReturn.create({
        data: {
          noNrt: `NRT-${kunci}-${token}`,
          storeId: m.storeId,
          salesmanId: m.salesmanId,
          reportedBySpg: m.reportedBySpg,
          claimDate: TANGGAL,
          claimedAmount: m.nilai,
          items: m.potong
            ? {
                create: m.potong.map((qty, i) => ({ itemName: `Barang ${i}`, qty, price: 50_000, amount: qty * 50_000 })),
              }
            : undefined,
        },
      });
      nrt[kunci] = r.id;
    };
    await catat("milik", { storeId: tokoPutus, salesmanId: sales, reportedBySpg: false, nilai: 120_000 });
    await catat("spgPutus", { storeId: tokoPutus, salesmanId: spgPutus, reportedBySpg: true, nilai: 250_000, potong: [2, 3] });
    await catat("spgKonsi", { storeId: tokoKonsi, salesmanId: spgKonsi, reportedBySpg: true, nilai: 400_000, potong: [4] });
    // SPG di toko yang dipegang sales lain — bukan urusan sales ini.
    await catat("spgOrang", { storeId: tokoOrang, salesmanId: spgOrang, reportedBySpg: true, nilai: 90_000, potong: [1] });
    // Sales lain mencatat retur di toko yang dipegang sales ini — bukan laporan SPG, tidak ikut.
    await catat("salesLain", { storeId: tokoPutus, salesmanId: salesLain, reportedBySpg: false, nilai: 70_000 });
  });

  afterAll(async () => {
    await prisma.storeReturnItem.deleteMany({ where: { storeReturnId: { in: seededIds(Object.values(nrt)) } } });
    await prisma.storeReturn.deleteMany({ where: { id: { in: seededIds(Object.values(nrt)) } } });
    await prisma.user.deleteMany({
      where: { id: { in: seededIds([spgPutus, spgKonsi, spgOrang].filter(Boolean)) } },
    });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoPutus, tokoKonsi, tokoOrang].filter(Boolean)) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([sales, salesLain].filter(Boolean)) } } });
  });

  it("salesman: notanya sendiri + nota SPG di toko yang ia pegang, ditandai bukan miliknya", async () => {
    const baris = await returSaya(seededId(sales), { termasukSpgTokoSaya: true });
    const per = Object.fromEntries(baris.map((b) => [b.id, b]));
    expect(Object.keys(per).sort()).toEqual([nrt.milik, nrt.spgPutus, nrt.spgKonsi].sort());

    expect(per[nrt.milik]).toMatchObject({ milikSaya: true, dariSpg: false, pelapor: null, nilaiKlaim: 120_000 });
    expect(per[nrt.spgPutus]).toMatchObject({
      milikSaya: false,
      dariSpg: true,
      pelapor: `RS spgp ${token}`,
      nilaiKlaim: 250_000,
      jumlahBarang: 5,
      storeName: `RS P ${token}`,
    });
    // Toko KONSI: nilai tidak pernah sampai ke HP — yang tampil jumlah potongnya.
    expect(per[nrt.spgKonsi]).toMatchObject({ milikSaya: false, dariSpg: true, nilaiKlaim: null, jumlahBarang: 4 });
  });

  it("muatan nota KONSI dari SPG tidak membawa angka rupiah", async () => {
    const baris = await returSaya(seededId(sales), { termasukSpgTokoSaya: true });
    const konsi = baris.find((b) => b.id === nrt.spgKonsi);
    expect(konsi).toBeDefined();
    expect(JSON.stringify(konsi)).not.toContain("400000");
  });

  it("tanpa pilihan (layar SPG) tetap hanya nota milik sendiri", async () => {
    const milikSales = await returSaya(seededId(sales));
    expect(milikSales.map((b) => b.id)).toEqual([nrt.milik]);
    expect(milikSales[0]).toMatchObject({ milikSaya: true });

    const milikSpg = await returSaya(seededId(spgPutus));
    expect(milikSpg.map((b) => b.id)).toEqual([nrt.spgPutus]);
    expect(milikSpg[0]).toMatchObject({ milikSaya: true, pelapor: null });
  });

  it("sales lain yang tidak memegang toko itu tidak melihat nota SPG-nya", async () => {
    const baris = await returSaya(seededId(salesLain), { termasukSpgTokoSaya: true });
    expect(baris.map((b) => b.id).sort()).toEqual([nrt.salesLain, nrt.spgOrang].sort());
    expect(baris.find((b) => b.id === nrt.spgOrang)).toMatchObject({ milikSaya: false, pelapor: `RS spgo ${token}` });
  });
});

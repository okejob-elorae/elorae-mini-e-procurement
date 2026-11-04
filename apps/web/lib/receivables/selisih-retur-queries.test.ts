import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { kurangReturPerToko } from "./selisih-retur-queries";

/*
 * `kurangReturPerToko` — SATU sumber barang yang kurang dari nota retur toko (P22: barang yang tidak
 * ketemu "di charge ke sales", sekali). Jurnal barang hilang konsinyasi sudah membacanya; stok titipan
 * dan pencocokan konsinyasi harus membaca yang sama (R15), supaya barang yang sudah dibebankan tidak
 * terbaca lagi sebagai titipan atau hilang di hitungan berikutnya. Yang dipasak di sini:
 * - kurang = nota toko − hitungan gudang asli yang final − setiap susulan yang final, per barang+ukuran;
 * - `terbuka` vs `diputuskan` menurut `decidedAt` beban, dan `sebelum` membaca keadaan per tanggal —
 *   termasuk hitungan gudang: nota yang hitungan aslinya belum final tidak ikut (seluruh klaimnya masih
 *   retur belum dihitung di pencocokan), susulan yang belum final belum mengurangi, `finalisedAt`
 *   didahulukan dari `receivedAt`;
 * - `storeReturnIds` membatasi ke nota tertentu; daftar kosong tidak membaca apa pun;
 * - nota BATAL, beban nol, dan baris tanpa `itemId` (hanya diketik namanya) tidak ikut.
 *
 * Terhadap basis data uji; teardown hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `SRQ-${Math.random().toString(36).slice(2, 8)}`;
const DIPUTUSKAN = new Date("2026-10-10T03:00:00Z");

d("kurangReturPerToko (test bed only)", () => {
  let uomId = "";
  let kaos = "";
  let celana = "";
  let gudangId = "";
  let tokoId = "";
  let nrtIds: string[] = [];
  let nriIds: string[] = [];
  let bebanIds: string[] = [];
  let nrtTerbuka = "";
  let urut = 0;

  beforeAll(async () => {
    uomId = "";
    kaos = "";
    celana = "";
    gudangId = "";
    tokoId = "";
    nrtIds = [];
    nriIds = [];
    bebanIds = [];
    nrtTerbuka = "";
    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const barang = async (k: string) =>
      (await prisma.item.create({ data: { sku: `TEST-${tag}-${k}`, nameId: `Barang ${k}`, nameEn: `Item ${k}`, type: "FINISHED_GOOD", uomId } })).id;
    kaos = await barang("KAOS");
    celana = await barang("CELANA");
    gudangId = (await prisma.user.create({ data: { email: `${tag}-gudang@test.local`.toLowerCase(), name: `Gudang ${tag}` } })).id;
    tokoId = (await prisma.store.create({ data: { code: `${tag}-T`, name: `Toko ${tag}`, address: "uji", termsType: "KONSI" } })).id;

    /** Satu nota toko + hitungan gudang asli + beban selisihnya. */
    const nota = async (o: {
      klaim: { itemId: string | null; variantSku?: string; itemName: string; qty: number }[];
      hitung: { itemId: string | null; variantSku?: string; itemName: string; qty: number }[];
      statusNrt?: "MENUNGGU" | "BATAL";
      beban: number;
      decidedAt?: Date | null;
    }) => {
      urut += 1;
      const n = await prisma.storeReturn.create({
        data: {
          noNrt: `${tag}-NRT-${urut}`,
          storeId: tokoId,
          claimDate: new Date("2026-10-01T03:00:00Z"),
          claimedAmount: 100_000,
          status: o.statusNrt ?? "MENUNGGU",
          items: {
            create: o.klaim.map((b) => ({ itemId: b.itemId, variantSku: b.variantSku ?? "", itemName: b.itemName, qty: b.qty, price: 10_000, amount: b.qty * 10_000 })),
          },
        },
      });
      nrtIds.push(n.id);
      const w = await prisma.warehouseReturn.create({
        data: {
          noNri: `${tag}-NRI-${urut}`,
          storeId: tokoId,
          storeReturnId: n.id,
          warehouseUserId: gudangId,
          receivedAt: new Date("2026-10-03T03:00:00Z"),
          physicalAmount: 0,
          status: "FINAL",
          items: {
            create: o.hitung.map((b) => ({ itemId: b.itemId, variantSku: b.variantSku ?? "", itemName: b.itemName, qty: b.qty, price: 10_000, amount: b.qty * 10_000 })),
          },
        },
      });
      nriIds.push(w.id);
      const c = await prisma.returnCharge.create({
        data: {
          storeReturnId: n.id,
          storeId: tokoId,
          amount: o.beban,
          status: o.decidedAt ? "DITETAPKAN" : "TERBUKA",
          bearer: o.decidedAt ? "SALES" : null,
          decidedAt: o.decidedAt ?? null,
        },
      });
      bebanIds.push(c.id);
      return n.id;
    };

    // 1. Diputuskan ke sales: kaos M kurang 2 (5 − 3), celana tanpa ukuran kurang 1; susulan final
    //    mengembalikan 1 kaos M → kaos M kurang 1. Hitungan asli tanpa `finalisedAt` (baris lama:
    //    final menurut `receivedAt` 3 Okt); susulan diterima 12 Okt, final 13 Okt.
    const n1 = await nota({
      klaim: [
        { itemId: kaos, variantSku: "M", itemName: "Kaos", qty: 5 },
        { itemId: celana, itemName: "Celana", qty: 2 },
        { itemId: null, itemName: "Barang ketik", qty: 4 },
      ],
      hitung: [
        { itemId: kaos, variantSku: "M", itemName: "Kaos", qty: 3 },
        { itemId: celana, itemName: "Celana", qty: 1 },
      ],
      beban: 30_000,
      decidedAt: DIPUTUSKAN,
    });
    urut += 1;
    const susulan = await prisma.warehouseReturn.create({
      data: {
        noNri: `${tag}-NRI-${urut}`,
        storeId: tokoId,
        followUpOfStoreReturnId: n1,
        warehouseUserId: gudangId,
        receivedAt: new Date("2026-10-12T03:00:00Z"),
        physicalAmount: 10_000,
        status: "FINAL",
        finalisedAt: new Date("2026-10-13T03:00:00Z"),
        items: { create: [{ itemId: kaos, variantSku: "M", itemName: "Kaos", qty: 1, price: 10_000, amount: 10_000 }] },
      },
    });
    nriIds.push(susulan.id);

    // 2. Belum diputuskan: kaos L kurang 2.
    nrtTerbuka = await nota({
      klaim: [{ itemId: kaos, variantSku: "L", itemName: "Kaos", qty: 2 }],
      hitung: [],
      beban: 20_000,
    });

    // 3. Tidak ikut: nota BATAL, dan nota yang bebannya nol.
    await nota({ klaim: [{ itemId: celana, itemName: "Celana", qty: 9 }], hitung: [], beban: 90_000, statusNrt: "BATAL" });
    await nota({ klaim: [{ itemId: celana, itemName: "Celana", qty: 7 }], hitung: [], beban: 0 });
  });

  afterAll(async () => {
    await prisma.returnCharge.deleteMany({ where: { id: { in: seededIds(bebanIds) } } });
    await prisma.warehouseReturnItem.deleteMany({ where: { warehouseReturnId: { in: seededIds(nriIds) } } });
    await prisma.warehouseReturn.deleteMany({ where: { id: { in: seededIds(nriIds) } } });
    await prisma.storeReturnItem.deleteMany({ where: { storeReturnId: { in: seededIds(nrtIds) } } });
    await prisma.storeReturn.deleteMany({ where: { id: { in: seededIds(nrtIds) } } });
    await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
    await prisma.user.deleteMany({ where: { id: seededId(gudangId) } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kaos, celana].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const urutkan = (x: { itemId: string; variantSku: string; qty: number }[]) =>
    [...x].sort((a, b) => `${a.itemId}:${a.variantSku}`.localeCompare(`${b.itemId}:${b.variantSku}`));

  it("memisahkan yang diputuskan dari yang terbuka, sesudah setiap hitungan final", async () => {
    const g = (await kurangReturPerToko(prisma, [tokoId])).get(tokoId);
    expect(urutkan(g?.diputuskan ?? [])).toEqual(
      urutkan([
        { itemId: kaos, variantSku: "M", qty: 1 },
        { itemId: celana, variantSku: "", qty: 1 },
      ]),
    );
    expect(g?.terbuka).toEqual([{ itemId: kaos, variantSku: "L", qty: 2 }]);
  });

  it("`sebelum` membaca keadaan per tanggal: yang diputuskan pada/sesudahnya masih terbuka, susulan yang belum final belum mengurangi", async () => {
    const g = (await kurangReturPerToko(prisma, [tokoId], { sebelum: DIPUTUSKAN })).get(tokoId);
    expect(g?.diputuskan).toEqual([]);
    expect(urutkan(g?.terbuka ?? [])).toEqual(
      urutkan([
        { itemId: kaos, variantSku: "M", qty: 2 },
        { itemId: celana, variantSku: "", qty: 1 },
        { itemId: kaos, variantSku: "L", qty: 2 },
      ]),
    );
  });

  it("`sebelum`: `finalisedAt` didahulukan dari `receivedAt` — susulan yang sudah diterima tapi belum final belum mengurangi", async () => {
    const g = (await kurangReturPerToko(prisma, [tokoId], { sebelum: new Date("2026-10-12T12:00:00Z") })).get(tokoId);
    expect(urutkan(g?.diputuskan ?? [])).toEqual(
      urutkan([
        { itemId: kaos, variantSku: "M", qty: 2 },
        { itemId: celana, variantSku: "", qty: 1 },
      ]),
    );
    expect(g?.terbuka).toEqual([{ itemId: kaos, variantSku: "L", qty: 2 }]);
  });

  it("`sebelum` sesudah setiap hitungan dan keputusan sama dengan keadaan sekarang", async () => {
    const sekarang = (await kurangReturPerToko(prisma, [tokoId])).get(tokoId);
    const g = (await kurangReturPerToko(prisma, [tokoId], { sebelum: new Date("2026-10-15T03:00:00Z") })).get(tokoId);
    expect(urutkan(g?.diputuskan ?? [])).toEqual(urutkan(sekarang?.diputuskan ?? []));
    expect(urutkan(g?.terbuka ?? [])).toEqual(urutkan(sekarang?.terbuka ?? []));
  });

  it("`sebelum` mendahului hitungan gudang asli: kurangnya belum ada, tidak ada yang dibaca", async () => {
    expect((await kurangReturPerToko(prisma, [tokoId], { sebelum: new Date("2026-10-02T03:00:00Z") })).get(tokoId)).toBeUndefined();
  });

  it("`storeReturnIds` membatasi ke nota itu saja; daftar kosong tidak membaca apa pun", async () => {
    const g = (await kurangReturPerToko(prisma, [tokoId], { storeReturnIds: [seededId(nrtTerbuka)] })).get(tokoId);
    expect(g?.diputuskan).toEqual([]);
    expect(g?.terbuka).toEqual([{ itemId: kaos, variantSku: "L", qty: 2 }]);
    expect((await kurangReturPerToko(prisma, [tokoId], { storeReturnIds: [] })).size).toBe(0);
  });

  it("tanpa toko, tidak membaca apa pun", async () => {
    expect((await kurangReturPerToko(prisma, [])).size).toBe(0);
  });
});

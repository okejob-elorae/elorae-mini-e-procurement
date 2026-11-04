import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isiKategoriPenjualanSpg, prisma, seededId, seededIds } from "@elorae/db";
import { spgSaleMovements } from "./laporan-queries";

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

/**
 * Gerakan komisi SPG (`spgSaleMovements`) terhadap basis data uji (keputusan pemilik 2026-11-02):
 *
 * - P8 / B1: kategori sebuah potong diambil dari BARIS penjualannya (disimpan saat terjual), tidak
 *   pernah dari `Item.categoryId` sekarang. Barangnya sudah dipindah ke kategori lain sesudah dijual.
 * - P69 / B2: baris yang terjual tanpa kategori mengikuti kategori yang diberikan belakangan, sekali
 *   (`isiKategoriPenjualanSpg`), lalu beku. Baris yang ditulis image lama (`categoryAt` kosong) tidak
 *   disentuh.
 * - P9 / B5: retur pembeli yang DISETUJUI mengurangi bulan NOTA ASLINYA (Oktober), walau dilaporkan
 *   dan disetujui di November, pada kategori baris aslinya dan atas nama penjual nota itu. Laporan
 *   yang MENUNGGU tidak dihitung.
 *
 * Pembaca dipanggil dengan cakupan toko uji saja; penghapusan lewat `seededId()`.
 */
d("gerakan komisi SPG: kategori dari baris, retur di bulan nota asli (test bed only)", () => {
  const tag = `LKT-${Math.random().toString(36).slice(2, 8)}`;
  let uomId = "";
  let katLama = "";
  let katBaru = "";
  let katBelakangan = "";
  let itemId = "";
  let itemTanpa = "";
  let storeId = "";
  let spgId = "";
  const saleIds: string[] = [];
  let lineOkt = "";
  let lineTanpa = "";
  let lineLama = "";

  const OKT = new Date("2026-10-15T03:00:00.000Z");
  const NOV = new Date("2026-11-05T03:00:00.000Z");

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    katLama = (await prisma.itemCategory.create({ data: { code: `${tag}-A`, name: `${tag} Kaos` } })).id;
    katBaru = (await prisma.itemCategory.create({ data: { code: `${tag}-B`, name: `${tag} Kemeja` } })).id;
    katBelakangan = (await prisma.itemCategory.create({ data: { code: `${tag}-C`, name: `${tag} Topi` } })).id;
    // Saat dijual barang ini berkategori katLama; sesudahnya dipindah ke katBaru.
    itemId = (
      await prisma.item.create({ data: { sku: `${tag}-1`, nameId: `Kaos ${tag}`, nameEn: "Tee", type: "FINISHED_GOOD", uomId, isActive: true, categoryId: katBaru } })
    ).id;
    itemTanpa = (await prisma.item.create({ data: { sku: `${tag}-2`, nameId: `Topi ${tag}`, nameEn: "Cap", type: "FINISHED_GOOD", uomId, isActive: true } })).id;
    storeId = (await prisma.store.create({ data: { code: `${tag}-T`, name: `${tag} Toko`, address: "uji", termsType: "PUTUS", isActive: true } })).id;
    spgId = (await prisma.user.create({ data: { email: `${tag}-spg@test.local`.toLowerCase(), name: `SPG ${tag}`, assignedStoreId: storeId } })).id;

    const jual = async (n: number, lines: Array<{ itemId: string; qty: number; categoryId: string | null; categoryAt: Date | null }>) => {
      const s = await prisma.spgSale.create({
        data: {
          docNo: `${tag}/SPG/${n}`,
          salesmanId: spgId,
          storeId,
          subtotal: 0,
          total: 0,
          cashReceived: 0,
          changeGiven: 0,
          createdById: spgId,
          createdAt: OKT,
          lines: {
            create: lines.map((l) => ({
              itemId: l.itemId,
              productName: `Barang ${tag}`,
              qty: l.qty,
              unitPrice: 10_000,
              lineTotal: 10_000 * l.qty,
              categoryId: l.categoryId,
              categoryAt: l.categoryAt,
            })),
          },
        },
        select: { id: true, lines: { select: { id: true } } },
      });
      saleIds.push(s.id);
      return s.lines.map((l) => l.id);
    };
    [lineOkt] = await jual(1, [{ itemId, qty: 5, categoryId: katLama, categoryAt: OKT }]);
    [lineTanpa] = await jual(2, [{ itemId: itemTanpa, qty: 2, categoryId: null, categoryAt: OKT }]);
    // Ditulis image lama selama jendela deploy: tanpa kategori DAN tanpa categoryAt.
    [lineLama] = await jual(3, [{ itemId: itemTanpa, qty: 1, categoryId: null, categoryAt: null }]);

    const retur = (kunci: string, status: "DISETUJUI" | "MENUNGGU") =>
      prisma.spgSaleReturn.create({
        data: {
          spgSaleId: saleIds[0],
          storeId,
          createdById: spgId,
          reason: `uji ${kunci}`,
          idempotencyKey: `${tag}-${kunci}`,
          status,
          createdAt: NOV,
          ...(status === "DISETUJUI" ? { decidedAt: NOV } : {}),
          lines: { create: [{ spgSaleLineId: lineOkt, itemId, qty: 1 }] },
        },
      });
    await retur("r1", "DISETUJUI");
    await retur("r2", "MENUNGGU");
  });

  afterAll(async () => {
    for (const id of saleIds) {
      await prisma.spgSaleReturn.deleteMany({ where: { spgSaleId: seededId(id) } });
      await prisma.spgSale.delete({ where: { id: seededId(id) } });
    }
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgId].filter(Boolean)) } } });
    if (storeId) await prisma.store.delete({ where: { id: seededId(storeId) } });
    for (const id of [itemId, itemTanpa].filter(Boolean)) await prisma.item.delete({ where: { id: seededId(id) } });
    for (const id of [katLama, katBaru, katBelakangan].filter(Boolean)) await prisma.itemCategory.delete({ where: { id: seededId(id) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  it("kategori dari baris penjualan saat terjual, bukan kategori barang sekarang (P8)", async () => {
    const m = (await spgSaleMovements(prisma, [storeId], "2026-10")).get(storeId) ?? [];
    const jualan = m.filter((x) => x.itemId === itemId && x.qty > 0);
    expect(jualan).toEqual([{ salesmanId: spgId, itemId, categoryId: katLama, qty: 5 }]);
    expect(m.some((x) => x.categoryId === katBaru)).toBe(false);
  });

  it("retur yang disetujui di November mengurangi Oktober pada kategori baris aslinya; yang menunggu tidak dihitung (P9)", async () => {
    const okt = (await spgSaleMovements(prisma, [storeId], "2026-10")).get(storeId) ?? [];
    expect(okt.filter((x) => x.qty < 0)).toEqual([{ salesmanId: spgId, itemId, categoryId: katLama, qty: -1 }]);
    const nov = (await spgSaleMovements(prisma, [storeId], "2026-11")).get(storeId) ?? [];
    expect(nov).toEqual([]);
  });

  it("baris tanpa kategori mengikuti kategori yang diberikan belakangan, sekali; baris image lama tidak disentuh (P69)", async () => {
    const sebelum = (await spgSaleMovements(prisma, [storeId], "2026-10")).get(storeId) ?? [];
    expect(sebelum.filter((x) => x.itemId === itemTanpa).map((x) => [x.categoryId, x.qty])).toEqual([[null, 3]]);

    const diisi = await prisma.$transaction((tx) => isiKategoriPenjualanSpg(tx, { itemId: itemTanpa, categoryId: katBelakangan, waktu: NOV }));
    expect(diisi).toBe(1);
    const baris = await prisma.spgSaleLine.findMany({ where: { id: { in: [lineTanpa, lineLama] } }, select: { id: true, categoryId: true, categoryFilledLater: true } });
    expect(baris.find((b) => b.id === lineTanpa)).toMatchObject({ categoryId: katBelakangan, categoryFilledLater: true });
    expect(baris.find((b) => b.id === lineLama)).toMatchObject({ categoryId: null, categoryFilledLater: false });

    const sesudah = (await spgSaleMovements(prisma, [storeId], "2026-10")).get(storeId) ?? [];
    expect(
      sesudah
        .filter((x) => x.itemId === itemTanpa)
        .map((x) => [x.categoryId, x.qty])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual(
      [
        [katBelakangan, 2],
        [null, 1],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );

    // Kategori yang diganti lagi sesudahnya tidak menggeser baris yang sudah beku.
    const lagi = await prisma.$transaction((tx) => isiKategoriPenjualanSpg(tx, { itemId: itemTanpa, categoryId: katBaru, waktu: new Date() }));
    expect(lagi).toBe(0);
    expect((await prisma.spgSaleLine.findUniqueOrThrow({ where: { id: lineTanpa }, select: { categoryId: true } })).categoryId).toBe(katBelakangan);
  });
});

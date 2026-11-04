import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { muatOpnameTokoSesudah } from "./pesanan-lama";

/* Menulis data uji — tidak pernah dijalankan terhadap basis data produksi (tunnel 3307 / host VPS). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Peringatan "toko ini sudah opname sesudah pesanan disetujui" di HP SPG dan salesman pemegang toko
 * (`muatOpnameTokoSesudah`) terhadap basis data sungguhan. Konfirmasi sampai pesanan konsi lama
 * menambah `StoreStock` (yang ditetapkan ulang opname toko versi tim, `StoreStocktake`) DAN buku
 * stok SPG (yang ditetapkan ulang `StoreOpname`), jadi kedua opname harus memicu peringatannya.
 * Semua data milik tes ini; setiap filter penghapusan lewat `seededId()`/`seededIds()`.
 */
d("opname toko sesudah pesanan konsi lama disetujui (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  const DISETUJUI = new Date("2026-08-01T03:00:00.000Z");
  const SEBELUM = new Date("2026-07-20T03:00:00.000Z");
  const jam = (iso: string) => new Date(iso);
  let urut = 0;
  let nomor = 0;

  let uomId = "";
  let barangId = "";
  let barangLainId = "";
  let tokoId = "";
  let penggunaId = "";
  let stocktakeIds: string[] = [];
  let opnameSpgIds: string[] = [];

  beforeEach(async () => {
    uomId = "";
    barangId = "";
    barangLainId = "";
    tokoId = "";
    penggunaId = "";
    stocktakeIds = [];
    opnameSpgIds = [];
    urut += 1;
    const tag = `${token}-${urut}`;

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-OTS-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const barang = (kode: string) =>
      prisma.item.create({ data: { sku: `TEST-OTS-${kode}-${tag}`, nameId: `Kaos ${kode}`, nameEn: `Tee ${kode}`, type: "FINISHED_GOOD", uomId, isActive: true } });
    barangId = (await barang("A")).id;
    barangLainId = (await barang("B")).id;
    tokoId = (
      await prisma.store.create({
        data: { code: `TEST-OTS-${tag}`, name: "Toko Opname Uji", address: "Alamat uji", termsType: "KONSI", markupPercent: 20, isActive: true },
      })
    ).id;
    penggunaId = (await prisma.user.create({ data: { email: `test-ots-${tag}@example.com`, name: "SPG Opname Uji", assignedStoreId: tokoId } })).id;
  });

  afterEach(async () => {
    await prisma.storeStocktakeLine.deleteMany({ where: { stocktakeId: { in: seededIds(stocktakeIds) } } });
    await prisma.storeStocktake.deleteMany({ where: { id: { in: seededIds(stocktakeIds) } } });
    await prisma.storeOpnameLine.deleteMany({ where: { opnameId: { in: seededIds(opnameSpgIds) } } });
    await prisma.storeOpname.deleteMany({ where: { id: { in: seededIds(opnameSpgIds) } } });
    await prisma.user.deleteMany({ where: { id: seededId(penggunaId) } });
    await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([barangId, barangLainId].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  /** Opname toko versi tim. `dibuka` = `countedAt` (saat dokumen dibuat), sengaja SEBELUM pesanan disetujui. */
  async function opnameTim(o: {
    status: "DRAFT" | "PENDING_VERIFICATION" | "APPROVED" | "CANCELLED";
    countFinishedAt: Date | null;
    approvedAt?: Date | null;
    itemId?: string;
    countedQty?: number | null;
  }) {
    nomor += 1;
    const st = await prisma.storeStocktake.create({
      data: {
        docNo: `TEST-OTS/${token}/${urut}/${nomor}`,
        storeId: tokoId,
        status: o.status,
        countedAt: SEBELUM,
        countFinishedAt: o.countFinishedAt,
        approvedAt: o.approvedAt ?? null,
        createdById: penggunaId,
        lines: {
          create: [
            {
              itemId: o.itemId ?? barangId,
              variantSku: "",
              productName: "Kaos uji",
              expectedQty: 0,
              countedQty: o.countedQty === undefined ? 5 : o.countedQty,
              countFinishedAt: o.countFinishedAt,
            },
          ],
        },
      },
      select: { id: true },
    });
    stocktakeIds.push(st.id);
  }

  /** Opname buku stok SPG (versi Max). */
  async function opnameSpg(countedAt: Date, itemId: string = barangId) {
    const o = await prisma.storeOpname.create({
      data: {
        storeId: tokoId,
        countedById: penggunaId,
        countedAt,
        lines: { create: [{ itemId, variantSku: "", productName: "Kaos uji", qtySystem: 0, qtyCounted: 5 }] },
      },
      select: { id: true },
    });
    opnameSpgIds.push(o.id);
  }

  const muat = (itemIds: string[] = [barangId]) => muatOpnameTokoSesudah(prisma, { storeId: tokoId, sejak: DISETUJUI, itemIds });

  it("tanpa opname: tidak ada peringatan; daftar barang kosong tidak membaca apa pun", async () => {
    expect(await muat()).toBeNull();
    await opnameTim({ status: "APPROVED", countFinishedAt: jam("2026-08-20T03:00:00.000Z"), approvedAt: jam("2026-08-21T03:00:00.000Z") });
    expect(await muat([])).toBeNull();
    expect(await muatOpnameTokoSesudah(prisma, { storeId: "", sejak: DISETUJUI, itemIds: [barangId] })).toBeNull();
  });

  it("opname tim yang disetujui sesudah pesanan: saat HITUNGNYA, bukan saat dokumennya dibuka", async () => {
    const dihitung = jam("2026-08-20T03:00:00.000Z");
    await opnameTim({ status: "APPROVED", countFinishedAt: dihitung, approvedAt: jam("2026-08-21T03:00:00.000Z") });
    expect((await muat())?.toISOString()).toBe(dihitung.toISOString());
  });

  it("hitungan lama tanpa countFinishedAt memakai approvedAt", async () => {
    const disahkan = jam("2026-08-25T03:00:00.000Z");
    await opnameTim({ status: "APPROVED", countFinishedAt: null, approvedAt: disahkan });
    expect((await muat())?.toISOString()).toBe(disahkan.toISOString());
  });

  it("hitungan yang belum disetujui ikut (persetujuannya nanti menambahkan konfirmasi juga); yang dibatalkan dan baris yang belum dihitung tidak", async () => {
    const menunggu = jam("2026-08-15T03:00:00.000Z");
    await opnameTim({ status: "CANCELLED", countFinishedAt: jam("2026-09-01T03:00:00.000Z") });
    await opnameTim({ status: "DRAFT", countFinishedAt: jam("2026-09-03T03:00:00.000Z"), countedQty: null });
    expect(await muat()).toBeNull();
    await opnameTim({ status: "PENDING_VERIFICATION", countFinishedAt: menunggu });
    expect((await muat())?.toISOString()).toBe(menunggu.toISOString());
  });

  it("hanya opname yang menghitung barang pesanan ini, dan hanya yang sesudah pesanan disetujui", async () => {
    await opnameTim({ status: "APPROVED", countFinishedAt: jam("2026-08-20T03:00:00.000Z"), approvedAt: jam("2026-08-20T04:00:00.000Z"), itemId: barangLainId });
    await opnameTim({ status: "APPROVED", countFinishedAt: jam("2026-07-25T03:00:00.000Z"), approvedAt: jam("2026-07-26T03:00:00.000Z") });
    await opnameSpg(jam("2026-08-22T03:00:00.000Z"), barangLainId);
    await opnameSpg(jam("2026-07-28T03:00:00.000Z"));
    expect(await muat()).toBeNull();
    // Barang lain itu ada di pesanan yang lain: untuk pesanan itu peringatannya muncul.
    expect((await muat([barangLainId]))?.toISOString()).toBe("2026-08-22T03:00:00.000Z");
  });

  it("opname buku SPG dan opname tim sama-sama dibaca; yang tampil yang paling akhir", async () => {
    await opnameSpg(jam("2026-08-10T03:00:00.000Z"));
    expect((await muat())?.toISOString()).toBe("2026-08-10T03:00:00.000Z");
    await opnameTim({ status: "APPROVED", countFinishedAt: jam("2026-09-02T03:00:00.000Z"), approvedAt: jam("2026-09-03T03:00:00.000Z") });
    expect((await muat())?.toISOString()).toBe("2026-09-02T03:00:00.000Z");
    await opnameSpg(jam("2026-09-10T03:00:00.000Z"));
    expect((await muat())?.toISOString()).toBe("2026-09-10T03:00:00.000Z");
  });
});

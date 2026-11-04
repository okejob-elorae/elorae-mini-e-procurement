import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { JEJAK } from "@/lib/receivables/jejak";
import {
  dokumenKoreksiTertunda,
  getAntreanKantor,
  hitungBarangStokMinus,
  hitungGudangRusakBersaldo,
  idTokoTanpaPemegang,
} from "./antrean-kantor";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Hitungan antrean kantor terhadap baris sungguhan. Basis datanya dipakai
 * bersama, jadi setiap hitungan global diuji lewat SELISIH sebelum/sesudah
 * menanam baris uji, dan himpunan id lewat keanggotaan baris uji sendiri.
 * Pembongkaran lewat `seededId()`.
 */
d("antrean kantor (test bed only)", () => {
  let token = "";
  let userId = "";
  let uomId = "";
  let itemIds: string[] = [];
  let storeIds: string[] = [];
  let requestIds: string[] = [];
  let movementIds: string[] = [];
  let inventoryIds: string[] = [];
  let noteIds: string[] = [];
  let returnIds: string[] = [];
  let auditIds: string[] = [];
  let tokoTanpaId = "";
  let tokoDipegangId = "";

  beforeEach(async () => {
    token = "";
    userId = "";
    uomId = "";
    itemIds = [];
    storeIds = [];
    requestIds = [];
    movementIds = [];
    inventoryIds = [];
    noteIds = [];
    returnIds = [];
    auditIds = [];
    tokoTanpaId = "";
    tokoDipegangId = "";
    token = `AK${Math.floor(Math.random() * 10_000_000)}`;

    userId = (await prisma.user.create({ data: { email: `${token}@test.local`, name: "Uji Antrean" } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `U-${token}`, nameId: "pcs", nameEn: "pcs" } })).id;
    for (const n of [1, 2, 3, 4]) {
      itemIds.push(
        (
          await prisma.item.create({
            data: { sku: `B${n}-${token}`, nameId: `Barang ${n}`, nameEn: `Item ${n}`, type: "FINISHED_GOOD", isActive: true, uomId },
          })
        ).id,
      );
    }
    const toko = (kode: string, salesmanId: string | null) =>
      prisma.store.create({
        data: { code: `${kode}-${token}`, name: `Toko ${kode} ${token}`, address: "-", termsType: "KONSI", salesmanId },
        select: { id: true },
      });
    tokoTanpaId = (await toko("TANPA", null)).id;
    tokoDipegangId = (await toko("PEGANG", userId)).id;
    storeIds = [tokoTanpaId, tokoDipegangId];
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { id: { in: seededIds(auditIds) } } });
    await prisma.storeReturn.deleteMany({ where: { id: { in: seededIds(returnIds) } } });
    await prisma.collectionNote.deleteMany({ where: { id: { in: seededIds(noteIds) } } });
    await prisma.stockRequest.deleteMany({ where: { id: { in: seededIds(requestIds) } } });
    await prisma.damagedStockMovement.deleteMany({ where: { id: { in: seededIds(movementIds) } } });
    await prisma.inventoryValue.deleteMany({ where: { id: { in: seededIds(inventoryIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds(storeIds) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds(itemIds) } } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    if (userId) await prisma.user.delete({ where: { id: seededId(userId) } });
  });

  it("permintaan stok SPG: hanya yang BARU di toko tanpa pemegang", async () => {
    const sebelum = (await getAntreanKantor(["*"])).stockRequestsUnheld ?? 0;
    const minta = (storeId: string, status: "BARU" | "DIPROSES") =>
      prisma.stockRequest.create({ data: { storeId, requestedById: userId, status }, select: { id: true } });
    requestIds.push((await minta(tokoTanpaId, "BARU")).id);
    requestIds.push((await minta(tokoTanpaId, "BARU")).id);
    requestIds.push((await minta(tokoTanpaId, "DIPROSES")).id);
    requestIds.push((await minta(tokoDipegangId, "BARU")).id);

    expect((await getAntreanKantor(["*"])).stockRequestsUnheld).toBe(sebelum + 2);
    const tanpa = await idTokoTanpaPemegang();
    expect(tanpa.has(tokoTanpaId)).toBe(true);
    expect(tanpa.has(tokoDipegangId)).toBe(false);
  });

  it("gudang barang rusak: satu baris per barang × varian yang saldonya bukan nol", async () => {
    const sebelum = await hitungGudangRusakBersaldo();
    const gerak = (itemId: string, variantSku: string, qty: number, kind: string) =>
      prisma.damagedStockMovement.create({
        data: { itemId, variantSku, productName: "Uji", qty, kind, createdById: userId },
        select: { id: true },
      });
    // Barang 1 ukuran M: masuk 3, dimusnahkan 1 → saldo 2 (menunggu).
    movementIds.push((await gerak(itemIds[0], "M", 3, "MASUK_RETUR")).id);
    movementIds.push((await gerak(itemIds[0], "M", -1, "MUSNAHKAN")).id);
    // Barang 1 ukuran L: masuk 2, diperbaiki 2 → saldo 0 (beres).
    movementIds.push((await gerak(itemIds[0], "L", 2, "MASUK_RETUR")).id);
    movementIds.push((await gerak(itemIds[0], "L", -2, "PERBAIKI")).id);
    // Barang 2 tanpa varian: masuk 1 → menunggu.
    movementIds.push((await gerak(itemIds[1], "", 1, "MASUK_RETUR")).id);

    expect(await hitungGudangRusakBersaldo()).toBe(sebelum + 2);
  });

  it("stok minus dihitung per barang, semua varian dijumlah — sama dengan saringan NEGATIF Inventori", async () => {
    const sebelum = await hitungBarangStokMinus();
    const stok = (itemId: string, variantSku: string | null, qtyOnHand: number, reservedQty: number) =>
      prisma.inventoryValue.create({ data: { itemId, variantSku, qtyOnHand, reservedQty }, select: { id: true } });
    // Barang 1: XL minus 2 tetapi M lebih 5 → tersedia +3, tidak tampil di saringan NEGATIF.
    inventoryIds.push((await stok(itemIds[0], "XL", 1, 3)).id);
    inventoryIds.push((await stok(itemIds[0], "M", 5, 0)).id);
    // Barang 2: dua varian sama-sama minus → tersedia −3.
    inventoryIds.push((await stok(itemIds[1], "XL", 0, 1)).id);
    inventoryIds.push((await stok(itemIds[1], "M", 2, 4)).id);
    // Barang 3: tanpa pesanan, stok di tangan minus.
    inventoryIds.push((await stok(itemIds[2], null, -1, 0)).id);
    // Barang 4: pas nol — habis, bukan minus.
    inventoryIds.push((await stok(itemIds[3], null, 2, 2)).id);

    expect(await hitungBarangStokMinus()).toBe(sebelum + 2);
  });

  it("janji bayar lapangan: berjalan, dari lapangan, belum dikonfirmasi", async () => {
    const sebelum = (await getAntreanKantor(["*"])).fieldPromisesUnconfirmed ?? 0;
    const janji = (n: number, data: { source: string; status?: "BERJALAN" | "SELESAI"; confirmedAt?: Date }) =>
      prisma.collectionNote.create({
        data: {
          docNo: `TT-${token}-${n}`,
          storeId: tokoTanpaId,
          salesmanId: userId,
          handoverDate: new Date(),
          promisedDate: new Date(),
          ...data,
        },
        select: { id: true },
      });
    noteIds.push((await janji(1, { source: "FIELD" })).id);
    noteIds.push((await janji(2, { source: "FIELD", confirmedAt: new Date() })).id);
    noteIds.push((await janji(3, { source: "FIELD", status: "SELESAI" })).id);
    noteIds.push((await janji(4, { source: "OFFICE" })).id);

    expect((await getAntreanKantor(["*"])).fieldPromisesUnconfirmed).toBe(sebelum + 1);
  });

  it("koreksi nota retur: tertunda sampai notanya berubah sesudah permintaan", async () => {
    const nrt = await prisma.storeReturn.create({
      data: { noNrt: `NRT-${token}`, storeId: tokoTanpaId, claimDate: new Date(), claimedAmount: 100_000 },
      select: { id: true, updatedAt: true },
    });
    returnIds.push(nrt.id);
    const minta = await prisma.auditLog.create({
      data: {
        userId,
        action: JEJAK.KOREKSI_DIMINTA,
        entityType: "StoreReturn",
        entityId: nrt.id,
        reason: "salah toko",
        createdAt: new Date(nrt.updatedAt.getTime() + 1_000),
      },
      select: { id: true },
    });
    auditIds.push(minta.id);

    expect((await dokumenKoreksiTertunda("retur")).has(nrt.id)).toBe(true);
    // Jenis lain tidak tercampur.
    expect((await dokumenKoreksiTertunda("bkm")).has(nrt.id)).toBe(false);

    // Kantor menindaklanjuti (notanya berubah sesudah permintaan) → selesai sendiri.
    await prisma.storeReturn.update({
      where: { id: nrt.id },
      data: { note: "dibetulkan", updatedAt: new Date(nrt.updatedAt.getTime() + 2_000) },
    });
    expect((await dokumenKoreksiTertunda("retur")).has(nrt.id)).toBe(false);
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { AKSI_PPN_KONSI_TOKO, createStore, updateStore, type StoreFields } from "./queries";

/*
 * Sakelar "Tagihan konsinyasi memakai PPN" (`Store.consignmentVat`) lewat
 * penulis formulir toko yang asli: bawaan mati, setiap perubahan berjejak di
 * transaksi yang sama, formulir yang tidak mengirimnya tidak mengubahnya.
 * Basis data uji bersama: teardown lewat `seededId()`.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const token = Math.floor(Math.random() * 1e7);
const tokoIds: string[] = [];
let userId = "";

const dasar = (kode: string): StoreFields => ({
  code: kode,
  name: `Toko PPN ${token}`,
  address: "uji",
  phone: null,
  contactName: null,
  termsType: "KONSI",
  paymentTempo: 0,
  markupPercent: 25,
  priceDiscountPercent: null,
  creditLimit: null,
  npwp: null,
  lat: null,
  lng: null,
  checkinRadiusMeters: null,
  sellThroughMethod: null,
  isPkp: false,
  groupId: null,
  salesmanId: null,
});

d("PPN tagihan konsinyasi per toko (basis data uji)", () => {
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds(tokoIds) } } });
    if (userId) await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("bawaan tanpa PPN; dinyalakan dan dimatikan berjejak; formulir tanpa isian ini tidak mengubahnya", async () => {
    userId = (await prisma.user.create({ data: { email: `ppn-toko-${token}@test.local`, name: "Uji PPN toko" }, select: { id: true } })).id;
    const t = await createStore(dasar(`PPNK${token}`));
    tokoIds.push(t.id);
    expect(t.consignmentVat).toBe(false);

    const nyala = await updateStore(t.id, { ...dasar(`PPNK${token}`), consignmentVat: true }, userId);
    expect(nyala.consignmentVat).toBe(true);
    // Pemanggil lama yang tidak mengirim sakelarnya tidak mematikannya diam-diam.
    expect((await updateStore(t.id, dasar(`PPNK${token}`), userId)).consignmentVat).toBe(true);
    await updateStore(t.id, { ...dasar(`PPNK${token}`), consignmentVat: false }, userId);

    const jejak = await prisma.auditLog.findMany({ where: { entityId: t.id, action: AKSI_PPN_KONSI_TOKO }, orderBy: { createdAt: "asc" }, select: { changes: true } });
    expect(jejak.map((j) => j.changes)).toEqual([
      { before: { consignmentVat: false }, after: { consignmentVat: true } },
      { before: { consignmentVat: true }, after: { consignmentVat: false } },
    ]);
  });
});

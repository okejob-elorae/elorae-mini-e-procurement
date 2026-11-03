import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { pindahkanToko } from "./penanggung-jawab-writer";
import { updateStore, type StoreFields } from "./queries";

/**
 * Kosongkan pemegang massal vs formulir toko yang menjadikan toko itu KONSI,
 * bersamaan. Toko KONSI wajib punya pemegang (pemilik P47, 2026-11-02).
 * `pindahkanToko` membaca `termsType` lalu menulis `salesmanId`; di transaksi
 * biasa formulir bisa tersimpan di antaranya — toko sudah KONSI, lalu
 * pengosongan menimpa pemegangnya. Di bawah `runSerializable` salah satunya
 * diulang: pengosongan lebih dulu (formulir lalu memasang pemegangnya lagi),
 * atau formulir lebih dulu (pengosongan melihat KONSI dan menolak).
 *
 * Terhadap basis data uji bersama; teardown lewat `seededId()`. Mulainya
 * digeser beberapa milidetik bergantian, supaya penulis yang lebih pendek tidak
 * selalu sampai lebih dulu.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tunda = (ms: number) => new Promise((r) => setTimeout(r, ms));

d("pemegang toko KONSI — pindah massal vs formulir toko bersamaan (test bed only)", () => {
  let token = "";
  let tokoId = "";
  let pemegangId = "";
  let adminId = "";

  beforeEach(async () => {
    token = "";
    tokoId = "";
    pemegangId = "";
    adminId = "";
    token = Math.random().toString(36).slice(2, 10).toUpperCase();
    const buat = async (peran: string) =>
      (await prisma.user.create({ data: { email: `${peran}-${token}@uji.local`.toLowerCase(), name: `${peran} ${token}` }, select: { id: true } })).id;
    pemegangId = await buat("pemegang-balap");
    adminId = await buat("admin-balap");
    tokoId = (
      await prisma.store.create({
        data: { code: `PJB-${token}`, name: `Toko Balap ${token}`, address: "uji", termsType: "PUTUS", markupPercent: 25, salesmanId: pemegangId },
        select: { id: true },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "Store", entityId: seededId(tokoId) } });
    await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(pemegangId), seededId(adminId)] } } });
  });

  /** Formulir toko yang sama, kini KONSI — pemegangnya tetap terisi (formulir sendiri menolak KONSI tanpa pemegang). */
  const keKonsi = (): StoreFields => ({
    code: `PJB-${token}`,
    name: `Toko Balap ${token}`,
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
    salesmanId: pemegangId,
  });

  it("toko yang menjadi KONSI tidak pernah berakhir tanpa pemegang, siapa pun yang lebih dulu", async () => {
    const jedaPindah = [0, 4, 0, 8, 2, 0];
    const jedaFormulir = [4, 0, 8, 0, 0, 2];
    for (let putaran = 0; putaran < jedaPindah.length; putaran += 1) {
      await prisma.store.update({ where: { id: seededId(tokoId) }, data: { termsType: "PUTUS", salesmanId: pemegangId } });

      const [pindah] = await Promise.all([
        tunda(jedaPindah[putaran]).then(() => pindahkanToko({ lingkup: { storeIds: [tokoId] }, keSalesmanId: null, olehUserId: adminId })),
        tunda(jedaFormulir[putaran]).then(() => updateStore(tokoId, keKonsi(), adminId)),
      ]);

      // Pengosongan lebih dulu (lalu formulir memasang pemegangnya lagi), atau ditolak karena sudah KONSI.
      expect([{ ok: true, jumlah: 1 }, { ok: false, alasan: "KONSI_WAJIB_PEMEGANG" }]).toContainEqual(pindah);
      const toko = await prisma.store.findUniqueOrThrow({ where: { id: seededId(tokoId) }, select: { termsType: true, salesmanId: true } });
      expect(toko).toEqual({ termsType: "KONSI", salesmanId: pemegangId });
    }
  }, 60_000);
});

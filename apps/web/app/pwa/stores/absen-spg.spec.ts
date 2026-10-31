import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { PENGATURAN_ABSENSI_BAWAAN, type PengaturanAbsensi } from "@/lib/salesman/absensi";

/*
 * Check-in / check-out SPG di toko tetapnya = absen masuk / pulang (bila
 * absensi menyala); salesman tidak. Pengaturan absensi dipalsukan — bukan
 * diubah di basis data bersama. Semua baris milik pengguna dan toko buatan
 * tes; teardown hanya lewat id yang diseed.
 */

let penggunaId = "";
let pengaturan: PengaturanAbsensi = { ...PENGATURAN_ABSENSI_BAWAAN, aktif: true };

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: penggunaId, email: "x@test.local", permissions: ["pwa:access"] } })),
}));
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return { ...actual, redirect: (url: string) => { throw new Error(`__REDIRECT__:${url}`); } };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/salesman/absensi-queries", async (asli) => ({
  ...(await asli<typeof import("@/lib/salesman/absensi-queries")>()),
  pengaturanAbsensiDb: async () => pengaturan,
}));

const { checkIn, checkOut } = await import("./actions");

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `ABSCK-${Math.random().toString(36).slice(2, 10)}`;

d("check-in SPG = absen (test bed only)", () => {
  let tokoId = "";
  let spgId = "";
  let salesId = "";

  beforeAll(async () => {
    tokoId = "";
    spgId = "";
    salesId = "";
    salesId = (await prisma.user.create({ data: { email: `${tag}-s@test.local`.toLowerCase(), name: `Sales ${tag}` } })).id;
    // Tanpa pin peta: check-in tidak pernah "di luar radius".
    tokoId = (
      await prisma.store.create({
        data: { code: `TST-${tag}`, name: `Toko ${tag}`, address: "x", termsType: "KONSI", salesmanId: salesId },
      })
    ).id;
    spgId = (
      await prisma.user.create({ data: { email: `${tag}-g@test.local`.toLowerCase(), name: `SPG ${tag}`, assignedStoreId: tokoId } })
    ).id;
  });

  afterEach(async () => {
    pengaturan = { ...PENGATURAN_ABSENSI_BAWAAN, aktif: true };
    await prisma.storeVisit.deleteMany({ where: { userId: { in: seededIds([spgId, salesId].filter(Boolean)) } } });
    await prisma.attendance.deleteMany({ where: { userId: { in: seededIds([spgId, salesId].filter(Boolean)) } } });
  });

  afterAll(async () => {
    await prisma.store.deleteMany({ where: { id: seededId(tokoId) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgId, salesId].filter(Boolean)) } } });
  });

  const masuk = async (userId: string) => {
    penggunaId = userId;
    await expect(checkIn({ storeId: tokoId, lat: -6.2, lng: 106.8, accuracy: 9 })).rejects.toThrow(
      `__REDIRECT__:/pwa/stores/${tokoId}`,
    );
  };
  const absen = (userId: string) => prisma.attendance.findMany({ where: { userId: seededId(userId) } });

  it("SPG: check-in mencatat absen masuk, check-out absen pulang, check-in ulang tidak menggandakan", async () => {
    await masuk(spgId);
    let a = await absen(spgId);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ clockInAccuracy: 9, selfieUrl: null, clockOutAt: null });

    // Check-in lagi di toko yang sama (kunjungan masih terbuka): tetap satu absen.
    await masuk(spgId);
    expect(await absen(spgId)).toHaveLength(1);

    const visit = await prisma.storeVisit.findFirstOrThrow({ where: { userId: spgId, checkoutAt: null } });
    expect(await checkOut({ visitId: visit.id, lat: -6.2, lng: 106.8 })).toEqual({ alreadyClosed: false, storeId: tokoId });
    a = await absen(spgId);
    expect(a).toHaveLength(1);
    expect(a[0].clockOutAt).not.toBeNull();
  });

  it("salesman: check-in tetap kunjungan biasa, bukan absen", async () => {
    await masuk(salesId);
    expect(await absen(salesId)).toHaveLength(0);
  });

  it("absensi mati: SPG check-in tanpa absen", async () => {
    pengaturan = { ...pengaturan, aktif: false };
    await masuk(spgId);
    expect(await absen(spgId)).toHaveLength(0);
    expect(await prisma.storeVisit.count({ where: { userId: spgId } })).toBe(1);
  });
});

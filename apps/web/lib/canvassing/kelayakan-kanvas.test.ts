import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { alasanBukanKanvas, periksaKanvas, petaBukanKanvas } from "./kelayakan-kanvas";

describe("alasanBukanKanvas (murni)", () => {
  const peran = (isSystem: boolean, punyaAksesHp: boolean) => ({ isSystem, punyaAksesHp });
  it("salesman ber-pwa:access tanpa toko tetap: boleh", () => {
    expect(alasanBukanKanvas({ assignedStoreId: null, roleDefinition: peran(false, true) })).toBeNull();
  });
  it("SPG (toko tetap) ditolak walau perannya punya pwa:access", () => {
    expect(alasanBukanKanvas({ assignedStoreId: "toko-1", roleDefinition: peran(false, true) })).toBe("SPG");
  });
  it("admin sistem ditolak", () => {
    expect(alasanBukanKanvas({ assignedStoreId: null, roleDefinition: peran(true, true) })).toBe("ADMIN_SISTEM");
  });
  it("tanpa pwa:access atau tanpa peran ditolak; pengguna tidak ada ditolak", () => {
    expect(alasanBukanKanvas({ assignedStoreId: null, roleDefinition: peran(false, false) })).toBe("TANPA_AKSES_HP");
    expect(alasanBukanKanvas({ assignedStoreId: null, roleDefinition: null })).toBe("TANPA_AKSES_HP");
    expect(alasanBukanKanvas(null)).toBe("TIDAK_ADA");
  });
});

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;
const tag = `KLK-${Math.random().toString(36).slice(2, 10)}`;

d("periksaKanvas / petaBukanKanvas (basis data, peran bawaan seed)", () => {
  let toko = "";
  const u: Record<string, string> = {};

  beforeAll(async () => {
    const peranId = async (name: string) => (await prisma.roleDefinition.findUniqueOrThrow({ where: { name } })).id;
    const [salesman, admin, spg] = await Promise.all([peranId("SALESMAN"), peranId("ADMIN"), peranId("SPG")]);
    toko = (await prisma.store.create({ data: { code: `${tag}-T`, name: `Toko ${tag}`, address: "x", termsType: "KONSI", isActive: true } })).id;
    const buat = async (k: string, data: { roleId?: string; assignedStoreId?: string }) => {
      u[k] = (await prisma.user.create({ data: { email: `${tag}-${k}@test.local`.toLowerCase(), name: `${k} ${tag}`, ...data } })).id;
    };
    await buat("sales", { roleId: salesman });
    await buat("admin", { roleId: admin });
    await buat("spg", { roleId: spg, assignedStoreId: toko });
    await buat("polos", {});
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: seededIds(Object.values(u)) } } });
    if (toko) await prisma.store.delete({ where: { id: seededId(toko) } });
  });

  it("satu per satu", async () => {
    expect(await periksaKanvas(u.sales)).toBeNull();
    expect(await periksaKanvas(u.spg)).toBe("SPG");
    expect(await periksaKanvas(u.admin)).toBe("ADMIN_SISTEM");
    expect(await periksaKanvas(u.polos)).toBe("TANPA_AKSES_HP");
    expect(await periksaKanvas(`${tag}-tidak-ada`)).toBe("TIDAK_ADA");
  });

  it("peta sekaligus: hanya yang ditolak masuk peta", async () => {
    const peta = await petaBukanKanvas([u.sales, u.spg, u.admin]);
    expect(peta.has(u.sales)).toBe(false);
    expect(peta.get(u.spg)).toBe("SPG");
    expect(peta.get(u.admin)).toBe("ADMIN_SISTEM");
  });
});

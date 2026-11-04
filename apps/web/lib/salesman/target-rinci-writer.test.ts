import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { ENTITAS_TARGET_SALES, JEJAK_TARGET_SALES, salinTargetBulanLalu, simpanTargetRinci } from "./target-rinci-writer";

/*
 * Penulis target rinci terhadap basis data uji: mengganti set, menyalin bulan
 * lalu, menolak acuan/sales asing, dan jejak AuditLog di transaksi yang sama.
 * Semua baris milik pengguna buatan tes; teardown hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const token = Math.random().toString(36).slice(2, 10);
const TAHUN = 2003 + Math.floor(Math.random() * 17);
const BULAN_LALU = `${TAHUN}-05`;
const BULAN = `${TAHUN}-06`;

d("target rinci — penulis (test bed only)", () => {
  let roleId = "";
  let salesA = "";
  let salesB = "";
  let adminId = "";
  let spgId = "";
  let uomId = "";
  let katA = "";
  let jadi = "";
  let jadiNonaktif = "";
  let bahan = "";

  const isiA = async (bulan: string) =>
    prisma.salesTarget.findMany({
      where: { salesmanId: seededId(salesA), month: bulan },
      select: { scope: true, refId: true, measure: true, value: true },
      orderBy: { scope: "asc" },
    });
  const jejak = () =>
    prisma.auditLog.findMany({
      where: { userId: seededId(adminId), action: JEJAK_TARGET_SALES },
      orderBy: { createdAt: "asc" },
    });

  beforeAll(async () => {
    roleId = "";
    salesA = "";
    salesB = "";
    adminId = "";
    spgId = "";
    uomId = "";
    katA = "";
    jadi = "";
    jadiNonaktif = "";
    bahan = "";

    const pwa = await prisma.permission.findUniqueOrThrow({ where: { code: "pwa:access" }, select: { id: true } });
    roleId = (
      await prisma.roleDefinition.create({
        data: { name: `TEST-TR-SALES-${token}`, permissions: { create: [{ permissionId: pwa.id }] } },
      })
    ).id;
    salesA = (await prisma.user.create({ data: { email: `trw-a-${token}@test.local`, name: "Sales A", roleId } })).id;
    salesB = (await prisma.user.create({ data: { email: `trw-b-${token}@test.local`, name: "Sales B", roleId } })).id;
    // Bukan sales: tanpa peran HP.
    adminId = (await prisma.user.create({ data: { email: `trw-admin-${token}@test.local`, name: "Admin TR" } })).id;
    // SPG: toko tetap (bukan relasi — tanpa kunci asing), tanpa peran HP pun tetap pemilik target.
    spgId = (
      await prisma.user.create({ data: { email: `trw-spg-${token}@test.local`, name: "SPG TR", assignedStoreId: `toko-${token}` } })
    ).id;

    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-TRW-${token}`, nameId: "t", nameEn: "t" } })).id;
    katA = (await prisma.itemCategory.create({ data: { code: `TRW-A-${token}`, name: "Kaos" } })).id;
    const barang = async (k: string, x: object) =>
      (
        await prisma.item.create({
          data: { sku: `TEST-TRW-${k}-${token}`, nameId: k, nameEn: k, type: "FINISHED_GOOD", uomId, ...x },
        })
      ).id;
    jadi = await barang("JADI", {});
    jadiNonaktif = await barang("MATI", { isActive: false });
    bahan = await barang("BAHAN", { type: "FABRIC" });
  });

  afterAll(async () => {
    await prisma.salesTarget.deleteMany({ where: { salesmanId: { in: seededIds([salesA, salesB, spgId].filter(Boolean)) } } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(adminId) } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([jadi, jadiNonaktif, bahan].filter(Boolean)) } } });
    await prisma.itemCategory.deleteMany({ where: { id: seededId(katA) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesA, salesB, adminId, spgId].filter(Boolean)) } } });
    await prisma.roleDefinition.deleteMany({ where: { id: seededId(roleId) } });
  });

  it("menyimpan, lalu mengganti seluruh set; sales lain tidak tersentuh; jejak membawa sebelum/sesudah", async () => {
    await prisma.salesTarget.create({
      data: { salesmanId: salesB, month: BULAN, scope: "BARANG", refId: jadi, measure: "PCS", value: 9, createdById: adminId },
    });

    const r1 = await simpanTargetRinci({
      salesmanId: salesA,
      bulan: BULAN,
      olehUserId: adminId,
      baris: [
        { scope: "KATEGORI", refId: katA, measure: "NILAI", value: 5_000_000 },
        { scope: "BARANG", refId: jadi, measure: "PCS", value: 120 },
      ],
    });
    expect(r1).toEqual({ ok: true, jumlah: 2, berubah: true });

    const r2 = await simpanTargetRinci({
      salesmanId: salesA,
      bulan: BULAN,
      olehUserId: adminId,
      baris: [{ scope: "BARANG", refId: jadi, measure: "NILAI", value: 750_000 }],
    });
    expect(r2).toEqual({ ok: true, jumlah: 1, berubah: true });
    const isi = await isiA(BULAN);
    expect(isi.map((b) => ({ ...b, value: Number(b.value) }))).toEqual([
      { scope: "BARANG", refId: jadi, measure: "NILAI", value: 750_000 },
    ]);
    expect(await prisma.salesTarget.count({ where: { salesmanId: salesB, month: BULAN } })).toBe(1);

    const j = await jejak();
    expect(j).toHaveLength(2);
    expect(j[1]).toMatchObject({
      entityType: ENTITAS_TARGET_SALES,
      entityId: `${salesA}:${BULAN}`,
      changes: {
        before: [
          { scope: "KATEGORI", refId: katA, measure: "NILAI", value: 5_000_000 },
          { scope: "BARANG", refId: jadi, measure: "PCS", value: 120 },
        ],
        after: [{ scope: "BARANG", refId: jadi, measure: "NILAI", value: 750_000 }],
      },
      metadata: { salesmanId: salesA, bulan: BULAN, sumber: "SIMPAN" },
    });
  });

  it("menyimpan set yang sama tidak menulis apa pun", async () => {
    const sebelum = (await jejak()).length;
    const r = await simpanTargetRinci({
      salesmanId: salesA,
      bulan: BULAN,
      olehUserId: adminId,
      baris: [{ scope: "BARANG", refId: jadi, measure: "NILAI", value: 750_000 }],
    });
    expect(r).toEqual({ ok: true, jumlah: 1, berubah: false });
    expect((await jejak()).length).toBe(sebelum);
  });

  it("menolak: bahan baku bukan barang jadi, acuan asing, bukan sales, bulan rusak — tanpa menulis", async () => {
    const sebelum = (await jejak()).length;
    const simpan = (x: Partial<Parameters<typeof simpanTargetRinci>[0]>) =>
      simpanTargetRinci({ salesmanId: salesA, bulan: BULAN, olehUserId: adminId, baris: [], ...x });

    expect(await simpan({ baris: [{ scope: "BARANG", refId: bahan, measure: "PCS", value: 1 }] })).toEqual({
      ok: false,
      kode: "ACUAN_TIDAK_DIKENAL",
      indeks: 0,
    });
    expect(await simpan({ baris: [{ scope: "KATEGORI", refId: jadi, measure: "PCS", value: 1 }] })).toEqual({
      ok: false,
      kode: "ACUAN_TIDAK_DIKENAL",
      indeks: 0,
    });
    expect(await simpan({ salesmanId: adminId })).toEqual({ ok: false, kode: "SALESMAN_TIDAK_DIKENAL" });
    expect(await simpan({ bulan: "2026-13" })).toEqual({ ok: false, kode: "BULAN_TIDAK_SAH" });
    expect((await isiA(BULAN)).length).toBe(1);
    expect((await jejak()).length).toBe(sebelum);
  });

  it("barang nonaktif yang sudah menjadi target tetap boleh disimpan ulang", async () => {
    const r = await simpanTargetRinci({
      salesmanId: salesA,
      bulan: BULAN_LALU,
      olehUserId: adminId,
      baris: [
        { scope: "KATEGORI", refId: katA, measure: "PCS", value: 300 },
        { scope: "BARANG", refId: jadi, measure: "PCS", value: 50 },
        { scope: "BARANG", refId: jadiNonaktif, measure: "NILAI", value: 1_000_000 },
      ],
    });
    expect(r).toEqual({ ok: true, jumlah: 3, berubah: true });
  });

  it("salin bulan lalu: bulan yang sudah berisi ditolak kecuali ditimpa; barang nonaktif tidak ikut", async () => {
    expect(await salinTargetBulanLalu({ salesmanId: salesA, bulan: BULAN, olehUserId: adminId })).toEqual({
      ok: false,
      kode: "SUDAH_ADA",
    });

    const r = await salinTargetBulanLalu({ salesmanId: salesA, bulan: BULAN, olehUserId: adminId, timpa: true });
    expect(r).toEqual({ ok: true, jumlah: 2, dibuang: 1 });
    const isi = await isiA(BULAN);
    expect(isi.map((b) => ({ ...b, value: Number(b.value) }))).toEqual([
      { scope: "BARANG", refId: jadi, measure: "PCS", value: 50 },
      { scope: "KATEGORI", refId: katA, measure: "PCS", value: 300 },
    ]);
    const terakhir = (await jejak()).at(-1);
    expect(terakhir?.metadata).toMatchObject({ sumber: "SALIN_BULAN_LALU", dariBulan: BULAN_LALU, dibuang: 1 });
  });

  it("salin dari bulan lalu yang kosong ditolak", async () => {
    expect(await salinTargetBulanLalu({ salesmanId: salesB, bulan: BULAN_LALU, olehUserId: adminId })).toEqual({
      ok: false,
      kode: "BULAN_LALU_KOSONG",
    });
  });

  it("daftar kosong menghapus semua target bulan itu, dengan jejak", async () => {
    const r = await simpanTargetRinci({ salesmanId: salesA, bulan: BULAN, olehUserId: adminId, baris: [] });
    expect(r).toEqual({ ok: true, jumlah: 0, berubah: true });
    expect(await isiA(BULAN)).toEqual([]);
    expect((await jejak()).at(-1)?.changes).toMatchObject({ after: [] });
  });

  it("SPG juga pemilik target: tersimpan atas namanya, dengan jejak", async () => {
    const r = await simpanTargetRinci({
      salesmanId: spgId,
      bulan: BULAN,
      olehUserId: adminId,
      baris: [{ scope: "KATEGORI", refId: katA, measure: "PCS", value: 40 }],
    });
    expect(r).toMatchObject({ ok: true, jumlah: 1 });
    expect(await prisma.salesTarget.count({ where: { salesmanId: seededId(spgId), month: BULAN } })).toBe(1);
    expect((await jejak()).at(-1)?.metadata).toMatchObject({ salesmanId: spgId, bulan: BULAN });
  });
});

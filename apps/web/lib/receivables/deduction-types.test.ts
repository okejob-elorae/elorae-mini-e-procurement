import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { daftarJenisPotongan, simpanJenisPotongan } from "./deduction-types";

/*
 * Jenis potongan "Materai" tanpa peran jurnal jatuh ke potongan penjualan
 * (uji akuntansi 2, temuan kecil). Jenis BARU yang dibuat tanpa menyebut
 * perannya mendapat peran bawaan dari namanya; peran yang disebut (termasuk
 * "otomatis" = null) dihormati; jenis yang sudah ada tidak diubah. Basis data
 * uji; jenis dan pengguna milik tes sendiri.
 */
const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("jenis potongan: peran bawaan materai (test bed only)", () => {
  const tag = `UJDT-${Math.random().toString(36).slice(2, 8)}`;
  let userId = "";
  const ids: string[] = [];

  beforeAll(async () => {
    userId = "";
    userId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}@uji.local`, name: tag } })).id;
  });

  afterAll(async () => {
    if (ids.length) {
      await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(ids) } } });
      await prisma.deductionType.deleteMany({ where: { id: { in: seededIds(ids) } } });
    }
    if (userId) await prisma.user.delete({ where: { id: seededId(userId) } });
  });

  const dasar = { cara: "NOMINAL" as const, bolehManual: true, hanyaPkp: false, wajibCatatan: false, aktif: true };

  it("baru tanpa peran → materai menjadi biaya bank & administrasi; jenis lain tetap otomatis; null yang dipilih dihormati; tampil di master", async () => {
    const materai = await simpanJenisPotongan({ ...dasar, nama: `Materai ${tag}`, olehUserId: userId });
    const promo = await simpanJenisPotongan({ ...dasar, nama: `Promo ${tag}`, olehUserId: userId });
    const otomatis = await simpanJenisPotongan({ ...dasar, nama: `Meterai otomatis ${tag}`, peranJurnal: null, olehUserId: userId });
    for (const r of [materai, promo, otomatis]) {
      expect(r.ok).toBe(true);
      if (r.ok) ids.push(r.id);
    }
    const peran = async (id: string) => (await prisma.deductionType.findUniqueOrThrow({ where: { id }, select: { postingRole: true } })).postingRole;
    expect(await peran(ids[0])).toBe("BANK_CHARGES");
    expect(await peran(ids[1])).toBeNull();
    expect(await peran(ids[2])).toBeNull();

    // Mengubah jenis yang sudah ada tanpa menyebut perannya tidak menyentuh perannya.
    expect(await simpanJenisPotongan({ ...dasar, id: ids[2], nama: `Meterai otomatis ${tag} (ubah)`, olehUserId: userId })).toEqual({ ok: true, id: ids[2] });
    expect(await peran(ids[2])).toBeNull();

    const master = (await daftarJenisPotongan()).filter((b) => ids.includes(b.id));
    expect(master.find((b) => b.id === ids[0])?.peranJurnal).toBe("BANK_CHARGES");
  });
});

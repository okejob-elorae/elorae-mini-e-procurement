import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/**
 * `assignUserRole` terhadap basis data sungguhan (sesi ditiru).
 *
 * Dulu pemegang `settings_security:manage` mana pun bisa memberi peran sistem
 * (izin penuh `*`) ke siapa saja — termasuk dirinya — atau mencabutnya dari
 * admin, tanpa jejak. Kini hanya admin sistem yang boleh memberi/mencabut
 * peran sistem (peran pelaku dibaca dari basis data, bukan dari JWT), peran
 * sendiri tidak bisa diganti, dan setiap pergantian menulis `AuditLog` di
 * transaksi yang sama. Tes balapan membuktikan pemeriksaan itu dibaca di dalam
 * transaksi serializable: admin bukan-sistem tidak bisa menimpa pengangkatan
 * yang di-commit admin sistem di antara baca dan tulisnya.
 */

type SesiUji = { user: { id: string; email: null; permissions: string[] } };
const sesi = vi.hoisted(() => ({ antrean: [] as SesiUji[], bawaan: null as SesiUji | null }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sesi.antrean.shift() ?? sesi.bawaan) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { assignUserRole } = await import("./rbac");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `RBAC-${Math.random().toString(36).slice(2, 8)}`;
const tagEmail = tag.toLowerCase();

d("assignUserRole — peran sistem (test bed only)", () => {
  let peranBiasa = "";
  let peranLain = "";
  let peranSistem = "";
  let peranSistemDibuat = false;
  let pelakuBiasa = "";
  let pelakuSistem = "";
  let targetBiasa = "";
  let targetSistem = "";

  const pengguna = () => seededIds([pelakuBiasa, pelakuSistem, targetBiasa, targetSistem].filter(Boolean));
  const sebagai = (id: string, permissions: string[]): SesiUji => ({ user: { id, email: null, permissions } });
  const masuk = (id: string, permissions = ["settings_security:manage"]) => {
    sesi.bawaan = sebagai(id, permissions);
  };
  const peranDari = async (id: string) =>
    (await prisma.user.findUnique({ where: { id: seededId(id) }, select: { roleId: true } }))?.roleId;
  const jejak = (id: string) =>
    prisma.auditLog.findMany({
      where: { entityType: "User", entityId: seededId(id), action: "USER_UPDATED" },
      select: { userId: true, changes: true },
    });

  beforeAll(async () => {
    peranBiasa = "";
    peranLain = "";
    peranSistem = "";
    pelakuBiasa = "";
    pelakuSistem = "";
    targetBiasa = "";
    targetSistem = "";
    peranBiasa = (await prisma.roleDefinition.create({ data: { name: `${tag}-BIASA`, isSystem: false } })).id;
    peranLain = (await prisma.roleDefinition.create({ data: { name: `${tag}-LAIN`, isSystem: false } })).id;
    const ada = await prisma.roleDefinition.findFirst({ where: { isSystem: true }, select: { id: true } });
    if (ada) {
      peranSistem = ada.id;
    } else {
      peranSistem = (await prisma.roleDefinition.create({ data: { name: `${tag}-SISTEM`, isSystem: true } })).id;
      peranSistemDibuat = true;
    }
    pelakuBiasa = (await prisma.user.create({ data: { email: `${tagEmail}-pb@uji.local`, name: `${tag} PB`, roleId: peranBiasa } })).id;
    pelakuSistem = (await prisma.user.create({ data: { email: `${tagEmail}-ps@uji.local`, name: `${tag} PS`, roleId: peranSistem } })).id;
    targetBiasa = (await prisma.user.create({ data: { email: `${tagEmail}-tb@uji.local`, name: `${tag} TB`, roleId: peranBiasa } })).id;
    targetSistem = (await prisma.user.create({ data: { email: `${tagEmail}-ts@uji.local`, name: `${tag} TS`, roleId: peranSistem } })).id;
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: { in: pengguna() } } });
    await prisma.user.update({ where: { id: seededId(targetBiasa) }, data: { roleId: peranBiasa } });
    await prisma.user.update({ where: { id: seededId(targetSistem) }, data: { roleId: peranSistem } });
    await prisma.user.update({ where: { id: seededId(pelakuBiasa) }, data: { roleId: peranBiasa } });
    sesi.antrean = [];
    masuk(pelakuBiasa);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: { in: pengguna() } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: pengguna() } } });
    await prisma.user.deleteMany({ where: { id: { in: pengguna() } } });
    await prisma.roleDefinition.deleteMany({ where: { id: { in: seededIds([peranBiasa, peranLain].filter(Boolean)) } } });
    if (peranSistemDibuat) await prisma.roleDefinition.deleteMany({ where: { id: seededId(peranSistem) } });
  });

  it("tanpa settings_security:manage ditolak", async () => {
    masuk(pelakuBiasa, ["settings_security:view"]);
    await expect(assignUserRole(targetBiasa, peranLain)).rejects.toThrow(/Forbidden/);
    expect(await peranDari(targetBiasa)).toBe(peranBiasa);
  });

  it("admin bukan-sistem tidak bisa memberi peran sistem", async () => {
    expect(await assignUserRole(targetBiasa, peranSistem)).toEqual({ ok: false, code: "PERAN_SISTEM" });
    expect(await peranDari(targetBiasa)).toBe(peranBiasa);
    expect(await jejak(targetBiasa)).toEqual([]);
  });

  it("admin bukan-sistem tidak bisa mencabut peran sistem dari admin", async () => {
    expect(await assignUserRole(targetSistem, peranBiasa)).toEqual({ ok: false, code: "AKUN_SISTEM" });
    expect(await peranDari(targetSistem)).toBe(peranSistem);
  });

  it("JWT basi yang masih membawa '*' tidak menolong: peran pelaku dibaca dari basis data", async () => {
    masuk(pelakuBiasa, ["*"]);
    expect(await assignUserRole(targetBiasa, peranSistem)).toEqual({ ok: false, code: "PERAN_SISTEM" });
    expect(await peranDari(targetBiasa)).toBe(peranBiasa);
  });

  it("tidak bisa mengganti peran sendiri", async () => {
    expect(await assignUserRole(pelakuBiasa, peranLain)).toEqual({ ok: false, code: "PERAN_SENDIRI" });
    expect(await peranDari(pelakuBiasa)).toBe(peranBiasa);
  });

  it("admin bukan-sistem mengganti peran biasa → berhasil dan berjejak sebelum/sesudah", async () => {
    expect(await assignUserRole(targetBiasa, peranLain)).toEqual({ ok: true });
    expect(await peranDari(targetBiasa)).toBe(peranLain);
    const baris = await jejak(targetBiasa);
    expect(baris).toHaveLength(1);
    expect(baris[0].userId).toBe(pelakuBiasa);
    expect(baris[0].changes).toEqual({ before: { roleId: peranBiasa }, after: { roleId: peranLain } });
  });

  it("admin sistem boleh memberi dan mencabut peran sistem, masing-masing berjejak", async () => {
    masuk(pelakuSistem, ["*"]);
    expect(await assignUserRole(targetBiasa, peranSistem)).toEqual({ ok: true });
    expect(await assignUserRole(targetSistem, peranBiasa)).toEqual({ ok: true });
    expect(await peranDari(targetBiasa)).toBe(peranSistem);
    expect(await peranDari(targetSistem)).toBe(peranBiasa);
    expect(await jejak(targetBiasa)).toHaveLength(1);
    expect(await jejak(targetSistem)).toHaveLength(1);
  });

  it("peran yang sama tidak menulis apa pun", async () => {
    expect(await assignUserRole(targetBiasa, peranBiasa)).toEqual({ ok: true });
    expect(await jejak(targetBiasa)).toEqual([]);
  });

  it("pengguna atau peran yang tidak ada → kode, bukan lemparan", async () => {
    expect(await assignUserRole(`${tag}-tidak-ada`, peranLain)).toEqual({ ok: false, code: "TIDAK_DITEMUKAN" });
    expect(await assignUserRole(targetBiasa, `${tag}-tidak-ada`)).toEqual({ ok: false, code: "PERAN_TIDAK_DITEMUKAN" });
  });

  it("balapan: admin bukan-sistem tidak pernah menimpa pengangkatan oleh admin sistem", async () => {
    for (let putaran = 0; putaran < 6; putaran++) {
      await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: seededId(targetBiasa) } });
      await prisma.user.update({ where: { id: seededId(targetBiasa) }, data: { roleId: peranBiasa } });
      // Urutan pemanggilan bergantian, supaya kedua urutan commit ikut teruji.
      const pasangan = [
        { sesi: sebagai(pelakuBiasa, ["settings_security:manage"]), peran: peranLain },
        { sesi: sebagai(pelakuSistem, ["*"]), peran: peranSistem },
      ];
      if (putaran % 2) pasangan.reverse();
      sesi.antrean = pasangan.map((p) => p.sesi);
      const hasil = await Promise.all(pasangan.map((p) => assignUserRole(targetBiasa, p.peran)));

      const hasilSistem = hasil[pasangan.findIndex((p) => p.peran === peranSistem)];
      expect(hasilSistem).toEqual({ ok: true });
      // Urutan serial yang sah: biasa→sistem (keduanya berhasil) atau
      // sistem→biasa (yang biasa ditolak AKUN_SISTEM). Akhirnya selalu sistem.
      expect(await peranDari(targetBiasa)).toBe(peranSistem);
      const berhasil = hasil.filter((h) => h.ok).length;
      expect(await jejak(targetBiasa)).toHaveLength(berhasil);
    }
  }, 60_000);
});

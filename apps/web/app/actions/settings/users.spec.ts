import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { prisma, seededId, seededIds } from "@elorae/db";

/**
 * Pengaturan → Pengguna terhadap basis data sungguhan (sesi ditiru).
 *
 * Yang dibuktikan: pemegang `settings_security:manage` yang BUKAN admin sistem
 * tidak bisa membuat akun berperan sistem, tidak bisa memberi peran sistem,
 * dan tidak bisa mengubah akun berperan sistem sama sekali (termasuk sandinya)
 * — juga bila JWT-nya masih membawa '*' dari sebelum perannya diturunkan,
 * karena peran pelaku dibaca dari basis data. Admin sistem tetap boleh.
 */

const sesi = vi.hoisted(() => ({ id: "", permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: sesi.id, permissions: sesi.permissions } })) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { simpanPenggunaAction } = await import("./users");

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `USR-${Math.random().toString(36).slice(2, 8)}`;
// Aksi menyimpan email huruf kecil; email uji ditulis huruf kecil supaya teardown menemukannya.
const tagEmail = tag.toLowerCase();
const SANDI = "sandi-kuat-123";

d("simpanPenggunaAction — akun sistem (test bed only)", () => {
  let peranBiasa = "";
  let peranSistem = "";
  let peranSistemDibuat = false;
  let pelakuBiasa = "";
  let pelakuSistem = "";
  let targetBiasa = "";
  let targetSistem = "";
  const hashAwal: Record<string, string> = {};
  const emailBaru = [`${tagEmail}-baru1@uji.local`, `${tagEmail}-baru2@uji.local`, `${tagEmail}-baru3@uji.local`];

  const seeded = () => seededIds([pelakuBiasa, pelakuSistem, targetBiasa, targetSistem].filter(Boolean));
  const masukSebagai = (id: string, permissions: string[]) => {
    sesi.id = id;
    sesi.permissions = permissions;
  };
  const baca = (id: string) =>
    prisma.user.findUnique({ where: { id: seededId(id) }, select: { name: true, roleId: true, passwordHash: true } });
  const isian = (o: Partial<{ id: string | null; nama: string; email: string; roleId: string; sandi: string; ulangSandi: string }>) => ({
    id: null,
    nama: `${tag} Nama`,
    email: emailBaru[0],
    roleId: peranBiasa,
    tokoId: null,
    sandi: "",
    ulangSandi: "",
    ...o,
  });

  beforeAll(async () => {
    peranBiasa = "";
    peranSistem = "";
    pelakuBiasa = "";
    pelakuSistem = "";
    targetBiasa = "";
    targetSistem = "";
    peranBiasa = (await prisma.roleDefinition.create({ data: { name: `${tag}-BIASA`, isSystem: false } })).id;
    const ada = await prisma.roleDefinition.findFirst({ where: { isSystem: true }, select: { id: true } });
    if (ada) {
      peranSistem = ada.id;
    } else {
      peranSistem = (await prisma.roleDefinition.create({ data: { name: `${tag}-SISTEM`, isSystem: true } })).id;
      peranSistemDibuat = true;
    }
    hashAwal.biasa = await bcrypt.hash("awal-biasa-1", 4);
    hashAwal.sistem = await bcrypt.hash("awal-sistem-1", 4);
    pelakuBiasa = (await prisma.user.create({ data: { email: `${tagEmail}-pb@uji.local`, name: `${tag} PB`, roleId: peranBiasa } })).id;
    pelakuSistem = (await prisma.user.create({ data: { email: `${tagEmail}-ps@uji.local`, name: `${tag} PS`, roleId: peranSistem } })).id;
    targetBiasa = (
      await prisma.user.create({ data: { email: `${tagEmail}-tb@uji.local`, name: `${tag} TB`, roleId: peranBiasa, passwordHash: hashAwal.biasa } })
    ).id;
    targetSistem = (
      await prisma.user.create({ data: { email: `${tagEmail}-ts@uji.local`, name: `${tag} TS`, roleId: peranSistem, passwordHash: hashAwal.sistem } })
    ).id;
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: { in: seeded() } } });
    await prisma.user.deleteMany({ where: { email: { in: seededIds(emailBaru) } } });
    await prisma.user.update({ where: { id: seededId(targetBiasa) }, data: { name: `${tag} TB`, roleId: peranBiasa, passwordHash: hashAwal.biasa } });
    await prisma.user.update({ where: { id: seededId(targetSistem) }, data: { name: `${tag} TS`, roleId: peranSistem, passwordHash: hashAwal.sistem } });
    masukSebagai(pelakuBiasa, ["settings_security:manage"]);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: { in: seeded() } } });
    await prisma.user.deleteMany({ where: { email: { in: seededIds(emailBaru) } } });
    // Jaring kedua: akun apa pun yang masih memakai peran uji akan menahan hapus perannya.
    await prisma.user.deleteMany({ where: { roleId: seededId(peranBiasa) } });
    await prisma.user.deleteMany({ where: { id: { in: seeded() } } });
    await prisma.roleDefinition.deleteMany({ where: { id: seededId(peranBiasa) } });
    if (peranSistemDibuat) await prisma.roleDefinition.deleteMany({ where: { id: seededId(peranSistem) } });
  });

  it("tanpa settings_security:manage ditolak", async () => {
    masukSebagai(pelakuBiasa, ["settings_security:view"]);
    expect(await simpanPenggunaAction(isian({ sandi: SANDI, ulangSandi: SANDI }))).toEqual({ ok: false, codes: ["FORBIDDEN"] });
    expect(await prisma.user.count({ where: { email: { in: emailBaru } } })).toBe(0);
  });

  it("admin bukan-sistem tidak bisa membuat akun berperan sistem", async () => {
    expect(await simpanPenggunaAction(isian({ roleId: peranSistem, sandi: SANDI, ulangSandi: SANDI }))).toEqual({
      ok: false,
      codes: ["PERAN_SISTEM"],
    });
    expect(await prisma.user.count({ where: { email: { in: emailBaru } } })).toBe(0);
  });

  it("admin bukan-sistem tidak bisa memberi peran sistem ke akun biasa", async () => {
    expect(
      await simpanPenggunaAction(isian({ id: targetBiasa, email: `${tagEmail}-tb@uji.local`, nama: `${tag} TB`, roleId: peranSistem })),
    ).toEqual({ ok: false, codes: ["PERAN_SISTEM"] });
    expect((await baca(targetBiasa))?.roleId).toBe(peranBiasa);
  });

  it("admin bukan-sistem tidak bisa mengubah akun berperan sistem: nama, peran, maupun sandinya", async () => {
    const ubah = (o: Parameters<typeof isian>[0]) =>
      simpanPenggunaAction(isian({ id: targetSistem, email: `${tagEmail}-ts@uji.local`, nama: `${tag} TS`, roleId: peranSistem, ...o }));
    expect(await ubah({ nama: `${tag} Diganti` })).toEqual({ ok: false, codes: ["AKUN_SISTEM"] });
    expect(await ubah({ roleId: peranBiasa })).toEqual({ ok: false, codes: ["AKUN_SISTEM"] });
    expect(await ubah({ sandi: SANDI, ulangSandi: SANDI })).toEqual({ ok: false, codes: ["AKUN_SISTEM"] });
    const t = await baca(targetSistem);
    expect(t).toEqual({ name: `${tag} TS`, roleId: peranSistem, passwordHash: hashAwal.sistem });
  });

  it("JWT '*' basi dari peran yang sudah diturunkan tidak cukup — peran pelaku dibaca dari basis data", async () => {
    masukSebagai(pelakuBiasa, ["*"]);
    expect(
      await simpanPenggunaAction(isian({ id: targetSistem, email: `${tagEmail}-ts@uji.local`, nama: `${tag} TS`, roleId: peranSistem, sandi: SANDI, ulangSandi: SANDI })),
    ).toEqual({ ok: false, codes: ["AKUN_SISTEM"] });
    expect(await simpanPenggunaAction(isian({ roleId: peranSistem, sandi: SANDI, ulangSandi: SANDI }))).toEqual({
      ok: false,
      codes: ["PERAN_SISTEM"],
    });
    expect((await baca(targetSistem))?.passwordHash).toBe(hashAwal.sistem);
  });

  it("admin bukan-sistem tetap boleh membuat dan mengubah akun biasa", async () => {
    const dibuat = await simpanPenggunaAction(isian({ sandi: SANDI, ulangSandi: SANDI }));
    expect(dibuat).toMatchObject({ ok: true });
    expect(await prisma.user.count({ where: { email: emailBaru[0], roleId: peranBiasa } })).toBe(1);

    expect(
      await simpanPenggunaAction(
        isian({ id: targetBiasa, email: `${tagEmail}-tb@uji.local`, nama: `${tag} TB Baru`, sandi: SANDI, ulangSandi: SANDI }),
      ),
    ).toEqual({ ok: true, id: targetBiasa });
    const t = await baca(targetBiasa);
    expect(t?.name).toBe(`${tag} TB Baru`);
    expect(await bcrypt.compare(SANDI, t?.passwordHash ?? "")).toBe(true);
  });

  it("balapan: pengangkatan oleh admin sistem tidak tertimpa ubahan admin bukan-sistem yang membaca sebelumnya", async () => {
    for (let putaran = 0; putaran < 3; putaran++) {
      await prisma.user.update({ where: { id: seededId(targetBiasa) }, data: { roleId: peranBiasa, passwordHash: hashAwal.biasa } });
      // `auth()` dibaca saat aksi dipanggil, jadi sesi bisa diganti di antara dua panggilan.
      masukSebagai(pelakuSistem, ["*"]);
      const angkat = simpanPenggunaAction(isian({ id: targetBiasa, email: `${tagEmail}-tb@uji.local`, nama: `${tag} TB`, roleId: peranSistem }));
      masukSebagai(pelakuBiasa, ["settings_security:manage"]);
      const ganti = simpanPenggunaAction(
        isian({ id: targetBiasa, email: `${tagEmail}-tb@uji.local`, nama: `${tag} TB`, roleId: peranBiasa, sandi: SANDI, ulangSandi: SANDI }),
      );
      const [hasilAngkat, hasilGanti] = await Promise.all([angkat, ganti]);
      expect(hasilAngkat).toEqual({ ok: true, id: targetBiasa });
      const t = await baca(targetBiasa);
      // Urutan seri mana pun berakhir dengan akun sistem; yang ditolak tidak meninggalkan sandinya.
      expect(t?.roleId).toBe(peranSistem);
      if (!hasilGanti.ok) {
        expect(hasilGanti.codes).toEqual(["AKUN_SISTEM"]);
        expect(t?.passwordHash).toBe(hashAwal.biasa);
      }
    }
  });

  it("admin sistem boleh membuat akun sistem dan mengganti sandi akun sistem", async () => {
    masukSebagai(pelakuSistem, ["*"]);
    expect(await simpanPenggunaAction(isian({ email: emailBaru[1], roleId: peranSistem, sandi: SANDI, ulangSandi: SANDI }))).toMatchObject({
      ok: true,
    });
    expect(await prisma.user.count({ where: { email: emailBaru[1], roleId: peranSistem } })).toBe(1);

    expect(
      await simpanPenggunaAction(
        isian({ id: targetSistem, email: `${tagEmail}-ts@uji.local`, nama: `${tag} TS`, roleId: peranSistem, sandi: SANDI, ulangSandi: SANDI }),
      ),
    ).toEqual({ ok: true, id: targetSistem });
    expect(await bcrypt.compare(SANDI, (await baca(targetSistem))?.passwordHash ?? "")).toBe(true);
  });
});

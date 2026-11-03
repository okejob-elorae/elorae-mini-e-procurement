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
 *
 * Juga: kolom peran lama (`User.role`) ditulis bersama `roleId` di transaksi
 * yang sama dan ikut jejak sebagai `legacyRole`. Dulu Pengguna tidak mengisinya,
 * jadi admin yang diangkat di sini tetap USER di kolom itu (Peran & izin dan tab
 * HPP tertutup baginya) dan admin yang diturunkan tetap ADMIN.
 */

const sesi = vi.hoisted(() => ({ id: "", permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: sesi.id, permissions: sesi.permissions } })) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { simpanPenggunaAction } = await import("./users");
const { aturMulaiSpgAction } = await import("./spg-berhenti");

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
  const kolomLama = async (where: { id: string } | { email: string }) =>
    (
      await prisma.user.findUnique({
        where: "id" in where ? { id: seededId(where.id) } : { email: seededId(where.email) },
        select: { role: true },
      })
    )?.role;
  const jejak = (id: string, action: string) =>
    prisma.auditLog.findMany({ where: { entityType: "User", entityId: seededId(id), action }, select: { changes: true } });
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
    await prisma.user.update({
      where: { id: seededId(targetBiasa) },
      data: { name: `${tag} TB`, role: "USER", roleId: peranBiasa, passwordHash: hashAwal.biasa },
    });
    await prisma.user.update({
      where: { id: seededId(targetSistem) },
      data: { name: `${tag} TS`, role: "ADMIN", roleId: peranSistem, passwordHash: hashAwal.sistem },
    });
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
      await prisma.user.update({ where: { id: seededId(targetBiasa) }, data: { role: "USER", roleId: peranBiasa, passwordHash: hashAwal.biasa } });
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
      // Peran lama ditulis di transaksi yang sama, jadi ikut pemenang balapan.
      expect(await kolomLama({ id: targetBiasa })).toBe("ADMIN");
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

  it("peran lama mengikuti peran baru: diangkat → ADMIN, diturunkan → USER, akun baru sejak dibuat — semuanya berjejak", async () => {
    masukSebagai(pelakuSistem, ["*"]);
    expect(await simpanPenggunaAction(isian({ id: targetBiasa, email: `${tagEmail}-tb@uji.local`, nama: `${tag} TB`, roleId: peranSistem }))).toEqual({
      ok: true,
      id: targetBiasa,
    });
    expect(await kolomLama({ id: targetBiasa })).toBe("ADMIN");
    expect((await jejak(targetBiasa, "USER_UPDATED"))[0].changes).toMatchObject({
      before: { roleId: peranBiasa, legacyRole: "USER" },
      after: { roleId: peranSistem, legacyRole: "ADMIN" },
    });

    expect(await simpanPenggunaAction(isian({ id: targetSistem, email: `${tagEmail}-ts@uji.local`, nama: `${tag} TS`, roleId: peranBiasa }))).toEqual({
      ok: true,
      id: targetSistem,
    });
    expect(await kolomLama({ id: targetSistem })).toBe("USER");
    expect((await jejak(targetSistem, "USER_UPDATED"))[0].changes).toMatchObject({
      before: { roleId: peranSistem, legacyRole: "ADMIN" },
      after: { roleId: peranBiasa, legacyRole: "USER" },
    });

    const dibuat = await simpanPenggunaAction(isian({ email: emailBaru[2], roleId: peranSistem, sandi: SANDI, ulangSandi: SANDI }));
    expect(dibuat).toMatchObject({ ok: true });
    expect(await kolomLama({ email: emailBaru[2] })).toBe("ADMIN");
    if (dibuat.ok) {
      expect((await jejak(dibuat.id, "USER_CREATED"))[0].changes).toMatchObject({ after: { legacyRole: "ADMIN" } });
    }
  });

  it("menyimpan akun tanpa mengganti perannya membetulkan peran lama yang basi", async () => {
    // Keadaan sebelum perbaikan ini: diangkat lewat Pengguna, kolom lama tertinggal USER.
    await prisma.user.update({ where: { id: seededId(targetSistem) }, data: { role: "USER" } });
    masukSebagai(pelakuSistem, ["*"]);
    expect(
      await simpanPenggunaAction(isian({ id: targetSistem, email: `${tagEmail}-ts@uji.local`, nama: `${tag} TS`, roleId: peranSistem })),
    ).toEqual({ ok: true, id: targetSistem });
    expect(await kolomLama({ id: targetSistem })).toBe("ADMIN");
  });
});

/**
 * SPG di formulir Pengguna (keputusan pemilik 2026-11-02, P62/P66; fakta "SPG tidak mungkin pindah
 * toko"): SPG yang sudah punya riwayat tidak dipindah toko atau diganti perannya di sini, dan SPG
 * yang sudah berhenti tidak wajib punya toko tetap — tokonya hanya kembali lewat "Batalkan berhenti".
 *
 * Tanggal mulai bekerja (P62, perbaikan peserta gaji B20) WAJIB dibawa setiap kali formulir ini
 * menyimpan peran SPG dengan toko tetap untuk akun yang belum punya tanggal itu — tanpa tanggal, SPG
 * baru yang belum punya jadwal, penjualan, atau catatan hadir tidak masuk peserta gaji mana pun.
 * Aturannya satu: akun baru diperiksa `periksaMulaiSpg` (belum mungkin punya kegiatan atau gaji),
 * akun lama lewat penulisnya sendiri (`aturMulaiSpgDalamTx`) di transaksi yang sama — ditolak berarti
 * seluruh penyimpanan batal. Tanggal yang sudah tersimpan tidak pernah ditimpa dari sini; mengubahnya
 * tetap lewat "Atur tanggal mulai" (`aturMulaiSpgAction`).
 */
const tagSpg = `USS-${Math.random().toString(36).slice(2, 8)}`;
const tagSpgEmail = tagSpg.toLowerCase();

d("simpanPenggunaAction — SPG (test bed only)", () => {
  let izinDibuat = "";
  let peranSpg = "";
  let peranBiasa = "";
  let pelaku = "";
  let spg = "";
  let tokoA = "";
  let tokoB = "";
  const emailBaru = `${tagSpgEmail}-baru@uji.local`;
  const emailSpg = `${tagSpgEmail}-spg@uji.local`;

  const seeded = () => seededIds([pelaku, spg].filter(Boolean));
  const isian = (o: Record<string, unknown>) => ({
    id: spg,
    nama: `${tagSpg} SPG`,
    email: emailSpg,
    roleId: peranSpg,
    tokoId: tokoA,
    sandi: "",
    ulangSandi: "",
    ...o,
  });
  const baca = () =>
    prisma.user.findUniqueOrThrow({
      where: { id: seededId(spg) },
      select: { roleId: true, assignedStoreId: true, spgStartedOn: true },
    });

  beforeAll(async () => {
    izinDibuat = "";
    peranSpg = "";
    peranBiasa = "";
    pelaku = "";
    spg = "";
    tokoA = "";
    tokoB = "";
    let izin = await prisma.permission.findUnique({ where: { code: "spg_sales:record" }, select: { id: true } });
    if (!izin) {
      izin = await prisma.permission.create({ data: { code: "spg_sales:record", module: "spg_sales", action: "record" }, select: { id: true } });
      izinDibuat = izin.id;
    }
    peranSpg = (
      await prisma.roleDefinition.create({
        data: { name: `${tagSpg}-SPG`, isSystem: false, permissions: { create: [{ permissionId: izin.id }] } },
      })
    ).id;
    peranBiasa = (await prisma.roleDefinition.create({ data: { name: `${tagSpg}-BIASA`, isSystem: false } })).id;
    const toko = async (akhiran: string) =>
      (await prisma.store.create({ data: { code: `${tagSpg}-${akhiran}`, name: `${tagSpg} ${akhiran}`, address: "uji", termsType: "KONSI" } })).id;
    tokoA = await toko("A");
    tokoB = await toko("B");
    pelaku = (await prisma.user.create({ data: { email: `${tagSpgEmail}-p@uji.local`, name: `${tagSpg} P`, roleId: peranBiasa } })).id;
    spg = (await prisma.user.create({ data: { email: emailSpg, name: `${tagSpg} SPG`, roleId: peranSpg, assignedStoreId: tokoA } })).id;
  });

  beforeEach(async () => {
    await prisma.storeVisit.deleteMany({ where: { userId: seededId(spg) } });
    await prisma.spgCommission.deleteMany({ where: { userId: seededId(spg) } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: seeded() } } });
    await prisma.user.deleteMany({ where: { email: seededId(emailBaru) } });
    await prisma.user.update({
      where: { id: seededId(spg) },
      data: { name: `${tagSpg} SPG`, roleId: peranSpg, assignedStoreId: tokoA, spgStartedOn: "2026-10-01", spgEndedOn: null, spgEndedStoreId: null },
    });
    sesi.id = pelaku;
    sesi.permissions = ["settings_security:manage"];
  });

  afterAll(async () => {
    await prisma.storeVisit.deleteMany({ where: { userId: seededId(spg) } });
    await prisma.spgCommission.deleteMany({ where: { userId: seededId(spg) } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: seeded() } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: seeded() } } });
    await prisma.user.deleteMany({ where: { email: seededId(emailBaru) } });
    await prisma.user.deleteMany({ where: { id: { in: seeded() } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: seededId(peranSpg) } });
    await prisma.roleDefinition.deleteMany({ where: { id: { in: seededIds([peranSpg, peranBiasa].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoA, tokoB].filter(Boolean)) } } });
    if (izinDibuat) await prisma.permission.delete({ where: { id: izinDibuat } });
  });

  const adaKunjungan = (checkinAt: Date) =>
    prisma.storeVisit.create({ data: { storeId: tokoA, userId: spg, checkinAt, checkinLat: 0, checkinLng: 0 } });

  const bacaNama = () =>
    prisma.user.findUniqueOrThrow({ where: { id: seededId(spg) }, select: { name: true, spgStartedOn: true } });
  const jejakUbah = () =>
    prisma.auditLog.findMany({ where: { entityId: seededId(spg), action: "USER_UPDATED" }, select: { changes: true } });

  it("akun SPG baru dengan toko tetap wajib membawa tanggal mulai; tanggalnya ditulis saat akun dibuat dan masuk jejak", async () => {
    const dasar = { id: null, email: emailBaru, nama: `${tagSpg} Baru`, sandi: SANDI, ulangSandi: SANDI };
    expect(await simpanPenggunaAction(isian(dasar))).toEqual({ ok: false, codes: ["MULAI_WAJIB"] });
    expect(await simpanPenggunaAction(isian({ ...dasar, mulai: "" }))).toEqual({ ok: false, codes: ["MULAI_WAJIB"] });
    expect(await simpanPenggunaAction(isian({ ...dasar, mulai: "2026-02-30" }))).toEqual({ ok: false, codes: ["MULAI_TIDAK_SAH"] });
    expect(await prisma.user.count({ where: { email: seededId(emailBaru) } })).toBe(0);

    const dibuat = await simpanPenggunaAction(isian({ ...dasar, mulai: "2026-11-01" }));
    expect(dibuat).toMatchObject({ ok: true });
    const u = await prisma.user.findUniqueOrThrow({
      where: { email: seededId(emailBaru) },
      select: { id: true, assignedStoreId: true, spgStartedOn: true },
    });
    expect(u).toMatchObject({ assignedStoreId: tokoA, spgStartedOn: "2026-11-01" });
    const jejak = await prisma.auditLog.findMany({ where: { entityId: seededId(u.id), action: "USER_CREATED" }, select: { changes: true } });
    expect(jejak).toHaveLength(1);
    expect(jejak[0].changes).toMatchObject({ after: { assignedStoreId: tokoA, spgStartedOn: "2026-11-01" } });
  });

  it("akun bukan SPG tidak dimintai tanggal mulai, dan isian liar `mulai` tidak ditulis", async () => {
    const dibuat = await simpanPenggunaAction(
      isian({ id: null, email: emailBaru, nama: `${tagSpg} Baru`, roleId: peranBiasa, tokoId: null, sandi: SANDI, ulangSandi: SANDI, mulai: "2026-11-01" }),
    );
    expect(dibuat).toMatchObject({ ok: true });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { email: seededId(emailBaru) }, select: { assignedStoreId: true, spgStartedOn: true } }),
    ).toEqual({ assignedStoreId: null, spgStartedOn: null });
  });

  it("SPG aktif tanpa tanggal mulai: menyimpan akunnya wajib membawa tanggal itu, diperiksa penulisnya di transaksi yang sama", async () => {
    await prisma.user.update({ where: { id: seededId(spg) }, data: { spgStartedOn: null } });
    await adaKunjungan(new Date("2026-10-05T03:00:00.000Z"));
    // Mengganti sandi saja pun meminta tanggalnya.
    expect(await simpanPenggunaAction(isian({ sandi: SANDI, ulangSandi: SANDI }))).toEqual({ ok: false, codes: ["MULAI_WAJIB"] });

    // Sesudah check-in pertama → ditolak, dan SELURUH penyimpanan batal (nama tidak berubah, tanpa jejak).
    expect(await simpanPenggunaAction(isian({ nama: `${tagSpg} SPG Ubah`, mulai: "2026-10-06" }))).toEqual({
      ok: false,
      codes: ["MULAI_SESUDAH_KEGIATAN"],
    });
    expect(await bacaNama()).toEqual({ name: `${tagSpg} SPG`, spgStartedOn: null });
    expect(await jejakUbah()).toHaveLength(0);

    expect(await simpanPenggunaAction(isian({ nama: `${tagSpg} SPG Ubah`, mulai: "2026-10-03" }))).toEqual({ ok: true, id: spg });
    expect(await bacaNama()).toEqual({ name: `${tagSpg} SPG Ubah`, spgStartedOn: "2026-10-03" });
    const jejak = (await jejakUbah()).map((j) => j.changes);
    expect(jejak).toHaveLength(2);
    expect(jejak).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          before: expect.objectContaining({ name: `${tagSpg} SPG` }),
          after: expect.objectContaining({ name: `${tagSpg} SPG Ubah` }),
        }),
        { before: { spgStartedOn: null }, after: { spgStartedOn: "2026-10-03" } },
      ]),
    );
  });

  it("akun lama yang baru diberi peran SPG dan toko tetap wajib membawa tanggal mulai", async () => {
    await prisma.user.update({ where: { id: seededId(spg) }, data: { roleId: peranBiasa, assignedStoreId: null, spgStartedOn: null } });
    expect(await simpanPenggunaAction(isian({ tokoId: tokoB }))).toEqual({ ok: false, codes: ["MULAI_WAJIB"] });
    expect(await baca()).toEqual({ roleId: peranBiasa, assignedStoreId: null, spgStartedOn: null });

    expect(await simpanPenggunaAction(isian({ tokoId: tokoB, mulai: "2026-11-02" }))).toEqual({ ok: true, id: spg });
    expect(await baca()).toEqual({ roleId: peranSpg, assignedStoreId: tokoB, spgStartedOn: "2026-11-02" });
  });

  it("tanggal mulai yang sudah tersimpan tidak pernah ditimpa dari formulir ini", async () => {
    expect(await simpanPenggunaAction(isian({ nama: `${tagSpg} SPG Ubah`, mulai: "2026-10-15" }))).toEqual({ ok: true, id: spg });
    expect((await baca()).spgStartedOn).toBe("2026-10-01");
    const jejak = await jejakUbah();
    expect(jejak).toHaveLength(1);
    expect(jejak[0].changes).not.toHaveProperty("before.spgStartedOn");
    expect(jejak[0].changes).not.toHaveProperty("after.spgStartedOn");
  });

  it("tanggal mulai terkunci begitu ada gaji dibayar — di tombol \"Atur tanggal mulai\" maupun di formulir ini", async () => {
    await prisma.user.update({ where: { id: seededId(spg) }, data: { spgStartedOn: null } });
    expect(await aturMulaiSpgAction({ userId: spg, mulai: "2026-02-30" })).toEqual({ ok: false, code: "TANGGAL_TIDAK_SAH" });

    await adaKunjungan(new Date("2026-10-05T03:00:00.000Z"));
    expect(await aturMulaiSpgAction({ userId: spg, mulai: "2026-10-06" })).toEqual({ ok: false, code: "MULAI_SESUDAH_KEGIATAN" });
    expect(await aturMulaiSpgAction({ userId: spg, mulai: "2026-10-03" })).toEqual({ ok: true });
    expect((await baca()).spgStartedOn).toBe("2026-10-03");
    const jejak = await jejakUbah();
    expect(jejak[0].changes).toMatchObject({ before: { spgStartedOn: null }, after: { spgStartedOn: "2026-10-03" } });

    await prisma.spgCommission.create({
      data: { userId: spg, storeId: tokoA, period: "2026-10", unitsSold: 0, commission: 0, basis: "uji", lockedById: pelaku, paidAt: new Date() },
    });
    expect(await aturMulaiSpgAction({ userId: spg, mulai: "2026-10-02" })).toEqual({ ok: false, code: "MULAI_TERKUNCI" });
    expect((await baca()).spgStartedOn).toBe("2026-10-03");
    // Akun yang tanggalnya sudah ada tetap bisa disimpan sesudah gaji dibayar — tanggalnya tidak disentuh.
    expect(await simpanPenggunaAction(isian({ nama: `${tagSpg} SPG Baru` }))).toEqual({ ok: true, id: spg });
    expect((await baca()).spgStartedOn).toBe("2026-10-03");

    // Tanpa tanggal padahal gaji sudah dibayar: penulisnya menolak, dan penyimpanan akunnya batal.
    await prisma.user.update({ where: { id: seededId(spg) }, data: { spgStartedOn: null } });
    expect(await simpanPenggunaAction(isian({ nama: `${tagSpg} SPG Lagi`, mulai: "2026-10-02" }))).toEqual({
      ok: false,
      codes: ["MULAI_TERKUNCI"],
    });
    expect(await bacaNama()).toEqual({ name: `${tagSpg} SPG Baru`, spgStartedOn: null });
  });

  it("SPG yang sudah punya riwayat tidak dipindah toko atau diganti perannya di sini", async () => {
    await adaKunjungan(new Date("2026-10-05T03:00:00.000Z"));
    expect(await simpanPenggunaAction(isian({ tokoId: tokoB }))).toEqual({ ok: false, codes: ["SPG_GUNAKAN_BERHENTI"] });
    expect(await simpanPenggunaAction(isian({ roleId: peranBiasa, tokoId: null }))).toEqual({ ok: false, codes: ["SPG_GUNAKAN_BERHENTI"] });
    expect(await baca()).toEqual({ roleId: peranSpg, assignedStoreId: tokoA, spgStartedOn: "2026-10-01" });
    expect(await simpanPenggunaAction(isian({ nama: `${tagSpg} SPG Ubah` }))).toEqual({ ok: true, id: spg });
  });

  it("toko SPG yang belum punya riwayat masih bisa dibetulkan", async () => {
    expect(await simpanPenggunaAction(isian({ tokoId: tokoB }))).toEqual({ ok: true, id: spg });
    expect((await baca()).assignedStoreId).toBe(tokoB);
  });

  it("SPG yang sudah berhenti disimpan tanpa toko tetap; memberinya toko ditolak (batalkan berhenti dulu)", async () => {
    await prisma.user.update({
      where: { id: seededId(spg) },
      data: { assignedStoreId: null, spgEndedOn: "2026-10-31", spgEndedStoreId: tokoA },
    });
    expect(await simpanPenggunaAction(isian({ tokoId: null }))).toEqual({ ok: true, id: spg });
    expect(await simpanPenggunaAction(isian({ tokoId: tokoA }))).toEqual({ ok: false, codes: ["BERHENTI_BATALKAN_DULU"] });
    expect((await baca()).assignedStoreId).toBeNull();
  });
});

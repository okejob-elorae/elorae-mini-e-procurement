import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/**
 * `app/actions/rbac.ts` terhadap basis data sungguhan (sesi ditiru):
 *
 * - Mengubah izin peran dan menghapus peran menulis `AuditLog` DI transaksi
 *   yang sama, membawa daftar izin sebelum/sesudah. Barisnya hanya menyimpan
 *   keadaan terakhir — siapa yang memberi peran salesman akses keuangan hanya
 *   bisa ditanyakan dari jejaknya.
 * - `assignUserRole` memegang aturan toko tetap SPG yang sama dengan
 *   Pengaturan → Pengguna: peran SPG wajib punya toko tetap (aktif), dan
 *   berganti ke peran lain mengosongkannya — pengguna lain yang kebetulan
 *   punya toko tetap diperlakukan sebagai SPG di HP.
 */

type SesiUji = { user: { id: string; email: null; permissions: string[] } };
const sesi = vi.hoisted(() => ({ kini: null as SesiUji | null }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sesi.kini) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { assignUserRole, createRole, deleteRole, updateRolePermissions } = await import("./rbac");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `RBJ-${Math.random().toString(36).slice(2, 8)}`;
const tagEmail = tag.toLowerCase();

d("rbac — jejak izin peran dan toko tetap SPG (test bed only)", () => {
  let izinDibuat: string[] = [];
  const izinId: Record<string, string> = {};
  let peranIds: string[] = [];
  let peranBiasa = "";
  let peranSpg = "";
  let pelaku = "";
  let target = "";
  let tokoAktif = "";
  let tokoMati = "";

  const masuk = (permissions: string[]) => {
    sesi.kini = { user: { id: pelaku, email: null, permissions } };
  };
  const buatPeran = async (akhiran: string, kode: string[]) => {
    const p = await prisma.roleDefinition.create({
      data: {
        name: `${tag}-${akhiran}`,
        isSystem: false,
        permissions: { create: kode.map((k) => ({ permissionId: izinId[k] })) },
      },
    });
    peranIds.push(p.id);
    return p.id;
  };
  const jejak = (entityId: string, action: string) =>
    prisma.auditLog.findMany({
      where: { entityId: seededId(entityId), action },
      select: { userId: true, entityType: true, changes: true },
    });
  const pengguna = () => seededIds([pelaku, target].filter(Boolean));

  beforeAll(async () => {
    izinDibuat = [];
    peranIds = [];
    for (const code of ["pwa:access", "stores:view", "spg_sales:record"]) {
      const ada = await prisma.permission.findUnique({ where: { code }, select: { id: true } });
      if (ada) {
        izinId[code] = ada.id;
      } else {
        const [modul, aksi] = code.split(":");
        const baru = await prisma.permission.create({ data: { code, module: modul, action: aksi } });
        izinDibuat.push(baru.id);
        izinId[code] = baru.id;
      }
    }
    peranBiasa = await buatPeran("BIASA", ["pwa:access"]);
    peranSpg = await buatPeran("SPG", ["pwa:access", "spg_sales:record"]);
    pelaku = (await prisma.user.create({ data: { email: `${tagEmail}-p@uji.local`, name: `${tag} P`, roleId: peranBiasa } })).id;
    target = (await prisma.user.create({ data: { email: `${tagEmail}-t@uji.local`, name: `${tag} T`, roleId: peranBiasa } })).id;
    const toko = (akhiran: string, isActive: boolean) =>
      prisma.store.create({ data: { code: `${tag}-${akhiran}`, name: `${tag} ${akhiran}`, address: "uji", termsType: "KONSI", isActive } });
    tokoAktif = (await toko("A", true)).id;
    tokoMati = (await toko("M", false)).id;
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: { in: pengguna() } } });
    await prisma.user.update({ where: { id: seededId(target) }, data: { roleId: peranBiasa, assignedStoreId: null } });
  });

  afterAll(async () => {
    sesi.kini = null;
    await prisma.auditLog.deleteMany({ where: { userId: { in: pengguna() } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...pengguna(), ...peranIds.filter(Boolean).map(seededId)] } } });
    await prisma.user.deleteMany({ where: { id: { in: pengguna() } } });
    const peran = peranIds.filter(Boolean).map(seededId);
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: seededIds(peran) } } });
    await prisma.roleDefinition.deleteMany({ where: { id: { in: seededIds(peran) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoAktif, tokoMati].filter(Boolean)) } } });
    if (izinDibuat.length) await prisma.permission.deleteMany({ where: { id: { in: seededIds(izinDibuat.filter(Boolean)) } } });
  });

  describe("updateRolePermissions", () => {
    it("menulis jejak berisi daftar izin sebelum dan sesudah", async () => {
      const peran = await buatPeran("UBAH", ["pwa:access"]);
      masuk(["settings_rbac:manage"]);
      expect(await updateRolePermissions(peran, [izinId["stores:view"], izinId["pwa:access"]])).toEqual({ ok: true });

      const baris = await jejak(peran, "ROLE_PERMISSIONS_UPDATED");
      expect(baris).toHaveLength(1);
      expect(baris[0]).toMatchObject({ userId: pelaku, entityType: "RoleDefinition" });
      expect(baris[0].changes).toEqual({
        before: { permissions: ["pwa:access"] },
        after: { permissions: ["pwa:access", "stores:view"] },
      });
    });

    it("izin yang tidak ada → IZIN_TIDAK_SAH, tanpa perubahan dan tanpa jejak", async () => {
      const peran = await buatPeran("SALAH", ["pwa:access"]);
      masuk(["settings_rbac:manage"]);
      expect(await updateRolePermissions(peran, [izinId["stores:view"], `${tag}-tidak-ada`])).toEqual({
        ok: false,
        code: "IZIN_TIDAK_SAH",
      });
      expect(await jejak(peran, "ROLE_PERMISSIONS_UPDATED")).toEqual([]);
      const tautan = await prisma.rolePermission.findMany({ where: { roleId: seededId(peran) }, select: { permissionId: true } });
      expect(tautan.map((t) => t.permissionId)).toEqual([izinId["pwa:access"]]);
    });
  });

  describe("createRole", () => {
    it("membuat peran dan menulis jejak berisi nama, keterangan, dan izinnya", async () => {
      masuk(["settings_rbac:manage"]);
      const hasil = await createRole(
        { name: `  ${tag}-BARU `, description: "Admin toko" },
        [izinId["stores:view"], izinId["pwa:access"], izinId["stores:view"]],
      );
      expect(hasil.ok).toBe(true);
      if (!hasil.ok) return;
      peranIds.push(hasil.id);

      const peran = await prisma.roleDefinition.findUniqueOrThrow({
        where: { id: seededId(hasil.id) },
        select: { name: true, isSystem: true, permissions: { select: { permission: { select: { code: true } } } } },
      });
      expect(peran.name).toBe(`${tag}-BARU`);
      expect(peran.isSystem).toBe(false);
      expect(peran.permissions.map((p) => p.permission.code).sort()).toEqual(["pwa:access", "stores:view"]);
      const baris = await jejak(hasil.id, "ROLE_CREATED");
      expect(baris).toHaveLength(1);
      expect(baris[0]).toMatchObject({ userId: pelaku, entityType: "RoleDefinition" });
      expect(baris[0].changes).toEqual({
        after: { name: `${tag}-BARU`, description: "Admin toko", permissions: ["pwa:access", "stores:view"] },
      });
    });

    it("nama yang sudah dipakai → NAMA_SUDAH_ADA; nama kosong → NAMA_TIDAK_SAH; tanpa izin → TANPA_AKSES", async () => {
      masuk(["settings_rbac:manage"]);
      expect(await createRole({ name: `${tag}-BIASA` }, [])).toEqual({ ok: false, code: "NAMA_SUDAH_ADA" });
      expect(await createRole({ name: "   " }, [])).toEqual({ ok: false, code: "NAMA_TIDAK_SAH" });
      expect(await createRole({ name: `${tag}-X` }, [`${tag}-tidak-ada`])).toEqual({ ok: false, code: "IZIN_TIDAK_SAH" });
      masuk(["settings_rbac:view"]);
      expect(await createRole({ name: `${tag}-Y` }, [])).toEqual({ ok: false, code: "TANPA_AKSES" });
      const dibuat = await prisma.roleDefinition.count({ where: { name: { in: [`${tag}-X`, `${tag}-Y`] } } });
      expect(dibuat).toBe(0);
    });
  });

  describe("deleteRole", () => {
    it("menghapus peran dan menulis jejak berisi nama dan izinnya", async () => {
      const peran = await buatPeran("HAPUS", ["stores:view", "pwa:access"]);
      masuk(["settings_rbac:manage"]);
      await deleteRole(peran);

      expect(await prisma.roleDefinition.findUnique({ where: { id: seededId(peran) } })).toBeNull();
      const baris = await jejak(peran, "ROLE_DELETED");
      expect(baris).toHaveLength(1);
      expect(baris[0]).toMatchObject({ userId: pelaku, entityType: "RoleDefinition" });
      expect(baris[0].changes).toMatchObject({
        before: { name: `${tag}-HAPUS`, permissions: ["pwa:access", "stores:view"] },
      });
    });

    it("peran yang masih dipakai pengguna → MASIH_DIPAKAI, tidak terhapus dan tanpa jejak", async () => {
      masuk(["settings_rbac:manage"]);
      expect(await deleteRole(peranBiasa)).toEqual({ ok: false, code: "MASIH_DIPAKAI" });
      expect(await prisma.roleDefinition.findUnique({ where: { id: seededId(peranBiasa) }, select: { id: true } })).not.toBeNull();
      expect(await jejak(peranBiasa, "ROLE_DELETED")).toEqual([]);
    });
  });

  describe("assignUserRole — toko tetap SPG", () => {
    it("peran SPG tanpa toko tetap ditolak TOKO_WAJIB", async () => {
      masuk(["settings_security:manage"]);
      expect(await assignUserRole(target, peranSpg)).toEqual({ ok: false, code: "TOKO_WAJIB" });
      const u = await prisma.user.findUniqueOrThrow({ where: { id: seededId(target) }, select: { roleId: true } });
      expect(u.roleId).toBe(peranBiasa);
    });

    it("toko tetap yang nonaktif tidak dihitung", async () => {
      await prisma.user.update({ where: { id: seededId(target) }, data: { assignedStoreId: tokoMati } });
      masuk(["settings_security:manage"]);
      expect(await assignUserRole(target, peranSpg)).toEqual({ ok: false, code: "TOKO_WAJIB" });
    });

    it("peran SPG dengan toko tetap aktif → berhasil, tokonya tetap", async () => {
      await prisma.user.update({ where: { id: seededId(target) }, data: { assignedStoreId: tokoAktif } });
      masuk(["settings_security:manage"]);
      expect(await assignUserRole(target, peranSpg)).toEqual({ ok: true });
      const u = await prisma.user.findUniqueOrThrow({ where: { id: seededId(target) }, select: { roleId: true, assignedStoreId: true } });
      expect(u).toEqual({ roleId: peranSpg, assignedStoreId: tokoAktif });
    });

    it("berganti dari peran SPG ke peran lain mengosongkan toko tetap, dan jejaknya mencatatnya", async () => {
      await prisma.user.update({ where: { id: seededId(target) }, data: { roleId: peranSpg, assignedStoreId: tokoAktif } });
      masuk(["settings_security:manage"]);
      expect(await assignUserRole(target, peranBiasa)).toEqual({ ok: true });
      const u = await prisma.user.findUniqueOrThrow({ where: { id: seededId(target) }, select: { roleId: true, assignedStoreId: true } });
      expect(u).toEqual({ roleId: peranBiasa, assignedStoreId: null });
      const baris = await jejak(target, "USER_UPDATED");
      expect(baris).toHaveLength(1);
      expect(baris[0].changes).toEqual({
        before: { roleId: peranSpg, assignedStoreId: tokoAktif },
        after: { roleId: peranBiasa, assignedStoreId: null },
      });
    });
  });
});

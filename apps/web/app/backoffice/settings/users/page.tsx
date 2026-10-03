import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { perannyaSpg } from "@/lib/users/validasi";
import { PenggunaClient } from "./PenggunaClient";

export const dynamic = "force-dynamic";

/**
 * Pengaturan → Pengguna: tambah akun (sales, SPG, admin, …), pasang sandi,
 * ganti peran, dan pilih toko tetap untuk SPG.
 */
export default async function PenggunaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SETTINGS_SECURITY_MANAGE)) redirect("/backoffice/settings");

  const [users, roles, stores] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true, roleId: true, assignedStoreId: true, passwordHash: true },
    }),
    prisma.roleDefinition.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, isSystem: true, permissions: { select: { permission: { select: { code: true } } } } },
    }),
    prisma.store.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
  ]);

  return (
    <PenggunaClient
      sayaId={session.user.id}
      pengguna={users.map((u) => ({
        id: u.id,
        nama: u.name ?? "",
        email: u.email,
        roleId: u.roleId,
        tokoId: u.assignedStoreId,
        // Hanya penanda ada/tidak — hash sandi tidak pernah dikirim ke layar.
        punyaSandi: u.passwordHash !== null,
      }))}
      peran={roles.map((r) => ({
        id: r.id,
        nama: r.name,
        sistem: r.isSystem,
        spg: perannyaSpg(r.permissions.map((p) => p.permission.code)),
      }))}
      toko={stores}
    />
  );
}

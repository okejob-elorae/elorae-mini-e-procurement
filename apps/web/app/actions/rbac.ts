'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@elorae/db';
import { requirePermission, PERMISSIONS } from '@/lib/rbac';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { runSerializable } from '@/lib/db/tx-retry';
import { perannyaSpg, tolakAkunSistem, type KodeAkunSistem } from '@/lib/users/validasi';

const roleSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().optional(),
});

const _updateRolePermissionsSchema = z.object({
  permissionIds: z.array(z.string()),
});
void _updateRolePermissionsSchema;

/**
 * Get all roles with their permissions and user counts
 */
export async function getRoles() {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_RBAC_VIEW);

  const roles = await prisma.roleDefinition.findMany({
    include: {
      permissions: {
        include: {
          permission: true,
        },
      },
      _count: {
        select: {
          users: true,
        },
      },
    },
    orderBy: {
      name: 'asc',
    },
  });

  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissionsVersion: role.permissionsVersion,
    userCount: role._count.users,
    permissions: role.permissions.map((rp) => ({
      id: rp.permission.id,
      code: rp.permission.code,
      module: rp.permission.module,
      action: rp.permission.action,
      description: rp.permission.description,
    })),
  }));
}

/**
 * Get all permissions grouped by module
 */
export async function getPermissions() {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_RBAC_VIEW);

  const permissions = await prisma.permission.findMany({
    orderBy: [
      { module: 'asc' },
      { action: 'asc' },
    ],
  });

  // Group by module
  const grouped: Record<string, typeof permissions> = {};
  for (const perm of permissions) {
    if (!grouped[perm.module]) {
      grouped[perm.module] = [];
    }
    grouped[perm.module].push(perm);
  }

  return grouped;
}

/**
 * Create a new role
 */
export async function createRole(
  data: z.infer<typeof roleSchema>,
  permissionIds: string[]
) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_RBAC_MANAGE);

  const validated = roleSchema.parse(data);

  // Check if role name already exists
  const existing = await prisma.roleDefinition.findUnique({
    where: { name: validated.name },
  });
  if (existing) {
    throw new Error('Role with this name already exists');
  }

  // Validate permission IDs exist
  const permissionCount = await prisma.permission.count({
    where: { id: { in: permissionIds } },
  });
  if (permissionCount !== permissionIds.length) {
    throw new Error('One or more permission IDs are invalid');
  }

  const role = await prisma.roleDefinition.create({
    data: {
      name: validated.name,
      description: validated.description || null,
      isSystem: false,
      permissions: {
        create: permissionIds.map((permissionId) => ({
          permissionId,
        })),
      },
    },
    include: {
      permissions: {
        include: {
          permission: true,
        },
      },
    },
  });

  revalidatePath('/backoffice/settings/rbac');
  return role;
}

/** Kode izin sebuah peran, terurut — bentuk jejak sebelum/sesudah. */
function kodeIzin(rows: { permission: { code: string } }[]): string[] {
  return rows.map((r) => r.permission.code).sort();
}

/**
 * Update role permissions
 *
 * Peran dibaca, tautannya diganti, dan `AuditLog` ditulis di SATU transaksi
 * serializable, membawa daftar izin sebelum dan sesudah. Barisnya hanya
 * menyimpan izin terakhir — siapa yang memberi peran lapangan akses keuangan,
 * dan kapan, hanya bisa ditanyakan dari jejak ini.
 */
export async function updateRolePermissions(
  roleId: string,
  permissionIds: string[]
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_RBAC_MANAGE);
  const pelakuId = session.user.id;
  const ids = [...new Set(permissionIds)];

  await runSerializable(async (tx) => {
    const role = await tx.roleDefinition.findUnique({
      where: { id: roleId },
      select: { id: true, name: true, isSystem: true, permissions: { select: { permission: { select: { code: true } } } } },
    });
    if (!role) {
      throw new Error('Role not found');
    }
    if (role.isSystem) {
      throw new Error('Cannot modify system role permissions');
    }

    // Validate permission IDs exist
    const baru = await tx.permission.findMany({
      where: { id: { in: ids } },
      select: { code: true },
    });
    if (baru.length !== ids.length) {
      throw new Error('One or more permission IDs are invalid');
    }

    await tx.rolePermission.deleteMany({
      where: { roleId },
    });
    if (ids.length > 0) {
      await tx.rolePermission.createMany({
        data: ids.map((permissionId) => ({
          roleId,
          permissionId,
        })),
      });
    }

    // Increment permissions version to trigger JWT refresh
    await tx.roleDefinition.update({
      where: { id: roleId },
      data: {
        permissionsVersion: {
          increment: 1,
        },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: pelakuId,
        action: 'ROLE_PERMISSIONS_UPDATED',
        entityType: 'RoleDefinition',
        entityId: roleId,
        changes: {
          before: { permissions: kodeIzin(role.permissions) },
          after: { permissions: baru.map((p) => p.code).sort() },
        },
        metadata: { roleName: role.name },
      },
    });
  });

  revalidatePath('/backoffice/settings/rbac');
}

/**
 * Delete a role
 *
 * Penghapusan dan jejaknya (nama, keterangan, dan daftar izin peran itu) di
 * satu transaksi: setelah barisnya hilang, jejak inilah satu-satunya tempat
 * izin peran itu masih bisa dibaca.
 */
export async function deleteRole(roleId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_RBAC_MANAGE);
  const pelakuId = session.user.id;

  await runSerializable(async (tx) => {
    const role = await tx.roleDefinition.findUnique({
      where: { id: roleId },
      select: {
        id: true,
        name: true,
        description: true,
        isSystem: true,
        permissions: { select: { permission: { select: { code: true } } } },
        _count: {
          select: {
            users: true,
          },
        },
      },
    });

    if (!role) {
      throw new Error('Role not found');
    }
    if (role.isSystem) {
      throw new Error('Cannot delete system role');
    }
    if (role._count.users > 0) {
      throw new Error('Cannot delete role that is assigned to users');
    }

    await tx.roleDefinition.delete({
      where: { id: roleId },
    });

    await tx.auditLog.create({
      data: {
        userId: pelakuId,
        action: 'ROLE_DELETED',
        entityType: 'RoleDefinition',
        entityId: roleId,
        changes: {
          before: { name: role.name, description: role.description, permissions: kodeIzin(role.permissions) },
        },
      },
    });
  });

  revalidatePath('/backoffice/settings/rbac');
}

export type AssignUserRoleResult =
  | { ok: true }
  | {
      ok: false;
      code: KodeAkunSistem | "PERAN_SENDIRI" | "TIDAK_DITEMUKAN" | "PERAN_TIDAK_DITEMUKAN" | "TOKO_WAJIB";
    };

/**
 * Ganti peran seorang pengguna.
 *
 * Butuh `settings_security:manage`. Peran sistem (izin penuh `*`) hanya boleh
 * DIBERI atau DICABUT oleh admin sistem — aturan yang sama dengan Pengaturan →
 * Pengguna (`tolakAkunSistem`). Tanpa itu pemegang izin ini bisa mengangkat
 * siapa pun, termasuk dirinya, menjadi admin penuh. Peran sendiri tidak bisa
 * diganti di sini (admin bisa mengunci dirinya keluar).
 *
 * Peran pelaku, target, dan peran baru dibaca DI DALAM transaksi serializable,
 * dari basis data (bukan dari JWT yang bisa basi): pengangkatan oleh admin
 * sistem yang di-commit di antara baca dan tulis tidak bisa ditimpa. Setiap
 * pergantian menulis `AuditLog` di transaksi yang sama — barisnya hanya
 * menyimpan peran terakhir, jejaknya satu-satunya riwayat.
 *
 * Toko tetap SPG mengikuti aturan Pengaturan → Pengguna (`perannyaSpg`):
 * peran SPG wajib punya toko tetap yang aktif (`TOKO_WAJIB` — aksi ini tidak
 * memilih toko, jadi tokonya ditetapkan di Pengaturan → Pengguna), dan peran
 * lain mengosongkannya, karena aplikasi mengenali SPG dari toko tetapnya.
 */
export async function assignUserRole(userId: string, roleId: string): Promise<AssignUserRoleResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);
  if (typeof userId !== 'string' || !userId) return { ok: false, code: 'TIDAK_DITEMUKAN' };
  if (typeof roleId !== 'string' || !roleId) return { ok: false, code: 'PERAN_TIDAK_DITEMUKAN' };
  const pelakuId = session.user.id;

  const hasil = await runSerializable(async (tx): Promise<AssignUserRoleResult> => {
    const [pelaku, target, peran] = await Promise.all([
      tx.user.findUnique({ where: { id: pelakuId }, select: { roleDefinition: { select: { isSystem: true } } } }),
      tx.user.findUnique({
        where: { id: userId },
        select: { id: true, roleId: true, assignedStoreId: true, roleDefinition: { select: { isSystem: true } } },
      }),
      tx.roleDefinition.findUnique({
        where: { id: roleId },
        select: { id: true, isSystem: true, permissions: { select: { permission: { select: { code: true } } } } },
      }),
    ]);
    if (!target) return { ok: false, code: 'TIDAK_DITEMUKAN' };
    if (!peran) return { ok: false, code: 'PERAN_TIDAK_DITEMUKAN' };
    const tolak = tolakAkunSistem({
      pelakuSistem: pelaku?.roleDefinition?.isSystem === true,
      targetSistem: target.roleDefinition?.isSystem === true,
      peranSistem: peran.isSystem,
    });
    if (tolak) return { ok: false, code: tolak };
    if (target.id === pelakuId) return { ok: false, code: 'PERAN_SENDIRI' };
    if (target.roleId === peran.id) return { ok: true };

    let tokoBaru: string | null = null;
    if (perannyaSpg(kodeIzin(peran.permissions), peran.isSystem)) {
      const tokoAktif = target.assignedStoreId
        ? await tx.store.count({ where: { id: target.assignedStoreId, isActive: true } })
        : 0;
      if (!tokoAktif) return { ok: false, code: 'TOKO_WAJIB' };
      tokoBaru = target.assignedStoreId;
    }
    // Toko tetap hanya masuk jejak bila berubah — jejak lama berbentuk roleId saja.
    const tokoBerubah = target.assignedStoreId !== tokoBaru;

    await tx.user.update({ where: { id: target.id }, data: { roleId: peran.id, assignedStoreId: tokoBaru } });
    await tx.auditLog.create({
      data: {
        userId: pelakuId,
        action: 'USER_UPDATED',
        entityType: 'User',
        entityId: target.id,
        changes: {
          before: { roleId: target.roleId, ...(tokoBerubah ? { assignedStoreId: target.assignedStoreId } : {}) },
          after: { roleId: peran.id, ...(tokoBerubah ? { assignedStoreId: tokoBaru } : {}) },
        },
        metadata: { jalur: 'assignUserRole' },
      },
    });
    return { ok: true };
  });

  if (hasil.ok) revalidatePath('/backoffice/settings/security');
  return hasil;
}

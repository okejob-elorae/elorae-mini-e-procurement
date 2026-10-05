'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@elorae/db';
import { requirePermission, PERMISSIONS } from '@/lib/rbac';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { runSerializable } from '@/lib/db/tx-retry';
import { tolakAkunSistem, type KodeAkunSistem } from '@/lib/users/validasi';

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

/**
 * Update role permissions
 */
export async function updateRolePermissions(
  roleId: string,
  permissionIds: string[]
) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_RBAC_MANAGE);

  // Check if role exists and is not a system role
  const role = await prisma.roleDefinition.findUnique({
    where: { id: roleId },
  });
  if (!role) {
    throw new Error('Role not found');
  }
  if (role.isSystem) {
    throw new Error('Cannot modify system role permissions');
  }

  // Validate permission IDs exist
  const permissionCount = await prisma.permission.count({
    where: { id: { in: permissionIds } },
  });
  if (permissionCount !== permissionIds.length) {
    throw new Error('One or more permission IDs are invalid');
  }

  await prisma.$transaction(async (tx) => {
    // Delete existing permissions
    await tx.rolePermission.deleteMany({
      where: { roleId },
    });

    // Create new permissions
    if (permissionIds.length > 0) {
      await tx.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({
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
  });

  revalidatePath('/backoffice/settings/rbac');
}

/**
 * Delete a role
 */
export async function deleteRole(roleId: string) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_RBAC_MANAGE);

  const role = await prisma.roleDefinition.findUnique({
    where: { id: roleId },
    include: {
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

  await prisma.roleDefinition.delete({
    where: { id: roleId },
  });

  revalidatePath('/backoffice/settings/rbac');
}

export type AssignUserRoleResult =
  | { ok: true }
  | { ok: false; code: KodeAkunSistem | "PERAN_SENDIRI" | "TIDAK_DITEMUKAN" | "PERAN_TIDAK_DITEMUKAN" };

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
        select: { id: true, roleId: true, roleDefinition: { select: { isSystem: true } } },
      }),
      tx.roleDefinition.findUnique({ where: { id: roleId }, select: { id: true, isSystem: true } }),
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

    await tx.user.update({ where: { id: target.id }, data: { roleId: peran.id } });
    await tx.auditLog.create({
      data: {
        userId: pelakuId,
        action: 'USER_UPDATED',
        entityType: 'User',
        entityId: target.id,
        changes: { before: { roleId: target.roleId }, after: { roleId: peran.id } },
        metadata: { jalur: 'assignUserRole' },
      },
    });
    return { ok: true };
  });

  if (hasil.ok) revalidatePath('/backoffice/settings/security');
  return hasil;
}

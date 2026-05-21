'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requirePermission, PERMISSIONS } from '@/lib/rbac';
import { auth } from '@/lib/auth';
import { z } from 'zod';

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

/**
 * Assign a role to a user (for user management)
 */
export async function assignUserRole(userId: string, roleId: string) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  // Verify user and role exist
  const [user, role] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.roleDefinition.findUnique({ where: { id: roleId } }),
  ]);

  if (!user) throw new Error('User not found');
  if (!role) throw new Error('Role not found');

  await prisma.user.update({
    where: { id: userId },
    data: { roleId },
  });

  revalidatePath('/backoffice/settings/security');
}

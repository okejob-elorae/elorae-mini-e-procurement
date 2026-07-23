"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@elorae/db";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import type { AccountType } from "@/lib/constants/enums";
import {
  validateCreate,
  validateReparent,
  validateDeactivate,
  type AccountForValidation,
} from "@/lib/finance/coa/validators";

type ActionResult = { ok: true } | { ok: false; code: string; message: string };

const REVALIDATE = "/backoffice/finance/coa";

function forbidden(): ActionResult {
  return { ok: false, code: "forbidden", message: "Permission denied." };
}

async function requireManage(): Promise<{ ok: true } | ActionResult> {
  const session = await auth();
  if (!session) return forbidden();
  const perms = ((session.user as { permissions?: string[] }).permissions) ?? [];
  if (!hasPermission(perms, PERMISSIONS.COA_MANAGE)) return forbidden();
  return { ok: true };
}

function toValidationShape(a: {
  id: string;
  code: string;
  type: string;
  depth: number;
  isActive: boolean;
  parentId: string | null;
}): AccountForValidation {
  return {
    id: a.id,
    code: a.code,
    type: a.type as AccountType,
    depth: a.depth,
    isActive: a.isActive,
    parentId: a.parentId,
  };
}

export async function createAccountAction(input: {
  code: string;
  name: string;
  parentId: string | null;
  type?: AccountType;
}): Promise<ActionResult> {
  const gate = await requireManage();
  if (!("ok" in gate) || gate.ok !== true) return gate;

  try {
    return await prisma.$transaction(async (tx) => {
      // Load parent (inside tx for TOCTOU safety on type/depth/isActive)
      let parentRow: AccountForValidation | null = null;
      if (input.parentId) {
        const p = await tx.chartAccount.findUnique({ where: { id: input.parentId } });
        if (!p) return { ok: false, code: "parent_not_found", message: "Parent not found." } as ActionResult;
        parentRow = toValidationShape(p);
      }
      const v = validateCreate(input, parentRow);
      if (!v.ok) return v;

      // Duplicate code check
      const existing = await tx.chartAccount.findUnique({ where: { code: input.code } });
      if (existing) return { ok: false, code: "code_duplicate", message: "Account code already exists." };

      const type = parentRow ? parentRow.type : (input.type as AccountType);
      const depth = parentRow ? parentRow.depth + 1 : 1;

      await tx.chartAccount.create({
        data: {
          code: input.code,
          name: input.name,
          type,
          parentId: input.parentId,
          depth,
          isActive: true,
        },
      });

      revalidatePath(REVALIDATE);
      return { ok: true };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, code: "code_duplicate", message: "Account code already exists." };
    }
    throw err;
  }
}

export async function updateAccountAction(
  id: string,
  input: { name?: string; code?: string; parentId?: string | null },
): Promise<ActionResult> {
  const gate = await requireManage();
  if (!("ok" in gate) || gate.ok !== true) return gate;

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.chartAccount.findUnique({ where: { id } });
      if (!current) return { ok: false, code: "not_found", message: "Account not found." };

      const childrenCount = await tx.chartAccount.count({ where: { parentId: id } });

      // MVP: forbid code change OR reparent on non-leaf accounts.
      if (childrenCount > 0) {
        if (input.code !== undefined) {
          return {
            ok: false,
            code: "has_children_code_change_forbidden",
            message: "Cannot change code of an account with children.",
          };
        }
        if (input.parentId !== undefined) {
          return {
            ok: false,
            code: "has_children_reparent_forbidden",
            message: "Cannot reparent an account with children.",
          };
        }
      }

      // Reparent (leaf only by the gate above)
      if (input.parentId !== undefined) {
        let newParent: AccountForValidation | null = null;
        if (input.parentId !== null) {
          const np = await tx.chartAccount.findUnique({ where: { id: input.parentId } });
          if (!np) return { ok: false, code: "parent_not_found", message: "New parent not found." };
          newParent = toValidationShape(np);
        }
        const all = await tx.chartAccount.findMany({
          select: { id: true, code: true, type: true, depth: true, isActive: true, parentId: true },
        });
        const v = validateReparent(toValidationShape(current), newParent, all.map(toValidationShape));
        if (!v.ok) return v;
      }

      // Code change (leaf only by the gate above)
      if (input.code !== undefined && input.code !== current.code) {
        if (!/^[0-9]+$/.test(input.code)) {
          return { ok: false, code: "code_format_invalid", message: "Code must be digits only." };
        }
        const dup = await tx.chartAccount.findUnique({ where: { code: input.code } });
        if (dup) return { ok: false, code: "code_duplicate", message: "Code already in use." };
        // Re-run prefix check against (possibly new) parent
        const parentId = input.parentId !== undefined ? input.parentId : current.parentId;
        if (parentId) {
          const p = await tx.chartAccount.findUnique({ where: { id: parentId } });
          if (p && !input.code.startsWith(p.code)) {
            return { ok: false, code: "code_prefix_mismatch", message: "Code must start with parent code." };
          }
        }
      }

      const updateData: Record<string, unknown> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.code !== undefined) updateData.code = input.code;
      if (input.parentId !== undefined) {
        updateData.parentId = input.parentId;
        // recompute depth
        if (input.parentId === null) {
          updateData.depth = 1;
        } else {
          const p = await tx.chartAccount.findUnique({ where: { id: input.parentId } });
          if (p) updateData.depth = p.depth + 1;
        }
      }
      await tx.chartAccount.update({ where: { id }, data: updateData });

      revalidatePath(REVALIDATE);
      return { ok: true };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, code: "code_duplicate", message: "Account code already exists." };
    }
    throw err;
  }
}

export async function deactivateAccountAction(id: string): Promise<ActionResult> {
  const gate = await requireManage();
  if (!("ok" in gate) || gate.ok !== true) return gate;

  try {
    const current = await prisma.chartAccount.findUnique({ where: { id } });
    if (!current) return { ok: false, code: "not_found", message: "Account not found." };
    const activeChildren = await prisma.chartAccount.count({ where: { parentId: id, isActive: true } });
    const v = validateDeactivate(toValidationShape(current), activeChildren);
    if (!v.ok) return v;
    await prisma.chartAccount.update({ where: { id }, data: { isActive: false } });
    revalidatePath(REVALIDATE);
    return { ok: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, code: "code_duplicate", message: "Account code already exists." };
    }
    throw err;
  }
}

export async function reactivateAccountAction(id: string): Promise<ActionResult> {
  const gate = await requireManage();
  if (!("ok" in gate) || gate.ok !== true) return gate;

  try {
    const current = await prisma.chartAccount.findUnique({ where: { id } });
    if (!current) return { ok: false, code: "not_found", message: "Account not found." };

    // If parent is inactive, refuse — re-activating an orphan-by-design is confusing.
    if (current.parentId) {
      const p = await prisma.chartAccount.findUnique({ where: { id: current.parentId } });
      if (p && !p.isActive) {
        return { ok: false, code: "parent_inactive", message: "Parent is inactive. Reactivate parent first." };
      }
    }

    await prisma.chartAccount.update({ where: { id }, data: { isActive: true } });
    revalidatePath(REVALIDATE);
    return { ok: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, code: "code_duplicate", message: "Account code already exists." };
    }
    throw err;
  }
}

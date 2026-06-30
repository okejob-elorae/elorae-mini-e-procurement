"use server";

import { revalidatePath } from "next/cache";
import { prisma, type OpnameScope, type OpnameStatus } from "@elorae/db";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { generateDocNumber } from "@/lib/docNumber";
import { requirePermission, hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  allItemCountsFilled,
  allRollCountsFilled,
  canApproveOpname,
  canCancelOpname,
  canSubmitOpname,
  computeVariance,
  isSelfApprovalBlocked,
  SELF_APPROVAL_ERROR,
} from "@/lib/inventory/opname";
import {
  applyFabricAdjustments,
  applyFgAccessoriesAdjustments,
  detectItemDrift,
  detectRollDrift,
  pushFgStockAfterOpname,
  type DriftRow,
} from "@/lib/inventory/opname-approve";
import { freezeFabricRollSnapshot, freezeItemSnapshot } from "@/lib/inventory/opname-snapshot";
import { serializeForClient } from "@/lib/serialize-for-client";

const OPNAME_PATH = "/backoffice/inventory/stock-opname";

async function sessionUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user;
}

function serializeOpname<T>(row: T): T {
  return serializeForClient(row);
}

export async function createOpname(data: {
  scope: OpnameScope;
  assignedToId?: string;
  itemIds?: string[];
  notes?: string;
}): Promise<{ success: boolean; opnameId?: string; error?: string }> {
  try {
    const user = await sessionUser();
    requirePermission(user.permissions ?? [], PERMISSIONS.INVENTORY_OPNAME_COUNT);

    const result = await prisma.$transaction(async (tx) => {
      const docNumber = await generateDocNumber("OPN", tx);
      const now = new Date();
      const opname = await tx.stockOpname.create({
        data: {
          docNumber,
          scope: data.scope,
          status: "CREATED",
          notes: data.notes,
          snapshotAt: now,
          assignedToId: data.assignedToId,
          createdById: user.id,
        },
      });

      let rowCount = 0;
      if (data.scope === "FABRIC") {
        rowCount = await freezeFabricRollSnapshot(tx, opname.id, data.itemIds);
      } else {
        rowCount = await freezeItemSnapshot(tx, opname.id, data.scope, data.itemIds);
      }

      if (rowCount === 0) {
        throw new Error("Tidak ada item/roll dalam scope yang dipilih");
      }

      return opname;
    });

    await logAudit({
      userId: user.id,
      action: "CREATE",
      entityType: "StockOpname",
      entityId: result.id,
      changes: { after: { scope: data.scope, docNumber: result.docNumber } },
    });

    revalidatePath(OPNAME_PATH);
    return { success: true, opnameId: result.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to create opname" };
  }
}

export async function updateOpnameCounts(
  opnameId: string,
  counts: Array<{ opnameItemId: string; countedQty: number; notes?: string }>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await sessionUser();
    requirePermission(user.permissions ?? [], PERMISSIONS.INVENTORY_OPNAME_COUNT);

    const opname = await prisma.stockOpname.findUnique({ where: { id: opnameId } });
    if (!opname) throw new Error("Opname not found");
    if (opname.status === "APPROVED" || opname.status === "CANCELLED") {
      throw new Error("Opname tidak dapat diubah");
    }

    await prisma.$transaction(async (tx) => {
      for (const c of counts) {
        const row = await tx.stockOpnameItem.findFirst({
          where: { id: c.opnameItemId, opnameId },
        });
        if (!row) continue;
        const variance = computeVariance(c.countedQty, Number(row.snapshotQty));
        await tx.stockOpnameItem.update({
          where: { id: c.opnameItemId },
          data: {
            countedQty: c.countedQty,
            variance,
            notes: c.notes,
          },
        });
      }
      if (opname.status === "CREATED") {
        await tx.stockOpname.update({
          where: { id: opnameId },
          data: { status: "COUNTING" },
        });
      }
    });

    revalidatePath(OPNAME_PATH);
    revalidatePath(`${OPNAME_PATH}/${opnameId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to update counts" };
  }
}

export async function updateOpnameRollCounts(
  opnameId: string,
  counts: Array<{ opnameRollId: string; countedLength: number; notes?: string }>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await sessionUser();
    requirePermission(user.permissions ?? [], PERMISSIONS.INVENTORY_OPNAME_COUNT);

    const opname = await prisma.stockOpname.findUnique({ where: { id: opnameId } });
    if (!opname) throw new Error("Opname not found");
    if (opname.scope !== "FABRIC") throw new Error("Opname bukan scope kain");
    if (opname.status === "APPROVED" || opname.status === "CANCELLED") {
      throw new Error("Opname tidak dapat diubah");
    }

    await prisma.$transaction(async (tx) => {
      for (const c of counts) {
        const row = await tx.stockOpnameRoll.findFirst({
          where: { id: c.opnameRollId, opnameId },
        });
        if (!row) continue;
        const variance = computeVariance(c.countedLength, Number(row.snapshotLength));
        await tx.stockOpnameRoll.update({
          where: { id: c.opnameRollId },
          data: {
            countedLength: c.countedLength,
            variance,
            notes: c.notes,
          },
        });
      }
      if (opname.status === "CREATED") {
        await tx.stockOpname.update({
          where: { id: opnameId },
          data: { status: "COUNTING" },
        });
      }
    });

    revalidatePath(OPNAME_PATH);
    revalidatePath(`${OPNAME_PATH}/${opnameId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to update roll counts" };
  }
}

export async function submitOpname(opnameId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await sessionUser();
    requirePermission(user.permissions ?? [], PERMISSIONS.INVENTORY_OPNAME_COUNT);

    const opname = await prisma.stockOpname.findUnique({
      where: { id: opnameId },
      include: { items: true, rolls: true },
    });
    if (!opname) throw new Error("Opname not found");
    if (!canSubmitOpname(opname.status)) throw new Error("Status opname tidak valid untuk submit");

    if (opname.scope === "FABRIC") {
      if (!allRollCountsFilled(opname.rolls)) {
        throw new Error("Semua roll harus diisi sebelum submit");
      }
    } else if (!allItemCountsFilled(opname.items)) {
      throw new Error("Semua baris harus diisi sebelum submit");
    }

    await prisma.stockOpname.update({
      where: { id: opnameId },
      data: {
        status: "SUBMITTED",
        submittedById: user.id,
        submittedAt: new Date(),
      },
    });

    revalidatePath(OPNAME_PATH);
    revalidatePath(`${OPNAME_PATH}/${opnameId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to submit opname" };
  }
}

export async function approveOpname(
  opnameId: string,
  confirmDrift?: boolean,
): Promise<{
  success: boolean;
  driftRows?: DriftRow[];
  error?: string;
}> {
  try {
    const user = await sessionUser();
    requirePermission(user.permissions ?? [], PERMISSIONS.INVENTORY_OPNAME_APPROVE);

    const opname = await prisma.stockOpname.findUnique({ where: { id: opnameId } });
    if (!opname) throw new Error("Opname not found");
    if (!canApproveOpname(opname.status)) throw new Error("Opname belum disubmit");

    const canApproveOwn = hasPermission(user.permissions ?? [], "inventory_opname:approve_own");
    if (isSelfApprovalBlocked(opname.submittedById, user.id, canApproveOwn)) {
      return { success: false, error: SELF_APPROVAL_ERROR };
    }

    if (!confirmDrift) {
      const driftRows =
        opname.scope === "FABRIC"
          ? await prisma.$transaction((tx) => detectRollDrift(tx, opnameId))
          : await prisma.$transaction((tx) => detectItemDrift(tx, opnameId));
      if (driftRows.length > 0) {
        return { success: false, driftRows };
      }
    }

    let adjustmentCount = 0;
    let pushItemIds: string[] = [];

    await prisma.$transaction(async (tx) => {
      if (opname.scope === "FABRIC") {
        const r = await applyFabricAdjustments(tx, opnameId, opname.docNumber);
        adjustmentCount = r.adjustmentCount;
      } else {
        const r = await applyFgAccessoriesAdjustments(
          tx,
          opnameId,
          opname.docNumber,
          user.id,
          opname.scope,
        );
        adjustmentCount = r.adjustmentCount;
        pushItemIds = r.pushItemIds;
      }

      await tx.stockOpname.update({
        where: { id: opnameId },
        data: {
          status: "APPROVED",
          approvedById: user.id,
          approvedAt: new Date(),
        },
      });
    });

    if (opname.scope === "FINISHED_GOOD" && pushItemIds.length > 0) {
      await pushFgStockAfterOpname(pushItemIds, user.id);
    }

    await logAudit({
      userId: user.id,
      action: "APPROVE",
      entityType: "StockOpname",
      entityId: opnameId,
      changes: { after: { adjustmentCount } },
    });

    revalidatePath(OPNAME_PATH);
    revalidatePath(`${OPNAME_PATH}/${opnameId}`);
    revalidatePath("/backoffice/inventory");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to approve opname" };
  }
}

export async function cancelOpname(opnameId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await sessionUser();
    const opname = await prisma.stockOpname.findUnique({ where: { id: opnameId } });
    if (!opname) throw new Error("Opname not found");
    if (!canCancelOpname(opname.status)) throw new Error("Opname tidak dapat dibatalkan");

    const isApprover = hasPermission(user.permissions ?? [], PERMISSIONS.INVENTORY_OPNAME_APPROVE);
    const isCounter = hasPermission(user.permissions ?? [], PERMISSIONS.INVENTORY_OPNAME_COUNT);
    if (!isApprover && !(isCounter && opname.createdById === user.id)) {
      requirePermission(user.permissions ?? [], PERMISSIONS.INVENTORY_OPNAME_APPROVE);
    }

    await prisma.stockOpname.update({
      where: { id: opnameId },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    revalidatePath(OPNAME_PATH);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to cancel opname" };
  }
}

export async function getOpnames(filters?: { status?: OpnameStatus; scope?: OpnameScope }) {
  const user = await sessionUser();
  requirePermission(user.permissions ?? [], PERMISSIONS.INVENTORY_OPNAME_VIEW);

  const rows = await prisma.stockOpname.findMany({
    where: {
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.scope ? { scope: filters.scope } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      items: { select: { id: true } },
      rolls: { select: { id: true } },
    },
  });

  return rows.map((r) =>
    serializeOpname({
      ...r,
      rowCount: r.scope === "FABRIC" ? r.rolls.length : r.items.length,
    }),
  );
}

export async function getOpnameById(opnameId: string) {
  const user = await sessionUser();
  requirePermission(user.permissions ?? [], PERMISSIONS.INVENTORY_OPNAME_VIEW);

  const opname = await prisma.stockOpname.findUnique({
    where: { id: opnameId },
    include: { items: true, rolls: true },
  });
  if (!opname) return null;

  const userIds = [
    opname.createdById,
    opname.submittedById,
    opname.approvedById,
    opname.assignedToId,
  ].filter((id): id is string => Boolean(id));

  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];

  const userNames = new Map(users.map((u) => [u.id, u.name]));

  return serializeOpname({
    ...opname,
    createdByName: userNames.get(opname.createdById) ?? null,
    submittedByName: opname.submittedById
      ? (userNames.get(opname.submittedById) ?? null)
      : null,
    approvedByName: opname.approvedById
      ? (userNames.get(opname.approvedById) ?? null)
      : null,
    assignedToName: opname.assignedToId
      ? (userNames.get(opname.assignedToId) ?? null)
      : null,
  });
}

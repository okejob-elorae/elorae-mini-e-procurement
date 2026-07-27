"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS, hasPermission, requirePermission } from "@/lib/rbac";
import {
  buildChainSnapshot,
  resolveChain,
  suggestEta,
  totalDaysFixedOnly,
  type ResolvedStep,
  type SnapshotStep,
} from "@/lib/leadtime/calculations";
import {
  applyChainTemplateSchema,
  chainTemplateSchema,
  confirmPositionSchema,
  processTemplateSchema,
  reorderChainSchema,
  supplierProcessSchema,
  updateChainTemplateSchema,
  updateProcessTemplateSchema,
  updateSupplierProcessSchema,
} from "@/lib/validations/lead-time";

type Result<T = unknown> = { success: boolean; data?: T; error?: string };

const LEAD_TIME_PATH = "/backoffice/lead-time";

async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session;
}

function serializeTemplate<T extends Record<string, unknown>>(t: T) {
  return t;
}

export async function getProcessTemplates(includeInactive = false) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.LEAD_TIME_VIEW);

  return prisma.processTemplate.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function createProcessTemplate(
  data: unknown
): Promise<Result<{ id: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session.user.permissions, PERMISSIONS.LEAD_TIME_MANAGE);
    const parsed = processTemplateSchema.parse(data);
    const rateQty = parsed.leadTimeType === "FIXED" ? null : parsed.rateQty ?? null;

    const created = await prisma.processTemplate.create({
      data: {
        name: parsed.name,
        leadTimeType: parsed.leadTimeType,
        days: parsed.days,
        rateQty,
        notes: parsed.notes ?? null,
        sortOrder: parsed.sortOrder ?? 0,
        isApproval: parsed.isApproval ?? false,
        sopInstructions: parsed.sopInstructions ?? null,
      },
    });

    await logAudit({
      userId: session.user.id,
      action: "CREATE",
      entityType: "ProcessTemplate",
      entityId: created.id,
      changes: { after: serializeTemplate(created) },
    });

    revalidatePath(LEAD_TIME_PATH);
    return { success: true, data: { id: created.id } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create process";
    if (msg.includes("Unique constraint") || msg.includes("name")) {
      return { success: false, error: "Nama proses sudah dipakai." };
    }
    return { success: false, error: msg };
  }
}

export async function updateProcessTemplate(
  id: string,
  data: unknown
): Promise<Result> {
  try {
    const session = await requireSession();
    requirePermission(session.user.permissions, PERMISSIONS.LEAD_TIME_MANAGE);
    const parsed = updateProcessTemplateSchema.parse(data);

    const existing = await prisma.processTemplate.findUnique({ where: { id } });
    if (!existing) return { success: false, error: "Proses tidak ditemukan." };

    const leadTimeType = parsed.leadTimeType ?? existing.leadTimeType;
    let rateQty =
      parsed.rateQty !== undefined ? parsed.rateQty : existing.rateQty;
    if (leadTimeType === "FIXED") rateQty = null;
    if (leadTimeType === "PER_QTY" && (rateQty == null || rateQty < 1)) {
      return { success: false, error: "rateQty is required for PER_QTY" };
    }

    const updated = await prisma.processTemplate.update({
      where: { id },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.leadTimeType !== undefined
          ? { leadTimeType: parsed.leadTimeType }
          : {}),
        ...(parsed.days !== undefined ? { days: parsed.days } : {}),
        rateQty,
        ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
        ...(parsed.isApproval !== undefined
          ? { isApproval: parsed.isApproval }
          : {}),
        ...(parsed.sopInstructions !== undefined
          ? { sopInstructions: parsed.sopInstructions }
          : {}),
      },
    });

    await logAudit({
      userId: session.user.id,
      action: "UPDATE",
      entityType: "ProcessTemplate",
      entityId: id,
      changes: { before: existing, after: updated },
    });

    revalidatePath(LEAD_TIME_PATH);
    return { success: true, data: updated };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update process";
    if (msg.includes("Unique constraint")) {
      return { success: false, error: "Nama proses sudah dipakai." };
    }
    return { success: false, error: msg };
  }
}

export async function deactivateProcessTemplate(id: string): Promise<Result> {
  try {
    const session = await requireSession();
    requirePermission(session.user.permissions, PERMISSIONS.LEAD_TIME_MANAGE);

    const updated = await prisma.processTemplate.update({
      where: { id },
      data: { isActive: false },
    });

    await logAudit({
      userId: session.user.id,
      action: "DEACTIVATE",
      entityType: "ProcessTemplate",
      entityId: id,
      changes: { after: { isActive: false } },
    });

    revalidatePath(LEAD_TIME_PATH);
    return { success: true, data: updated };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to deactivate",
    };
  }
}

export async function getSupplierChain(supplierId: string) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.LEAD_TIME_VIEW);

  const steps = await prisma.supplierProcess.findMany({
    where: { supplierId },
    include: { processTemplate: true },
    orderBy: { sequence: "asc" },
  });
  const resolved = resolveChain(steps);
  return {
    steps,
    resolved,
    totalDaysFixedOnly: totalDaysFixedOnly(resolved),
  };
}

export type SupplierChainCard = {
  supplierId: string;
  code: string;
  name: string;
  steps: Array<{
    id: string;
    sequence: number;
    overrideDays: number | null;
    overrideRateQty: number | null;
    notes: string | null;
    processTemplate: {
      id: string;
      name: string;
      leadTimeType: "FIXED" | "PER_QTY";
      days: number;
      rateQty: number | null;
      isApproval: boolean;
      isActive: boolean;
    };
  }>;
  resolved: ResolvedStep[];
  totalDaysFixedOnly: number;
  hasPerQty: boolean;
};

export async function getAllSupplierChains(): Promise<SupplierChainCard[]> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.LEAD_TIME_VIEW);

  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true, status: "ACTIVE" },
    select: {
      id: true,
      code: true,
      name: true,
      processChain: {
        include: { processTemplate: true },
        orderBy: { sequence: "asc" },
      },
    },
    orderBy: { code: "asc" },
  });

  return suppliers.map((s) => {
    const resolved = resolveChain(s.processChain);
    return {
      supplierId: s.id,
      code: s.code,
      name: s.name,
      steps: s.processChain,
      resolved,
      totalDaysFixedOnly: totalDaysFixedOnly(resolved),
      hasPerQty: resolved.some((r) => r.type === "PER_QTY"),
    };
  });
}

export async function addSupplierProcessStep(data: unknown): Promise<Result> {
  try {
    const session = await requireSession();
    requirePermission(session.user.permissions, PERMISSIONS.LEAD_TIME_MANAGE);
    const parsed = supplierProcessSchema.parse(data);

    const template = await prisma.processTemplate.findUnique({
      where: { id: parsed.processTemplateId },
    });
    if (!template || !template.isActive) {
      return { success: false, error: "Proses tidak aktif / tidak ditemukan." };
    }

    const agg = await prisma.supplierProcess.aggregate({
      where: { supplierId: parsed.supplierId },
      _max: { sequence: true },
    });
    const sequence = (agg._max.sequence ?? 0) + 1;

    const created = await prisma.supplierProcess.create({
      data: {
        supplierId: parsed.supplierId,
        processTemplateId: parsed.processTemplateId,
        sequence,
        overrideDays: parsed.overrideDays ?? null,
        overrideRateQty: parsed.overrideRateQty ?? null,
        notes: parsed.notes ?? null,
      },
      include: { processTemplate: true },
    });

    await logAudit({
      userId: session.user.id,
      action: "ADD",
      entityType: "SupplierProcess",
      entityId: created.id,
      changes: {
        after: {
          supplierId: parsed.supplierId,
          templateName: template.name,
          sequence,
        },
      },
    });

    revalidatePath(LEAD_TIME_PATH);
    return { success: true, data: created };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to add step",
    };
  }
}

export async function updateSupplierProcessStep(
  id: string,
  data: unknown
): Promise<Result> {
  try {
    const session = await requireSession();
    requirePermission(session.user.permissions, PERMISSIONS.LEAD_TIME_MANAGE);
    const parsed = updateSupplierProcessSchema.parse(data);

    const updated = await prisma.supplierProcess.update({
      where: { id },
      data: {
        ...(parsed.overrideDays !== undefined
          ? { overrideDays: parsed.overrideDays }
          : {}),
        ...(parsed.overrideRateQty !== undefined
          ? { overrideRateQty: parsed.overrideRateQty }
          : {}),
        ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
      },
      include: { processTemplate: true },
    });

    await logAudit({
      userId: session.user.id,
      action: "UPDATE",
      entityType: "SupplierProcess",
      entityId: id,
      changes: {
        after: {
          supplierId: updated.supplierId,
          templateName: updated.processTemplate.name,
          overrideDays: updated.overrideDays,
          overrideRateQty: updated.overrideRateQty,
        },
      },
    });

    revalidatePath(LEAD_TIME_PATH);
    return { success: true, data: updated };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update step",
    };
  }
}

export async function removeSupplierProcessStep(id: string): Promise<Result> {
  try {
    const session = await requireSession();
    requirePermission(session.user.permissions, PERMISSIONS.LEAD_TIME_MANAGE);

    const existing = await prisma.supplierProcess.findUnique({
      where: { id },
      include: { processTemplate: true },
    });
    if (!existing) return { success: false, error: "Step tidak ditemukan." };

    await prisma.$transaction(async (tx) => {
      await tx.supplierProcess.delete({ where: { id } });
      const remaining = await tx.supplierProcess.findMany({
        where: { supplierId: existing.supplierId },
        orderBy: { sequence: "asc" },
      });
      for (let i = 0; i < remaining.length; i++) {
        await tx.supplierProcess.update({
          where: { id: remaining[i].id },
          data: { sequence: i + 1 },
        });
      }
    });

    await logAudit({
      userId: session.user.id,
      action: "REMOVE",
      entityType: "SupplierProcess",
      entityId: id,
      changes: {
        before: {
          supplierId: existing.supplierId,
          templateName: existing.processTemplate.name,
        },
      },
    });

    revalidatePath(LEAD_TIME_PATH);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to remove step",
    };
  }
}

export async function reorderSupplierChain(data: unknown): Promise<Result> {
  try {
    const session = await requireSession();
    requirePermission(session.user.permissions, PERMISSIONS.LEAD_TIME_MANAGE);
    const parsed = reorderChainSchema.parse(data);

    await prisma.$transaction(async (tx) => {
      // Two-phase rewrite to avoid unique (supplierId, sequence) collisions
      for (let i = 0; i < parsed.orderedStepIds.length; i++) {
        await tx.supplierProcess.update({
          where: { id: parsed.orderedStepIds[i] },
          data: { sequence: -(i + 1) },
        });
      }
      for (let i = 0; i < parsed.orderedStepIds.length; i++) {
        await tx.supplierProcess.update({
          where: { id: parsed.orderedStepIds[i] },
          data: { sequence: i + 1 },
        });
      }
    });

    await logAudit({
      userId: session.user.id,
      action: "REORDER",
      entityType: "SupplierProcess",
      entityId: parsed.supplierId,
      changes: { after: { orderedStepIds: parsed.orderedStepIds } },
    });

    revalidatePath(LEAD_TIME_PATH);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to reorder",
    };
  }
}

export async function previewChainDays(
  supplierId: string,
  qty: number | null
): Promise<{
  snapshot: SnapshotStep[];
  totalDays: number;
  suggestedEta: Date | null;
}> {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.LEAD_TIME_VIEW);

  const steps = await prisma.supplierProcess.findMany({
    where: { supplierId },
    include: { processTemplate: true },
    orderBy: { sequence: "asc" },
  });
  if (steps.length === 0) {
    return { snapshot: [], totalDays: 0, suggestedEta: null };
  }
  const resolved = resolveChain(steps);
  const { snapshot, totalDays } = buildChainSnapshot(resolved, qty);
  if (totalDays <= 0) {
    return { snapshot, totalDays, suggestedEta: null };
  }
  return {
    snapshot,
    totalDays,
    suggestedEta: suggestEta(new Date(), totalDays),
  };
}

export async function confirmChainPosition(data: unknown): Promise<Result> {
  try {
    const session = await requireSession();
    const parsed = confirmPositionSchema.parse(data);
    const docType = parsed.docType ?? "PO";
    const docId = parsed.docId ?? parsed.poId;
    if (!docId) {
      return { success: false, error: "docId required" };
    }

    if (docType === "PO") {
      requirePermission(
        session.user.permissions,
        PERMISSIONS.PURCHASE_ORDERS_EDIT
      );
    } else {
      requirePermission(
        session.user.permissions,
        PERMISSIONS.WORK_ORDERS_MANAGE
      );
    }

    if (docType === "PO") {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: docId },
        select: { id: true, chainSnapshot: true, status: true },
      });
      if (!po) return { success: false, error: "PO tidak ditemukan." };
      if (!po.chainSnapshot) {
        return { success: false, error: "PO tidak memiliki chain snapshot." };
      }

      const snapshot = po.chainSnapshot as SnapshotStep[];
      if (
        parsed.stepIndex != null &&
        (parsed.stepIndex < 0 || parsed.stepIndex >= snapshot.length)
      ) {
        return { success: false, error: "Index langkah tidak valid." };
      }

      await prisma.purchaseOrder.update({
        where: { id: docId },
        data: {
          chainConfirmedStepIndex: parsed.stepIndex,
          chainConfirmedAt: parsed.stepIndex == null ? null : new Date(),
          chainConfirmedSource: parsed.stepIndex == null ? null : "MANUAL",
        },
      });

      const stepName =
        parsed.stepIndex != null
          ? snapshot[parsed.stepIndex]?.name ?? null
          : null;

      await logAudit({
        userId: session.user.id,
        action: "CONFIRM_CHAIN_POSITION",
        entityType: "PurchaseOrder",
        entityId: docId,
        changes: { after: { stepIndex: parsed.stepIndex, stepName } },
      });

      revalidatePath(`/backoffice/purchase-orders/${docId}`);
      return { success: true };
    }

    const wo = await prisma.workOrder.findUnique({
      where: { id: docId },
      select: { id: true, chainSnapshot: true, status: true },
    });
    if (!wo) return { success: false, error: "WO tidak ditemukan." };
    if (!wo.chainSnapshot) {
      return { success: false, error: "WO tidak memiliki chain snapshot." };
    }

    const snapshot = wo.chainSnapshot as SnapshotStep[];
    if (
      parsed.stepIndex != null &&
      (parsed.stepIndex < 0 || parsed.stepIndex >= snapshot.length)
    ) {
      return { success: false, error: "Index langkah tidak valid." };
    }

    await prisma.workOrder.update({
      where: { id: docId },
      data: {
        chainConfirmedStepIndex: parsed.stepIndex,
        chainConfirmedAt: parsed.stepIndex == null ? null : new Date(),
        chainConfirmedSource: parsed.stepIndex == null ? null : "MANUAL",
      },
    });

    const stepName =
      parsed.stepIndex != null
        ? snapshot[parsed.stepIndex]?.name ?? null
        : null;

    await logAudit({
      userId: session.user.id,
      action: "CONFIRM_CHAIN_POSITION",
      entityType: "WorkOrder",
      entityId: docId,
      changes: { after: { stepIndex: parsed.stepIndex, stepName } },
    });

    revalidatePath(`/backoffice/work-orders/${docId}`);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to confirm position",
    };
  }
}

/** Live procedure meta for strip (isApproval + sopInstructions by name). */
export async function getProcessMetaByNames(names: string[]): Promise<{
  isApproval: Record<string, boolean>;
  sopInstructions: Record<string, string | null>;
}> {
  const session = await requireSession();
  const perms = session.user.permissions;
  const can =
    hasPermission(perms, PERMISSIONS.LEAD_TIME_VIEW) ||
    hasPermission(perms, PERMISSIONS.WORK_ORDERS_VIEW) ||
    hasPermission(perms, PERMISSIONS.PURCHASE_ORDERS_VIEW);
  if (!can) {
    throw new Error("Forbidden: Insufficient permissions");
  }

  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) {
    return { isApproval: {}, sopInstructions: {} };
  }

  const rows = await prisma.processTemplate.findMany({
    where: { name: { in: unique } },
    select: { name: true, isApproval: true, sopInstructions: true },
  });

  const isApproval: Record<string, boolean> = {};
  const sopInstructions: Record<string, string | null> = {};
  for (const name of unique) {
    const row = rows.find((r) => r.name === name);
    isApproval[name] = row?.isApproval ?? name.startsWith("ACC ");
    sopInstructions[name] = row?.sopInstructions ?? null;
  }
  return { isApproval, sopInstructions };
}

export async function getChainTemplates(includeInactive = false) {
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.LEAD_TIME_VIEW);

  const templates = await prisma.chainTemplate.findMany({
    where: includeInactive ? undefined : { isActive: true },
    include: {
      steps: {
        include: { processTemplate: true },
        orderBy: { sequence: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return templates.map((t) => {
    const resolved = t.steps.map((s, i) => ({
      seq: i + 1,
      name: s.processTemplate.name,
      type: s.processTemplate.leadTimeType as "FIXED" | "PER_QTY",
      days: s.processTemplate.days,
      rateQty: s.processTemplate.rateQty,
      isApproval: s.processTemplate.isApproval,
      isActive: s.processTemplate.isActive,
      processTemplateId: s.processTemplateId,
      notes: s.notes,
    }));
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      isActive: t.isActive,
      updatedById: t.updatedById,
      updatedAt: t.updatedAt,
      steps: resolved,
      totalDaysFixedOnly: totalDaysFixedOnly(
        resolved.map((r) => ({
          seq: r.seq,
          name: r.name,
          type: r.type,
          days: r.days,
          rateQty: r.rateQty,
        }))
      ),
      hasArchivedSteps: resolved.some((r) => !r.isActive),
    };
  });
}

export async function createChainTemplate(data: unknown): Promise<Result<{ id: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session.user.permissions, PERMISSIONS.LEAD_TIME_MANAGE);
    const parsed = chainTemplateSchema.parse(data);

    const created = await prisma.$transaction(async (tx) => {
      const tmpl = await tx.chainTemplate.create({
        data: {
          name: parsed.name,
          description: parsed.description ?? null,
          updatedById: session.user.id,
        },
      });
      for (let i = 0; i < parsed.steps.length; i++) {
        await tx.chainTemplateStep.create({
          data: {
            chainTemplateId: tmpl.id,
            processTemplateId: parsed.steps[i].processTemplateId,
            sequence: i + 1,
            notes: parsed.steps[i].notes ?? null,
          },
        });
      }
      return tmpl;
    });

    await logAudit({
      userId: session.user.id,
      action: "CREATE",
      entityType: "ChainTemplate",
      entityId: created.id,
      changes: { after: { name: parsed.name, stepCount: parsed.steps.length } },
    });

    revalidatePath(LEAD_TIME_PATH);
    return { success: true, data: { id: created.id } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create SOP";
    if (msg.includes("Unique constraint")) {
      return { success: false, error: "Nama SOP sudah dipakai." };
    }
    return { success: false, error: msg };
  }
}

export async function updateChainTemplate(
  id: string,
  data: unknown
): Promise<Result> {
  try {
    const session = await requireSession();
    requirePermission(session.user.permissions, PERMISSIONS.LEAD_TIME_MANAGE);
    const parsed = updateChainTemplateSchema.parse(data);

    await prisma.$transaction(async (tx) => {
      await tx.chainTemplate.update({
        where: { id },
        data: {
          ...(parsed.name !== undefined ? { name: parsed.name } : {}),
          ...(parsed.description !== undefined
            ? { description: parsed.description }
            : {}),
          updatedById: session.user.id,
        },
      });
      if (parsed.steps) {
        await tx.chainTemplateStep.deleteMany({ where: { chainTemplateId: id } });
        for (let i = 0; i < parsed.steps.length; i++) {
          await tx.chainTemplateStep.create({
            data: {
              chainTemplateId: id,
              processTemplateId: parsed.steps[i].processTemplateId,
              sequence: i + 1,
              notes: parsed.steps[i].notes ?? null,
            },
          });
        }
      }
    });

    await logAudit({
      userId: session.user.id,
      action: "UPDATE",
      entityType: "ChainTemplate",
      entityId: id,
      changes: { after: parsed },
    });

    revalidatePath(LEAD_TIME_PATH);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update SOP",
    };
  }
}

export async function deactivateChainTemplate(id: string): Promise<Result> {
  try {
    const session = await requireSession();
    requirePermission(session.user.permissions, PERMISSIONS.LEAD_TIME_MANAGE);
    await prisma.chainTemplate.update({
      where: { id },
      data: { isActive: false, updatedById: session.user.id },
    });
    await logAudit({
      userId: session.user.id,
      action: "DEACTIVATE",
      entityType: "ChainTemplate",
      entityId: id,
      changes: { after: { isActive: false } },
    });
    revalidatePath(LEAD_TIME_PATH);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to deactivate SOP",
    };
  }
}

export async function applyChainTemplateToSupplier(
  data: unknown
): Promise<Result> {
  try {
    const session = await requireSession();
    requirePermission(session.user.permissions, PERMISSIONS.LEAD_TIME_MANAGE);
    const parsed = applyChainTemplateSchema.parse(data);

    const tmpl = await prisma.chainTemplate.findUnique({
      where: { id: parsed.chainTemplateId },
      include: {
        steps: {
          include: { processTemplate: true },
          orderBy: { sequence: "asc" },
        },
      },
    });
    if (!tmpl || !tmpl.isActive) {
      return { success: false, error: "SOP tidak aktif / tidak ditemukan." };
    }
    if (tmpl.steps.length === 0) {
      return { success: false, error: "SOP tidak punya langkah." };
    }

    await prisma.$transaction(async (tx) => {
      let startSeq = 1;
      if (parsed.mode === "REPLACE") {
        await tx.supplierProcess.deleteMany({
          where: { supplierId: parsed.supplierId },
        });
      } else {
        const agg = await tx.supplierProcess.aggregate({
          where: { supplierId: parsed.supplierId },
          _max: { sequence: true },
        });
        startSeq = (agg._max.sequence ?? 0) + 1;
      }
      for (let i = 0; i < tmpl.steps.length; i++) {
        await tx.supplierProcess.create({
          data: {
            supplierId: parsed.supplierId,
            processTemplateId: tmpl.steps[i].processTemplateId,
            sequence: startSeq + i,
            notes: tmpl.steps[i].notes,
          },
        });
      }
    });

    await logAudit({
      userId: session.user.id,
      action: "APPLY_CHAIN_TEMPLATE",
      entityType: "Supplier",
      entityId: parsed.supplierId,
      changes: {
        after: {
          chainTemplateId: parsed.chainTemplateId,
          name: tmpl.name,
          mode: parsed.mode,
          stepCount: tmpl.steps.length,
        },
      },
    });

    revalidatePath(LEAD_TIME_PATH);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to apply SOP",
    };
  }
}

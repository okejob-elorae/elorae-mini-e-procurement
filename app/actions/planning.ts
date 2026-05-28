'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ItemType } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { PERMISSIONS, requirePermission } from '@/lib/rbac';
import {
  buildActualsLookup,
  checkMonthlyMismatch,
  getActualQtyFromLookup,
  getAllMonthlyTargets,
  getCompletionBand,
  getCompletionPercent,
  getEffectiveTarget,
  getJakartaYearBounds,
  getMonthlyActualQtyFromLookup,
  validateChildShares,
  type ActualsLookup,
  type PlanningCategoryNode,
  type PlanningMonthlyRow,
} from '@/lib/planning/calculations';
import { buildPlanTemplateWorkbook, parsePlanExcelBuffer } from '@/lib/planning/excel-parser';
import {
  createPlanCategorySchema,
  createPlanStageSchema,
  createPlanYearSchema,
  updateMonthlyTargetSchema,
  updatePlanCategorySchema,
  updatePlanStageSchema,
  upsertAccessoryPlansSchema,
  upsertCmtAllocationsSchema,
  upsertColorAllocationsSchema,
} from '@/lib/validations/planning';
import { createWorkOrder } from '@/app/actions/production';
import { generateMaterialPlan } from '@/lib/production/planning';
import { Decimal } from 'decimal.js';

const PLANNING_PATH = '/backoffice/production/planning';

function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  if (typeof value === 'object' && value && 'toString' in value) {
    return Number(String(value));
  }
  return 0;
}

async function requirePlanningView() {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.PRODUCTION_PLANNING_VIEW);
  return session;
}

async function requirePlanningManage() {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.PRODUCTION_PLANNING_MANAGE);
  return session;
}

async function requirePlanYearUnlocked(planYearId: string) {
  const planYear = await prisma.planYear.findUnique({
    where: { id: planYearId },
    select: { id: true, isLocked: true },
  });
  if (!planYear) throw new Error('Plan year not found');
  if (planYear.isLocked) throw new Error('Plan year is locked');
  return planYear;
}

async function validateParentForTwoLevel(parentId: string) {
  const parent = await prisma.planCategory.findUnique({
    where: { id: parentId },
    select: { id: true, parentId: true, planYearId: true },
  });
  if (!parent) throw new Error('Parent category not found');
  if (parent.parentId) throw new Error('Only two levels are allowed');
  return parent;
}

async function validateChildSharesForParent(
  parentId: string,
  incomingPercent = 0,
  excludeChildId?: string
) {
  const siblings = await prisma.planCategory.findMany({
    where: {
      parentId,
      ...(excludeChildId ? { id: { not: excludeChildId } } : {}),
    },
    select: { parentSharePercent: true },
  });
  return validateChildShares(
    siblings.map((child) => toNumber(child.parentSharePercent)),
    incomingPercent
  );
}

async function validateFinishedGoodItem(itemId: string | null | undefined) {
  if (!itemId) return;
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { type: true },
  });
  if (!item) throw new Error('Item not found');
  if (item.type !== ItemType.FINISHED_GOOD) {
    throw new Error('Item must be a finished good');
  }
}

async function validateTailorSupplier(supplierId: string | null | undefined) {
  if (!supplierId) return;
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    include: { type: { select: { code: true } } },
  });
  if (!supplier) throw new Error('Supplier not found');
  if (supplier.type.code !== 'TAILOR') {
    throw new Error('Supplier must be type TAILOR');
  }
}

async function loadActualsLookup(year: number, itemIds: string[]): Promise<ActualsLookup> {
  if (itemIds.length === 0) {
    return { yearlyByItem: new Map(), monthlyByItem: new Map() };
  }
  const { start, endExclusive } = getJakartaYearBounds(year);
  const receipts = await prisma.fGReceipt.findMany({
    where: {
      wo: {
        finishedGoodId: { in: itemIds },
        status: { not: 'CANCELLED' },
      },
      receivedAt: { gte: start, lt: endExclusive },
    },
    select: {
      qtyAccepted: true,
      receivedAt: true,
      wo: { select: { finishedGoodId: true } },
    },
  });
  return buildActualsLookup(
    receipts.map((r) => ({
      finishedGoodId: r.wo.finishedGoodId,
      qtyAccepted: r.qtyAccepted,
      receivedAt: r.receivedAt,
    })),
    year
  );
}

function collectItemIds(categories: Array<{ itemId: string | null; children?: unknown[] }>): string[] {
  const ids = new Set<string>();
  const visit = (nodes: Array<{ itemId: string | null; children?: unknown[] }>) => {
    for (const node of nodes) {
      if (node.itemId) ids.add(node.itemId);
      if (Array.isArray(node.children)) {
        visit(node.children as Array<{ itemId: string | null; children?: unknown[] }>);
      }
    }
  };
  visit(categories);
  return [...ids];
}

type RawCategory = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  parentId: string | null;
  targetQty: number | null;
  parentSharePercent: unknown;
  itemId: string | null;
  sortOrder: number;
  monthlyTargets: PlanningMonthlyRow[];
  stages: Array<{
    id: string;
    name: string;
    targetQty: number;
    targetMonth: number | null;
    supplierId: string | null;
    fabricNotes: string | null;
    colorNotes: string | null;
    workOrderId: string | null;
    sortOrder: number;
  }>;
  colorAllocations?: Array<{
    id: string;
    colorName: string;
    colorCode: string | null;
    allocatedQty: number;
    notes: string | null;
  }>;
  cmtAllocations?: Array<{
    id: string;
    supplierId: string;
    allocatedQty: number;
    notes: string | null;
  }>;
  accessoryPlans?: Array<{
    id: string;
    itemId: string;
    qtyPerPcs: unknown;
    totalQtyNeeded: number;
    notes: string | null;
  }>;
  children?: RawCategory[];
};

function buildTree(categories: RawCategory[]) {
  const byId = new Map<string, RawCategory & { children: RawCategory[] }>();
  const roots: Array<RawCategory & { children: RawCategory[] }> = [];
  for (const category of categories) {
    const node = { ...category, children: [] as RawCategory[] };
    byId.set(category.id, node);
  }
  for (const node of byId.values()) {
    if (!node.parentId) roots.push(node);
    else byId.get(node.parentId)?.children.push(node);
  }
  return { roots, byId };
}

function toPlanningNode(
  node: RawCategory & { children: RawCategory[] },
  byId: Map<string, RawCategory & { children: RawCategory[] }>
): PlanningCategoryNode {
  const parent = node.parentId ? byId.get(node.parentId) ?? null : null;
  return {
    id: node.id,
    parentId: node.parentId,
    targetQty: node.targetQty,
    parentSharePercent: node.parentSharePercent != null ? toNumber(node.parentSharePercent) : null,
    itemId: node.itemId,
    parent: parent ? { targetQty: parent.targetQty } : null,
    children: node.children.map((child) =>
      toPlanningNode(child as RawCategory & { children: RawCategory[] }, byId)
    ),
  };
}

interface EnrichedPlanCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  parentId: string | null;
  targetQty: number | null;
  parentSharePercent: number | null;
  itemId: string | null;
  itemName: string | null;
  sortOrder: number;
  effectiveTarget: number;
  actualQty: number;
  variance: number;
  completionPercent: number;
  completionBand: 'red' | 'yellow' | 'green';
  unallocatedPercent: number | null;
  monthlyBreakdown: ReturnType<typeof getAllMonthlyTargets>;
  monthlyTargetsComputed: Array<{ month: number; targetQty: number; isManualOverride: boolean }>;
  monthlyTotal: number;
  monthlyActuals: Array<{ month: number; actual: number }>;
  monthlyMismatch: ReturnType<typeof checkMonthlyMismatch> | null;
  children: EnrichedPlanCategory[];
  stages: Array<{
    id: string;
    name: string;
    targetQty: number;
    targetMonth: number | null;
    supplierId: string | null;
    fabricNotes: string | null;
    colorNotes: string | null;
    workOrderId: string | null;
    sortOrder: number;
    supplierName: string | null;
    workOrderDocNumber: string | null;
    workOrderStatus: string | null;
  }>;
  colorAllocations: NonNullable<RawCategory['colorAllocations']>;
  cmtAllocations: NonNullable<RawCategory['cmtAllocations']>;
  accessoryPlans: Array<{
    id: string;
    itemId: string;
    qtyPerPcs: number;
    totalQtyNeeded: number;
    notes: string | null;
  }>;
}

function enrichCategoryNode(
  node: RawCategory & { children: RawCategory[] },
  byId: Map<string, RawCategory & { children: RawCategory[] }>,
  lookup: ActualsLookup,
  itemNames: Map<string, string>,
  supplierNames: Map<string, string>,
  workOrders: Map<string, { docNumber: string; status: string }>
): EnrichedPlanCategory {
  const planningNode = toPlanningNode(node, byId);
  const effectiveTarget = getEffectiveTarget(planningNode);
  const monthlyRows: PlanningMonthlyRow[] = node.monthlyTargets;
  const monthlyBreakdown = getAllMonthlyTargets(effectiveTarget, monthlyRows);
  const monthlyMismatch = checkMonthlyMismatch(effectiveTarget, monthlyRows);
  const actualQty = getActualQtyFromLookup(planningNode, lookup);
  const variance = actualQty - effectiveTarget;
  const completionPercent = getCompletionPercent(actualQty, effectiveTarget);

  let unallocatedPercent: number | null = null;
  if (!node.parentId && node.children.length > 0) {
    const allocated = node.children.reduce(
      (sum, child) => sum + toNumber(child.parentSharePercent),
      0
    );
    unallocatedPercent = Math.max(0, 100 - allocated);
  }

  const monthlyActuals = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    actual: getMonthlyActualQtyFromLookup(planningNode, lookup, i + 1),
  }));

  const isLeaf = node.children.length === 0;

  const enrichedChildren = node.children.map((child) =>
    enrichCategoryNode(
      child as RawCategory & { children: RawCategory[] },
      byId,
      lookup,
      itemNames,
      supplierNames,
      workOrders
    )
  );

  return {
    id: node.id,
    code: node.code,
    name: node.name,
    description: node.description,
    parentId: node.parentId,
    targetQty: node.targetQty,
    parentSharePercent:
      node.parentSharePercent != null ? toNumber(node.parentSharePercent) : null,
    itemId: node.itemId,
    itemName: node.itemId ? itemNames.get(node.itemId) ?? null : null,
    sortOrder: node.sortOrder,
    effectiveTarget,
    actualQty,
    variance,
    completionPercent,
    completionBand: getCompletionBand(completionPercent),
    unallocatedPercent,
    monthlyBreakdown,
    monthlyTargetsComputed: monthlyBreakdown.map((m) => ({
      month: m.month,
      targetQty: m.targetQty,
      isManualOverride: m.isManualOverride,
    })),
    monthlyTotal: monthlyBreakdown.reduce((s, m) => s + m.targetQty, 0),
    monthlyActuals,
    monthlyMismatch: monthlyMismatch.hasMismatch ? monthlyMismatch : null,
    children: enrichedChildren,
    stages: isLeaf
      ? node.stages.map((stage) => {
          const wo = stage.workOrderId ? workOrders.get(stage.workOrderId) : null;
          return {
            ...stage,
            supplierName: stage.supplierId ? supplierNames.get(stage.supplierId) ?? null : null,
            workOrderDocNumber: wo?.docNumber ?? null,
            workOrderStatus: wo?.status ?? null,
          };
        })
      : [],
    colorAllocations: node.colorAllocations ?? [],
    cmtAllocations: node.cmtAllocations ?? [],
    accessoryPlans: (node.accessoryPlans ?? []).map((row) => ({
      ...row,
      qtyPerPcs: toNumber(row.qtyPerPcs),
    })),
  };
}

export async function getPlanYears() {
  await requirePlanningView();
  const years = await prisma.planYear.findMany({
    orderBy: { year: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      _count: { select: { categories: true } },
    },
  });
  return years.map((year) => ({
    ...year,
    createdByName: year.createdBy.name || year.createdBy.email,
    categoryCount: year._count.categories,
  }));
}

export async function getPlanYear(planYearId: string) {
  await requirePlanningView();
  const planYear = await prisma.planYear.findUnique({
    where: { id: planYearId },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      categories: {
        orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: {
          monthlyTargets: {
            orderBy: { month: 'asc' },
            select: { month: true, targetQty: true, isManualOverride: true },
          },
          stages: {
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              name: true,
              targetQty: true,
              targetMonth: true,
              supplierId: true,
              fabricNotes: true,
              colorNotes: true,
              workOrderId: true,
              sortOrder: true,
            },
          },
          colorAllocations: true,
          cmtAllocations: true,
          accessoryPlans: true,
        },
      },
    },
  });
  if (!planYear) throw new Error('Plan year not found');

  const flatCategories = planYear.categories as RawCategory[];
  const { roots, byId } = buildTree(flatCategories);

  const itemIds = collectItemIds(flatCategories);
  const lookup = await loadActualsLookup(planYear.year, itemIds);

  const items =
    itemIds.length > 0
      ? await prisma.item.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, nameId: true },
        })
      : [];
  const itemNames = new Map(items.map((i) => [i.id, i.nameId]));

  const stageWoIds = flatCategories.flatMap((c) =>
    c.stages.map((s) => s.workOrderId).filter((id): id is string => !!id)
  );
  const workOrdersList =
    stageWoIds.length > 0
      ? await prisma.workOrder.findMany({
          where: { id: { in: stageWoIds } },
          select: { id: true, docNumber: true, status: true },
        })
      : [];
  const workOrders = new Map(workOrdersList.map((wo) => [wo.id, wo]));

  const supplierIds = new Set<string>();
  for (const cat of flatCategories) {
    for (const stage of cat.stages) {
      if (stage.supplierId) supplierIds.add(stage.supplierId);
    }
    for (const cmt of cat.cmtAllocations ?? []) {
      supplierIds.add(cmt.supplierId);
    }
  }
  const suppliers =
    supplierIds.size > 0
      ? await prisma.supplier.findMany({
          where: { id: { in: [...supplierIds] } },
          select: { id: true, name: true },
        })
      : [];
  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]));

  const categories = roots.map((root) =>
    enrichCategoryNode(root, byId, lookup, itemNames, supplierNames, workOrders)
  );

  const totalPlan = categories.reduce((sum, c) => sum + c.effectiveTarget, 0);
  const totalActual = categories.reduce((sum, c) => sum + c.actualQty, 0);
  const totalVariance = totalActual - totalPlan;
  const completionPercent = getCompletionPercent(totalActual, totalPlan);

  return {
    id: planYear.id,
    year: planYear.year,
    notes: planYear.notes,
    isLocked: planYear.isLocked,
    createdAt: planYear.createdAt,
    updatedAt: planYear.updatedAt,
    createdBy: {
      id: planYear.createdBy.id,
      name: planYear.createdBy.name || planYear.createdBy.email,
    },
    categories,
    totals: {
      totalPlan,
      totalActual,
      totalVariance,
      completionPercent,
      completionBand: getCompletionBand(completionPercent),
    },
  };
}

export async function createPlanYear(input: { year: number; notes?: string }) {
  const session = await requirePlanningManage();
  const parsed = createPlanYearSchema.parse(input);
  const existing = await prisma.planYear.findUnique({ where: { year: parsed.year } });
  if (existing) throw new Error(`Plan year ${parsed.year} already exists`);

  const created = await prisma.planYear.create({
    data: {
      year: parsed.year,
      notes: parsed.notes || null,
      createdById: session.user.id,
    },
  });
  await logAudit({
    userId: session.user.id,
    action: 'CREATE',
    entityType: 'PlanYear',
    entityId: created.id,
    changes: { after: { year: created.year } },
  });
  revalidatePath(PLANNING_PATH);
  return created;
}

export async function updatePlanYear(
  planYearId: string,
  input: { year?: number; notes?: string | null }
) {
  const session = await requirePlanningManage();
  await requirePlanYearUnlocked(planYearId);
  const before = await prisma.planYear.findUnique({ where: { id: planYearId } });
  const updated = await prisma.planYear.update({
    where: { id: planYearId },
    data: {
      ...(input.year != null ? { year: input.year } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });
  await logAudit({
    userId: session.user.id,
    action: 'UPDATE',
    entityType: 'PlanYear',
    entityId: planYearId,
    changes: { before, after: updated },
  });
  revalidatePath(PLANNING_PATH);
  return updated;
}

export async function deletePlanYear(planYearId: string) {
  const session = await requirePlanningManage();
  await requirePlanYearUnlocked(planYearId);
  await prisma.planYear.delete({ where: { id: planYearId } });
  await logAudit({
    userId: session.user.id,
    action: 'DELETE',
    entityType: 'PlanYear',
    entityId: planYearId,
  });
  revalidatePath(PLANNING_PATH);
}

export async function setPlanYearLock(planYearId: string, isLocked: boolean) {
  const session = await requirePlanningManage();
  if (session.user.role !== 'ADMIN') {
    throw new Error('Only ADMIN can lock or unlock plan year');
  }
  const updated = await prisma.planYear.update({
    where: { id: planYearId },
    data: { isLocked },
  });
  await logAudit({
    userId: session.user.id,
    action: isLocked ? 'LOCK' : 'UNLOCK',
    entityType: 'PlanYear',
    entityId: planYearId,
    changes: { after: { isLocked } },
  });
  revalidatePath(PLANNING_PATH);
  return updated;
}

export async function createPlanCategory(input: {
  planYearId: string;
  code: string;
  name: string;
  description?: string;
  parentId?: string | null;
  targetQty?: number | null;
  parentSharePercent?: number | null;
  itemId?: string | null;
}) {
  const session = await requirePlanningManage();
  const parsed = createPlanCategorySchema.parse(input);
  await requirePlanYearUnlocked(parsed.planYearId);

  if (parsed.parentId) {
    const parent = await validateParentForTwoLevel(parsed.parentId);
    if (parent.planYearId !== parsed.planYearId) {
      throw new Error('Parent must belong to the same plan year');
    }
    const validation = await validateChildSharesForParent(
      parsed.parentId,
      parsed.parentSharePercent ?? 0
    );
    if (!validation.valid) {
      throw new Error(`Child shares exceed 100% (total: ${validation.totalPercent.toFixed(2)}%)`);
    }
  }

  await validateFinishedGoodItem(parsed.itemId ?? null);

  const siblingCount = await prisma.planCategory.count({
    where: { planYearId: parsed.planYearId, parentId: parsed.parentId ?? null },
  });

  const created = await prisma.$transaction(async (tx) => {
    const category = await tx.planCategory.create({
      data: {
        planYearId: parsed.planYearId,
        code: parsed.code,
        name: parsed.name,
        description: parsed.description || null,
        parentId: parsed.parentId ?? null,
        targetQty: parsed.parentId ? null : (parsed.targetQty ?? null),
        parentSharePercent: parsed.parentId ? (parsed.parentSharePercent ?? null) : null,
        itemId: parsed.itemId ?? null,
        sortOrder: siblingCount,
      },
    });
    await tx.planMonthly.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({
        planCategoryId: category.id,
        month: i + 1,
        targetQty: null,
        isManualOverride: false,
      })),
    });
    return category;
  });

  await logAudit({
    userId: session.user.id,
    action: 'CREATE',
    entityType: 'PlanCategory',
    entityId: created.id,
    changes: { after: { code: created.code, name: created.name } },
  });
  revalidatePath(PLANNING_PATH);
  return created;
}

export async function updatePlanCategory(
  categoryId: string,
  input: {
    code?: string;
    name?: string;
    description?: string | null;
    targetQty?: number | null;
    parentSharePercent?: number | null;
    itemId?: string | null;
  }
) {
  const session = await requirePlanningManage();
  const parsed = updatePlanCategorySchema.parse(input);
  const current = await prisma.planCategory.findUnique({
    where: { id: categoryId },
    select: { id: true, planYearId: true, parentId: true },
  });
  if (!current) throw new Error('Category not found');
  await requirePlanYearUnlocked(current.planYearId);

  if (current.parentId && parsed.parentSharePercent != null) {
    const validation = await validateChildSharesForParent(
      current.parentId,
      parsed.parentSharePercent,
      categoryId
    );
    if (!validation.valid) {
      throw new Error(`Child shares exceed 100% (total: ${validation.totalPercent.toFixed(2)}%)`);
    }
  }

  const hasChildren = await prisma.planCategory.count({ where: { parentId: categoryId } });
  if (hasChildren > 0 && parsed.itemId) {
    throw new Error('Parent with children cannot set item directly');
  }

  if (parsed.itemId) await validateFinishedGoodItem(parsed.itemId);

  const before = await prisma.planCategory.findUnique({ where: { id: categoryId } });
  const updated = await prisma.planCategory.update({
    where: { id: categoryId },
    data: {
      ...(parsed.code !== undefined ? { code: parsed.code } : {}),
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      ...(parsed.targetQty !== undefined ? { targetQty: parsed.targetQty } : {}),
      ...(parsed.parentSharePercent !== undefined
        ? { parentSharePercent: parsed.parentSharePercent }
        : {}),
      ...(parsed.itemId !== undefined ? { itemId: parsed.itemId } : {}),
    },
  });
  await logAudit({
    userId: session.user.id,
    action: 'UPDATE',
    entityType: 'PlanCategory',
    entityId: categoryId,
    changes: { before, after: updated },
  });
  revalidatePath(PLANNING_PATH);
  return updated;
}

export async function deletePlanCategory(categoryId: string) {
  const session = await requirePlanningManage();
  const current = await prisma.planCategory.findUnique({
    where: { id: categoryId },
    select: { planYearId: true, code: true },
  });
  if (!current) throw new Error('Category not found');
  await requirePlanYearUnlocked(current.planYearId);
  await prisma.planCategory.delete({ where: { id: categoryId } });
  await logAudit({
    userId: session.user.id,
    action: 'DELETE',
    entityType: 'PlanCategory',
    entityId: categoryId,
    changes: { before: { code: current.code } },
  });
  revalidatePath(PLANNING_PATH);
}

export async function reorderPlanCategories(
  planYearId: string,
  parentId: string | null,
  orderedIds: string[]
) {
  const session = await requirePlanningManage();
  await requirePlanYearUnlocked(planYearId);
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.planCategory.update({
        where: { id },
        data: { sortOrder: index },
      })
    )
  );
  await logAudit({
    userId: session.user.id,
    action: 'UPDATE',
    entityType: 'PlanCategory',
    entityId: planYearId,
    metadata: { reorder: orderedIds },
  });
  revalidatePath(PLANNING_PATH);
}

export async function setMonthlyOverride(input: {
  planCategoryId: string;
  month: number;
  targetQty: number;
  notes?: string;
}) {
  const session = await requirePlanningManage();
  const parsed = updateMonthlyTargetSchema.parse(input);
  const category = await prisma.planCategory.findUnique({
    where: { id: parsed.planCategoryId },
    select: { planYearId: true },
  });
  if (!category) throw new Error('Category not found');
  await requirePlanYearUnlocked(category.planYearId);

  const monthly = await prisma.planMonthly.upsert({
    where: {
      planCategoryId_month: {
        planCategoryId: parsed.planCategoryId,
        month: parsed.month,
      },
    },
    update: {
      targetQty: parsed.targetQty,
      isManualOverride: true,
      notes: parsed.notes || null,
    },
    create: {
      planCategoryId: parsed.planCategoryId,
      month: parsed.month,
      targetQty: parsed.targetQty,
      isManualOverride: true,
      notes: parsed.notes || null,
    },
  });
  await logAudit({
    userId: session.user.id,
    action: 'UPDATE',
    entityType: 'PlanMonthly',
    entityId: monthly.id,
    metadata: { month: parsed.month, targetQty: parsed.targetQty, isManualOverride: true },
  });
  revalidatePath(PLANNING_PATH);
  return monthly;
}

export async function resetMonthlyOverride(planCategoryId: string, month: number) {
  const session = await requirePlanningManage();
  const category = await prisma.planCategory.findUnique({
    where: { id: planCategoryId },
    select: { planYearId: true },
  });
  if (!category) throw new Error('Category not found');
  await requirePlanYearUnlocked(category.planYearId);

  const monthly = await prisma.planMonthly.upsert({
    where: {
      planCategoryId_month: { planCategoryId, month },
    },
    update: { targetQty: null, isManualOverride: false, notes: null },
    create: { planCategoryId, month, targetQty: null, isManualOverride: false, notes: null },
  });
  await logAudit({
    userId: session.user.id,
    action: 'UPDATE',
    entityType: 'PlanMonthly',
    entityId: monthly.id,
    metadata: { month, reset: true },
  });
  revalidatePath(PLANNING_PATH);
  return monthly;
}

export async function resetMonthlyToAuto(planCategoryId: string) {
  const session = await requirePlanningManage();
  const category = await prisma.planCategory.findUnique({
    where: { id: planCategoryId },
    select: { planYearId: true },
  });
  if (!category) throw new Error('Category not found');
  await requirePlanYearUnlocked(category.planYearId);

  await prisma.planMonthly.updateMany({
    where: { planCategoryId },
    data: { targetQty: null, isManualOverride: false, notes: null },
  });
  await logAudit({
    userId: session.user.id,
    action: 'UPDATE',
    entityType: 'PlanMonthly',
    entityId: planCategoryId,
    metadata: { bulkReset: true },
  });
  revalidatePath(PLANNING_PATH);
}

export async function createPlanStage(input: {
  planCategoryId: string;
  name: string;
  targetQty: number;
  targetMonth?: number | null;
  supplierId?: string | null;
  fabricNotes?: string;
  colorNotes?: string;
}) {
  const session = await requirePlanningManage();
  const parsed = createPlanStageSchema.parse(input);
  const category = await prisma.planCategory.findUnique({
    where: { id: parsed.planCategoryId },
    select: { planYearId: true },
  });
  if (!category) throw new Error('Category not found');
  await requirePlanYearUnlocked(category.planYearId);
  await validateTailorSupplier(parsed.supplierId ?? null);

  const sortOrder = await prisma.planStage.count({
    where: { planCategoryId: parsed.planCategoryId },
  });
  const created = await prisma.planStage.create({
    data: {
      planCategoryId: parsed.planCategoryId,
      name: parsed.name,
      targetQty: parsed.targetQty,
      targetMonth: parsed.targetMonth ?? null,
      supplierId: parsed.supplierId ?? null,
      fabricNotes: parsed.fabricNotes ?? null,
      colorNotes: parsed.colorNotes ?? null,
      sortOrder,
    },
  });
  await logAudit({
    userId: session.user.id,
    action: 'CREATE',
    entityType: 'PlanStage',
    entityId: created.id,
    changes: { after: { name: created.name } },
  });
  revalidatePath(PLANNING_PATH);
  return created;
}

export async function updatePlanStage(
  stageId: string,
  input: {
    name?: string;
    targetQty?: number;
    targetMonth?: number | null;
    supplierId?: string | null;
    fabricNotes?: string | null;
    colorNotes?: string | null;
  }
) {
  const session = await requirePlanningManage();
  const parsed = updatePlanStageSchema.parse(input);
  const stage = await prisma.planStage.findUnique({
    where: { id: stageId },
    include: { planCategory: { select: { planYearId: true } } },
  });
  if (!stage) throw new Error('Stage not found');
  await requirePlanYearUnlocked(stage.planCategory.planYearId);
  if (parsed.supplierId) await validateTailorSupplier(parsed.supplierId);

  const before = await prisma.planStage.findUnique({ where: { id: stageId } });
  const updated = await prisma.planStage.update({
    where: { id: stageId },
    data: {
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.targetQty !== undefined ? { targetQty: parsed.targetQty } : {}),
      ...(parsed.targetMonth !== undefined ? { targetMonth: parsed.targetMonth } : {}),
      ...(parsed.supplierId !== undefined ? { supplierId: parsed.supplierId } : {}),
      ...(parsed.fabricNotes !== undefined ? { fabricNotes: parsed.fabricNotes } : {}),
      ...(parsed.colorNotes !== undefined ? { colorNotes: parsed.colorNotes } : {}),
    },
  });
  await logAudit({
    userId: session.user.id,
    action: 'UPDATE',
    entityType: 'PlanStage',
    entityId: stageId,
    changes: { before, after: updated },
  });
  revalidatePath(PLANNING_PATH);
  return updated;
}

export async function deletePlanStage(stageId: string) {
  const session = await requirePlanningManage();
  const stage = await prisma.planStage.findUnique({
    where: { id: stageId },
    include: { planCategory: { select: { planYearId: true } } },
  });
  if (!stage) throw new Error('Stage not found');
  await requirePlanYearUnlocked(stage.planCategory.planYearId);
  await prisma.planStage.delete({ where: { id: stageId } });
  await logAudit({
    userId: session.user.id,
    action: 'DELETE',
    entityType: 'PlanStage',
    entityId: stageId,
  });
  revalidatePath(PLANNING_PATH);
}

export async function reorderPlanStages(planCategoryId: string, orderedIds: string[]) {
  const session = await requirePlanningManage();
  const category = await prisma.planCategory.findUnique({
    where: { id: planCategoryId },
    select: { planYearId: true },
  });
  if (!category) throw new Error('Category not found');
  await requirePlanYearUnlocked(category.planYearId);

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.planStage.update({
        where: { id },
        data: { sortOrder: index },
      })
    )
  );
  await logAudit({
    userId: session.user.id,
    action: 'UPDATE',
    entityType: 'PlanStage',
    entityId: planCategoryId,
    metadata: { reorder: orderedIds },
  });
  revalidatePath(PLANNING_PATH);
}

export async function getPlanDashboard(planYearId: string) {
  const plan = await getPlanYear(planYearId);
  const rows: Array<{
    id: string;
    code: string;
    name: string;
    parentName: string | null;
    isParent: boolean;
    effectiveTarget: number;
    actualQty: number;
    gapQty: number;
    variance: number;
    completionPercent: number;
    completionBand: 'red' | 'yellow' | 'green';
  }> = [];

  const visitParents = (node: (typeof plan.categories)[0], parentName: string | null = null) => {
    const hasChildren = (node.children?.length ?? 0) > 0;
    if (hasChildren || node.effectiveTarget > 0 || node.actualQty > 0) {
      rows.push({
        id: node.id,
        code: node.code,
        name: node.name,
        parentName,
        isParent: hasChildren,
        effectiveTarget: node.effectiveTarget,
        actualQty: node.actualQty,
        gapQty: node.effectiveTarget - node.actualQty,
        variance: node.variance,
        completionPercent: node.completionPercent,
        completionBand: node.completionBand,
      });
    }
    if (hasChildren) {
      for (const child of node.children) {
        rows.push({
          id: child.id,
          code: child.code,
          name: child.name,
          parentName: node.name,
          isParent: false,
          effectiveTarget: child.effectiveTarget,
          actualQty: child.actualQty,
          gapQty: child.effectiveTarget - child.actualQty,
          variance: child.variance,
          completionPercent: child.completionPercent,
          completionBand: child.completionBand,
        });
      }
    }
  };

  for (const category of plan.categories) {
    visitParents(category);
  }

  rows.sort((a, b) => a.completionPercent - b.completionPercent);

  const monthlyTimeline = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    let planQty = 0;
    let actualQtySum = 0;
    type EnrichedCat = Awaited<ReturnType<typeof getPlanYear>>['categories'][number];
    const sumLeaves = (nodes: EnrichedCat[]) => {
      for (const node of nodes) {
        if (node.children.length > 0) {
          sumLeaves(node.children);
        } else {
          const monthly = node.monthlyTargetsComputed.find((m: { month: number }) => m.month === month);
          planQty += monthly?.targetQty ?? 0;
          const actualMonth = node.monthlyActuals.find((m: { month: number }) => m.month === month);
          actualQtySum += actualMonth?.actual ?? 0;
        }
      }
    };
    sumLeaves(plan.categories);
    return { month, plan: planQty, actual: actualQtySum };
  });

  return {
    year: plan.year,
    kpi: {
      totalPlan: plan.totals.totalPlan,
      totalActual: plan.totals.totalActual,
      totalGap: plan.totals.totalPlan - plan.totals.totalActual,
      totalVariance: plan.totals.totalVariance,
      completionPercent: plan.totals.completionPercent,
      completionBand: plan.totals.completionBand,
    },
    rows,
    monthlyTimeline,
    parentChart: plan.categories.map((c) => ({
      code: c.code,
      name: c.name,
      plan: c.effectiveTarget,
      actual: c.actualQty,
    })),
  };
}

export async function upsertColorAllocations(
  planCategoryId: string,
  allocations: Array<{
    colorName: string;
    colorCode?: string;
    allocatedQty: number;
    notes?: string;
  }>
) {
  const session = await requirePlanningManage();
  const parsed = upsertColorAllocationsSchema.parse({ planCategoryId, allocations });
  const category = await prisma.planCategory.findUnique({
    where: { id: planCategoryId },
    include: { parent: true, monthlyTargets: true },
  });
  if (!category) throw new Error('Category not found');
  await requirePlanYearUnlocked(category.planYearId);

  const planningNode: PlanningCategoryNode = {
    id: category.id,
    parentId: category.parentId,
    targetQty: category.targetQty,
    parentSharePercent: category.parentSharePercent,
    itemId: category.itemId,
    parent: category.parent ? { targetQty: category.parent.targetQty } : null,
  };
  const effectiveTarget = getEffectiveTarget(planningNode);
  const sumAllocated = parsed.allocations.reduce((s, a) => s + a.allocatedQty, 0);

  await prisma.$transaction([
    prisma.planColorAllocation.deleteMany({ where: { planCategoryId } }),
    ...parsed.allocations.map((row) =>
      prisma.planColorAllocation.create({
        data: {
          planCategoryId,
          colorName: row.colorName,
          colorCode: row.colorCode ?? null,
          allocatedQty: row.allocatedQty,
          notes: row.notes ?? null,
        },
      })
    ),
  ]);

  await logAudit({
    userId: session.user.id,
    action: 'UPDATE',
    entityType: 'PlanColorAllocation',
    entityId: planCategoryId,
    metadata: { count: parsed.allocations.length },
  });
  revalidatePath(PLANNING_PATH);

  const warning =
    sumAllocated !== effectiveTarget
      ? `Total alokasi (${sumAllocated}) berbeda dari target (${effectiveTarget})`
      : undefined;
  return { success: true as const, warning };
}

export async function upsertCmtAllocations(
  planCategoryId: string,
  allocations: Array<{ supplierId: string; allocatedQty: number; notes?: string }>
) {
  const session = await requirePlanningManage();
  const parsed = upsertCmtAllocationsSchema.parse({ planCategoryId, allocations });
  const category = await prisma.planCategory.findUnique({
    where: { id: planCategoryId },
    include: { parent: true },
  });
  if (!category) throw new Error('Category not found');
  await requirePlanYearUnlocked(category.planYearId);

  for (const row of parsed.allocations) {
    await validateTailorSupplier(row.supplierId);
  }

  const planningNode: PlanningCategoryNode = {
    id: category.id,
    parentId: category.parentId,
    targetQty: category.targetQty,
    parentSharePercent: category.parentSharePercent,
    itemId: category.itemId,
    parent: category.parent ? { targetQty: category.parent.targetQty } : null,
  };
  const effectiveTarget = getEffectiveTarget(planningNode);
  const sumAllocated = parsed.allocations.reduce((s, a) => s + a.allocatedQty, 0);

  await prisma.$transaction([
    prisma.planCmtAllocation.deleteMany({ where: { planCategoryId } }),
    ...parsed.allocations.map((row) =>
      prisma.planCmtAllocation.create({
        data: {
          planCategoryId,
          supplierId: row.supplierId,
          allocatedQty: row.allocatedQty,
          notes: row.notes ?? null,
        },
      })
    ),
  ]);

  await logAudit({
    userId: session.user.id,
    action: 'UPDATE',
    entityType: 'PlanCmtAllocation',
    entityId: planCategoryId,
    metadata: { count: parsed.allocations.length },
  });
  revalidatePath(PLANNING_PATH);

  const warning =
    sumAllocated !== effectiveTarget
      ? `Total alokasi (${sumAllocated}) berbeda dari target (${effectiveTarget})`
      : undefined;
  return { success: true as const, warning };
}

export async function upsertAccessoryPlans(
  planCategoryId: string,
  plans: Array<{ itemId: string; qtyPerPcs: number; notes?: string }>
) {
  const session = await requirePlanningManage();
  const parsed = upsertAccessoryPlansSchema.parse({ planCategoryId, plans });
  const category = await prisma.planCategory.findUnique({
    where: { id: planCategoryId },
    include: { parent: true },
  });
  if (!category) throw new Error('Category not found');
  await requirePlanYearUnlocked(category.planYearId);

  const planningNode: PlanningCategoryNode = {
    id: category.id,
    parentId: category.parentId,
    targetQty: category.targetQty,
    parentSharePercent: category.parentSharePercent,
    itemId: category.itemId,
    parent: category.parent ? { targetQty: category.parent.targetQty } : null,
  };
  const effectiveTarget = getEffectiveTarget(planningNode);

  for (const row of parsed.plans) {
    const item = await prisma.item.findUnique({
      where: { id: row.itemId },
      select: { type: true },
    });
    if (!item || item.type !== ItemType.ACCESSORIES) {
      throw new Error('Accessory item must be type ACCESSORIES');
    }
  }

  await prisma.$transaction([
    prisma.planAccessory.deleteMany({ where: { planCategoryId } }),
    ...parsed.plans.map((row) =>
      prisma.planAccessory.create({
        data: {
          planCategoryId,
          itemId: row.itemId,
          qtyPerPcs: row.qtyPerPcs,
          totalQtyNeeded: Math.round(effectiveTarget * row.qtyPerPcs),
          notes: row.notes ?? null,
        },
      })
    ),
  ]);

  await logAudit({
    userId: session.user.id,
    action: 'UPDATE',
    entityType: 'PlanAccessory',
    entityId: planCategoryId,
    metadata: { count: parsed.plans.length },
  });
  revalidatePath(PLANNING_PATH);
  return { success: true as const };
}

export async function suggestAccessoryFromBom(planCategoryId: string) {
  await requirePlanningView();
  const category = await prisma.planCategory.findUnique({
    where: { id: planCategoryId },
    include: { parent: true },
  });
  if (!category?.itemId) {
    throw new Error('Category must be linked to a finished good item');
  }

  const planningNode: PlanningCategoryNode = {
    id: category.id,
    parentId: category.parentId,
    targetQty: category.targetQty,
    parentSharePercent: category.parentSharePercent,
    itemId: category.itemId,
    parent: category.parent ? { targetQty: category.parent.targetQty } : null,
  };
  const effectiveTarget = getEffectiveTarget(planningNode);
  const bom = await generateMaterialPlan(category.itemId, new Decimal(effectiveTarget));
  const itemIds = bom.map((row) => row.itemId);
  const accessoryItems =
    itemIds.length > 0
      ? await prisma.item.findMany({
          where: { id: { in: itemIds }, type: ItemType.ACCESSORIES },
          select: { id: true },
        })
      : [];
  const accessoryIdSet = new Set(accessoryItems.map((item) => item.id));

  return bom
    .filter((row) => accessoryIdSet.has(row.itemId))
    .map((row) => ({
      itemId: row.itemId,
      itemName: row.itemName,
      qtyPerPcs: Number(row.qtyRequired.toString()),
      totalQtyNeeded: Math.round(effectiveTarget * Number(row.qtyRequired.toString())),
    }));
}

export async function downloadPlanTemplate() {
  await requirePlanningView();
  const buffer = buildPlanTemplateWorkbook();
  return {
    base64: buffer.toString('base64'),
    filename: `plan-kerja-template.xlsx`,
  };
}

export async function importPlanFromExcel(planYearId: string, base64: string) {
  const session = await requirePlanningManage();
  await requirePlanYearUnlocked(planYearId);
  const buffer = Buffer.from(base64, 'base64');
  const { rows, errors: parseErrors } = parsePlanExcelBuffer(buffer);

  let created = 0;
  let updated = 0;
  const errors = [...parseErrors];
  const codeToId = new Map<string, string>();

  const existing = await prisma.planCategory.findMany({
    where: { planYearId },
    select: { id: true, code: true },
  });
  for (const cat of existing) codeToId.set(cat.code, cat.id);

  const items = await prisma.item.findMany({
    where: { type: ItemType.FINISHED_GOOD },
    select: { id: true, sku: true },
  });
  const skuToId = new Map(items.map((i) => [i.sku, i.id]));

  for (const row of rows) {
    try {
      const parentId = row.parentCode ? codeToId.get(row.parentCode) : null;
      if (row.parentCode && !parentId) {
        errors.push({ row: row.rowNumber, message: `Parent code ${row.parentCode} not found` });
        continue;
      }

      const itemId = row.itemSku ? skuToId.get(row.itemSku) : undefined;
      if (row.itemSku && !itemId) {
        errors.push({ row: row.rowNumber, message: `SKU ${row.itemSku} not found` });
        continue;
      }

      const existingId = codeToId.get(row.code);
      if (existingId) {
        await updatePlanCategory(existingId, {
          name: row.name,
          description: row.description,
          ...(parentId
            ? { parentSharePercent: row.parentSharePercent ?? undefined }
            : { targetQty: row.targetQty ?? undefined }),
          itemId: itemId ?? undefined,
        });
        updated += 1;
      } else {
        const createdCat = await createPlanCategory({
          planYearId,
          code: row.code,
          name: row.name,
          description: row.description,
          parentId: parentId ?? null,
          targetQty: parentId ? null : (row.targetQty ?? 0),
          parentSharePercent: parentId ? (row.parentSharePercent ?? 0) : null,
          itemId: itemId ?? null,
        });
        codeToId.set(row.code, createdCat.id);
        created += 1;
      }
    } catch (err) {
      errors.push({
        row: row.rowNumber,
        message: err instanceof Error ? err.message : 'Import failed',
      });
    }
  }

  await logAudit({
    userId: session.user.id,
    action: 'IMPORT',
    entityType: 'PlanYear',
    entityId: planYearId,
    metadata: { created, updated, errorCount: errors.length },
  });
  revalidatePath(PLANNING_PATH);
  return { success: errors.length === 0, created, updated, errors };
}

export async function createWorkOrderFromStage(stageId: string) {
  const session = await requirePlanningManage();
  requirePermission(session.user.permissions, PERMISSIONS.WORK_ORDERS_CREATE);

  const stage = await prisma.planStage.findUnique({
    where: { id: stageId },
    include: {
      planCategory: { select: { itemId: true, code: true } },
    },
  });
  if (!stage) throw new Error('Stage not found');
  if (!stage.supplierId) {
    throw new Error('Pilih vendor CMT di tahap ini sebelum membuat Work Order.');
  }
  if (!stage.planCategory.itemId) {
    throw new Error('Kategori harus terhubung ke item barang jadi sebelum membuat Work Order.');
  }

  if (stage.workOrderId) {
    const existingWo = await prisma.workOrder.findUnique({
      where: { id: stage.workOrderId },
      select: { docNumber: true, status: true },
    });
    if (existingWo && existingWo.status !== 'CANCELLED') {
      throw new Error(
        `Tahap ini sudah memiliki Work Order aktif (${existingWo.docNumber}).`
      );
    }
  }

  const result = await createWorkOrder(
    {
      vendorId: stage.supplierId,
      finishedGoodId: stage.planCategory.itemId,
      outputMode: 'GENERIC',
      plannedQty: stage.targetQty,
      targetDate: undefined,
      notes: `Created from Plan Kerja stage: ${stage.name}`,
    },
    session.user.id,
    { skipStockCheck: true }
  );

  await prisma.planStage.update({
    where: { id: stage.id },
    data: { workOrderId: result.id },
  });

  await logAudit({
    userId: session.user.id,
    action: 'CREATE',
    entityType: 'WorkOrder',
    entityId: result.id,
    metadata: { source: 'PlanStage', stageId },
  });

  revalidatePath(PLANNING_PATH);
  redirect(`/backoffice/work-orders/${result.id}`);
}

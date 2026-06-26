"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ItemType } from "@elorae/db";
import { auth } from "@/lib/auth";
import { prisma } from "@elorae/db";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";
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
  getMonthlyTarget,
  getVariantActualFromLookup,
  validateChildShares,
  type ActualsLookup,
  type PlanningCategoryNode,
  type PlanningMonthlyRow,
} from "@/lib/planning/calculations";
import {
  buildWoPayloadFromCmtRow,
  stageNameFromAllocation,
  validateCmtAllocations,
  validateMonthlyColorAllocations,
} from "@/lib/planning/allocations";
import { buildPlanTemplateWorkbook, parsePlanExcelBuffer } from "@/lib/planning/excel-parser";
import { planCodeFromItemCategory } from "@/lib/planning/item-category";
import { parseItemVariants, variantSelectOptions } from "@/lib/items/variants";
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
  upsertMonthlyCmtAllocationsSchema,
  upsertMonthlyColorAllocationsSchema,
} from "@/lib/validations/planning";
import { createWorkOrder } from "@/app/actions/production";
import { generateMaterialPlan } from "@/lib/production/planning";
import { Decimal } from "decimal.js";

const PLANNING_PATH = "/backoffice/production/planning";

function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value === "object" && value && "toString" in value) {
    return Number(String(value));
  }
  return 0;
}

async function requirePlanningView() {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.PRODUCTION_PLANNING_VIEW);
  return session;
}

async function requirePlanningManage() {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.PRODUCTION_PLANNING_MANAGE);
  return session;
}

async function requirePlanYearEditable(planYearId: string) {
  const planYear = await prisma.planYear.findUnique({
    where: { id: planYearId },
    select: { id: true, isLocked: true, status: true },
  });
  if (!planYear) throw new Error("Plan year not found");
  if (planYear.isLocked || planYear.status !== "DRAFT") {
    throw new Error("Plan year must be in DRAFT status and unlocked for edits");
  }
  return planYear;
}

async function requirePlanYearActive(planYearId: string) {
  const planYear = await prisma.planYear.findUnique({
    where: { id: planYearId },
    select: { id: true, isLocked: true, status: true, year: true },
  });
  if (!planYear) throw new Error("Plan year not found");
  if (planYear.status !== "ACTIVE" || !planYear.isLocked) {
    throw new Error("Plan year must be ACTIVE (locked) to generate work orders");
  }
  return planYear;
}

async function requirePlanYearUnlocked(planYearId: string) {
  return requirePlanYearEditable(planYearId);
}

async function validateParentForTwoLevel(parentId: string) {
  const parent = await prisma.planCategory.findUnique({
    where: { id: parentId },
    select: { id: true, parentId: true, planYearId: true },
  });
  if (!parent) throw new Error("Parent category not found");
  if (parent.parentId) throw new Error("Only two levels are allowed");
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
  if (!item) throw new Error("Item not found");
  if (item.type !== ItemType.FINISHED_GOOD) {
    throw new Error("Item must be a finished good");
  }
}

async function validateTailorSupplier(supplierId: string | null | undefined) {
  if (!supplierId) return;
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    include: { type: { select: { code: true } } },
  });
  if (!supplier) throw new Error("Supplier not found");
  if (supplier.type.code !== "TAILOR") {
    throw new Error("Supplier must be type TAILOR");
  }
}

async function loadActualsLookup(year: number, itemIds: string[]): Promise<ActualsLookup> {
  if (itemIds.length === 0) {
    return { yearlyByItem: new Map(), monthlyByItem: new Map(), monthlyByVariant: new Map() };
  }
  const { start, endExclusive } = getJakartaYearBounds(year);
  const receipts = await prisma.fGReceipt.findMany({
    where: {
      wo: {
        finishedGoodId: { in: itemIds },
        status: { not: "CANCELLED" },
      },
      receivedAt: { gte: start, lt: endExclusive },
    },
    select: {
      qtyAccepted: true,
      receivedAt: true,
      skuBreakdown: true,
      wo: { select: { finishedGoodId: true } },
    },
  });
  return buildActualsLookup(
    receipts.map((r) => ({
      finishedGoodId: r.wo.finishedGoodId,
      qtyAccepted: r.qtyAccepted,
      receivedAt: r.receivedAt,
      skuBreakdown: r.skuBreakdown,
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
  itemCategoryId: string | null;
  itemCategory?: { id: string; code: string | null; name: string } | null;
  sortOrder: number;
  monthlyTargets: PlanningMonthlyRow[];
  stages: Array<{
    id: string;
    name: string;
    targetQty: number;
    targetMonth: number | null;
    variantSku: string | null;
    supplierId: string | null;
    fabricNotes: string | null;
    colorNotes: string | null;
    workOrderId: string | null;
    planCmtAllocationId: string | null;
    sortOrder: number;
  }>;
  colorAllocations?: Array<{
    id: string;
    month: number;
    variantSku: string;
    colorLabel: string | null;
    allocatedQty: number;
    notes: string | null;
  }>;
  cmtAllocations?: Array<{
    id: string;
    month: number;
    variantSku: string;
    supplierId: string;
    allocatedQty: number;
    workOrderId: string | null;
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
  itemVariants: Array<{ variantSku: string; label: string }>;
  itemCategoryId: string | null;
  itemCategoryCode: string | null;
  itemCategoryName: string | null;
  sortOrder: number;
  effectiveTarget: number;
  actualQty: number;
  variance: number;
  completionPercent: number;
  completionBand: "red" | "yellow" | "green";
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
    variantSku: string | null;
    supplierId: string | null;
    fabricNotes: string | null;
    colorNotes: string | null;
    workOrderId: string | null;
    sortOrder: number;
    supplierName: string | null;
    workOrderDocNumber: string | null;
    workOrderStatus: string | null;
    planCmtAllocationId: string | null;
  }>;
  colorAllocations: NonNullable<RawCategory["colorAllocations"]>;
  cmtAllocations: NonNullable<RawCategory["cmtAllocations"]>;
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
  itemVariants: Map<string, Array<{ variantSku: string; label: string }>>,
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
      itemVariants,
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
    itemVariants: node.itemId ? itemVariants.get(node.itemId) ?? [] : [],
    itemCategoryId: node.itemCategoryId,
    itemCategoryCode: node.itemCategory?.code ?? null,
    itemCategoryName: node.itemCategory?.name ?? null,
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
            planCmtAllocationId: stage.planCmtAllocationId ?? null,
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
    orderBy: { year: "desc" },
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
        orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          monthlyTargets: {
            orderBy: { month: "asc" },
            select: { month: true, targetQty: true, isManualOverride: true },
          },
          stages: {
            orderBy: { sortOrder: "asc" },
            select: {
              id: true,
              name: true,
              targetQty: true,
              targetMonth: true,
              variantSku: true,
              supplierId: true,
              fabricNotes: true,
              colorNotes: true,
              workOrderId: true,
              planCmtAllocationId: true,
              sortOrder: true,
            },
          },
          colorAllocations: { orderBy: [{ month: "asc" }, { variantSku: "asc" }] },
          cmtAllocations: { orderBy: [{ month: "asc" }, { variantSku: "asc" }] },
          accessoryPlans: true,
          itemCategory: { select: { id: true, code: true, name: true } },
        },
      },
    },
  });
  if (!planYear) throw new Error("Plan year not found");

  const flatCategories = planYear.categories as RawCategory[];
  const { roots, byId } = buildTree(flatCategories);

  const itemIds = collectItemIds(flatCategories);
  const lookup = await loadActualsLookup(planYear.year, itemIds);

  const items =
    itemIds.length > 0
      ? await prisma.item.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, nameId: true, variants: true },
        })
      : [];
  const itemNames = new Map(items.map((i) => [i.id, i.nameId]));
  const itemVariants = new Map(
    items.map((i) => [
      i.id,
      variantSelectOptions(parseItemVariants(i.variants)).map((option) => ({
        variantSku: option.sku,
        label: option.label,
      })),
    ])
  );

  const stageWoIds = flatCategories.flatMap((c) => [
    ...c.stages.map((s) => s.workOrderId).filter((id): id is string => !!id),
    ...(c.cmtAllocations ?? [])
      .map((cmt) => cmt.workOrderId)
      .filter((id): id is string => !!id),
  ]);
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
    enrichCategoryNode(root, byId, lookup, itemNames, itemVariants, supplierNames, workOrders)
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
    status: planYear.status,
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
    action: "CREATE",
    entityType: "PlanYear",
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
    action: "UPDATE",
    entityType: "PlanYear",
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
    action: "DELETE",
    entityType: "PlanYear",
    entityId: planYearId,
  });
  revalidatePath(PLANNING_PATH);
}

export async function setPlanYearLock(planYearId: string, isLocked: boolean) {
  const session = await requirePlanningManage();
  if (session.user.role !== "ADMIN") {
    throw new Error("Only ADMIN can lock or unlock plan year");
  }
  const updated = await prisma.planYear.update({
    where: { id: planYearId },
    data: { isLocked },
  });
  await logAudit({
    userId: session.user.id,
    action: isLocked ? "LOCK" : "UNLOCK",
    entityType: "PlanYear",
    entityId: planYearId,
    changes: { after: { isLocked } },
  });
  revalidatePath(PLANNING_PATH);
  return updated;
}

async function loadItemCategoryForPlan(itemCategoryId: string) {
  const row = await prisma.itemCategory.findFirst({
    where: { id: itemCategoryId, isActive: true },
  });
  if (!row) throw new Error("Item category not found or inactive");
  return row;
}

async function assertRootItemCategoryAvailable(
  planYearId: string,
  itemCategoryId: string,
  excludeCategoryId?: string
) {
  const dup = await prisma.planCategory.findFirst({
    where: {
      planYearId,
      parentId: null,
      itemCategoryId,
      ...(excludeCategoryId ? { id: { not: excludeCategoryId } } : {}),
    },
  });
  if (dup) throw new Error("Item category already used in this plan year");
}

export async function createPlanCategory(input: {
  planYearId: string;
  itemCategoryId?: string | null;
  code?: string;
  name?: string;
  description?: string;
  parentId?: string | null;
  targetQty?: number | null;
  parentSharePercent?: number | null;
  itemId?: string | null;
}) {
  const session = await requirePlanningManage();
  const parsed = createPlanCategorySchema.parse(input);
  await requirePlanYearUnlocked(parsed.planYearId);

  let code: string;
  let name: string;
  let itemCategoryId: string | null = null;

  if (!parsed.parentId) {
    itemCategoryId = parsed.itemCategoryId!;
    const itemCategory = await loadItemCategoryForPlan(itemCategoryId);
    await assertRootItemCategoryAvailable(parsed.planYearId, itemCategoryId);
    code = planCodeFromItemCategory(itemCategory);
    name = itemCategory.name;
  } else {
    code = parsed.code!.trim();
    name = parsed.name!.trim();
  }

  if (parsed.parentId) {
    const parent = await validateParentForTwoLevel(parsed.parentId);
    if (parent.planYearId !== parsed.planYearId) {
      throw new Error("Parent must belong to the same plan year");
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
        code,
        name,
        description: parsed.description || null,
        parentId: parsed.parentId ?? null,
        targetQty: parsed.parentId ? null : (parsed.targetQty ?? null),
        parentSharePercent: parsed.parentId ? (parsed.parentSharePercent ?? null) : null,
        itemId: parsed.itemId ?? null,
        itemCategoryId,
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
    action: "CREATE",
    entityType: "PlanCategory",
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
    select: { id: true, planYearId: true, parentId: true, itemCategoryId: true },
  });
  if (!current) throw new Error("Category not found");
  await requirePlanYearUnlocked(current.planYearId);

  if (
    current.itemCategoryId &&
    !current.parentId &&
    (parsed.code !== undefined || parsed.name !== undefined)
  ) {
    throw new Error("Cannot edit code or name for a category linked to item master");
  }

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
    throw new Error("Parent with children cannot set item directly");
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
    action: "UPDATE",
    entityType: "PlanCategory",
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
  if (!current) throw new Error("Category not found");
  await requirePlanYearUnlocked(current.planYearId);
  await prisma.planCategory.delete({ where: { id: categoryId } });
  await logAudit({
    userId: session.user.id,
    action: "DELETE",
    entityType: "PlanCategory",
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
    action: "UPDATE",
    entityType: "PlanCategory",
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
  if (!category) throw new Error("Category not found");
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
    action: "UPDATE",
    entityType: "PlanMonthly",
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
  if (!category) throw new Error("Category not found");
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
    action: "UPDATE",
    entityType: "PlanMonthly",
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
  if (!category) throw new Error("Category not found");
  await requirePlanYearUnlocked(category.planYearId);

  await prisma.planMonthly.updateMany({
    where: { planCategoryId },
    data: { targetQty: null, isManualOverride: false, notes: null },
  });
  await logAudit({
    userId: session.user.id,
    action: "UPDATE",
    entityType: "PlanMonthly",
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
  if (!category) throw new Error("Category not found");
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
    action: "CREATE",
    entityType: "PlanStage",
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
  if (!stage) throw new Error("Stage not found");
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
    action: "UPDATE",
    entityType: "PlanStage",
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
  if (!stage) throw new Error("Stage not found");
  await requirePlanYearUnlocked(stage.planCategory.planYearId);
  await prisma.planStage.delete({ where: { id: stageId } });
  await logAudit({
    userId: session.user.id,
    action: "DELETE",
    entityType: "PlanStage",
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
  if (!category) throw new Error("Category not found");
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
    action: "UPDATE",
    entityType: "PlanStage",
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
    completionBand: "red" | "yellow" | "green";
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
    type EnrichedCat = Awaited<ReturnType<typeof getPlanYear>>["categories"][number];
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

  const itemIds = collectItemIds(plan.categories);
  const lookup = await loadActualsLookup(plan.year, itemIds);
  const variantRows: Array<{
    categoryId: string;
    categoryCode: string;
    categoryName: string;
    month: number;
    variantSku: string;
    colorLabel: string | null;
    planQty: number;
    actualQty: number;
    completionPercent: number;
    completionBand: "red" | "yellow" | "green";
  }> = [];

  const visitVariantRows = (nodes: (typeof plan.categories)[number]["children"]) => {
    for (const node of nodes) {
      if (node.children.length > 0) {
        visitVariantRows(node.children);
        continue;
      }
      if (!node.itemId) continue;
      for (const color of node.colorAllocations) {
        const actualQty = getVariantActualFromLookup(
          lookup,
          node.itemId,
          color.variantSku,
          color.month
        );
        const completionPercent = getCompletionPercent(actualQty, color.allocatedQty);
        variantRows.push({
          categoryId: node.id,
          categoryCode: node.code,
          categoryName: node.name,
          month: color.month,
          variantSku: color.variantSku,
          colorLabel: color.colorLabel,
          planQty: color.allocatedQty,
          actualQty,
          completionPercent,
          completionBand: getCompletionBand(completionPercent),
        });
      }
    }
  };
  for (const root of plan.categories) {
    if (root.children.length > 0) visitVariantRows(root.children);
    else visitVariantRows([root]);
  }

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
    variantRows,
    monthlyTimeline,
    parentChart: plan.categories.map((c) => ({
      code: c.code,
      name: c.name,
      plan: c.effectiveTarget,
      actual: c.actualQty,
    })),
  };
}

export async function getVariantOptionsForCategory(planCategoryId: string) {
  await requirePlanningView();
  const category = await prisma.planCategory.findUnique({
    where: { id: planCategoryId },
    select: { item: { select: { variants: true } } },
  });
  if (!category?.item) return [];
  return variantSelectOptions(parseItemVariants(category.item.variants));
}

export async function upsertMonthlyColorAllocations(
  planCategoryId: string,
  month: number,
  allocations: Array<{
    variantSku: string;
    colorLabel?: string;
    allocatedQty: number;
    notes?: string;
  }>
) {
  const session = await requirePlanningManage();
  const parsed = upsertMonthlyColorAllocationsSchema.parse({
    planCategoryId,
    month,
    allocations,
  });
  const category = await prisma.planCategory.findUnique({
    where: { id: planCategoryId },
    include: { parent: true, monthlyTargets: true, planYear: { select: { year: true } } },
  });
  if (!category) throw new Error("Category not found");
  await requirePlanYearEditable(category.planYearId);
  if (!category.itemId) {
    throw new Error("Category must be linked to a finished good before color allocation");
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
  const monthlyTarget = getMonthlyTarget(effectiveTarget, parsed.month, category.monthlyTargets);

  const validation = validateMonthlyColorAllocations(monthlyTarget, parsed.allocations);
  if (!validation.valid) {
    throw new Error(validation.message ?? "Color allocation total does not match monthly target");
  }

  await prisma.$transaction([
    prisma.planColorAllocation.deleteMany({
      where: { planCategoryId, month: parsed.month },
    }),
    ...parsed.allocations.map((row) =>
      prisma.planColorAllocation.create({
        data: {
          planCategoryId,
          month: parsed.month,
          variantSku: row.variantSku,
          colorLabel: row.colorLabel ?? null,
          allocatedQty: row.allocatedQty,
          notes: row.notes ?? null,
        },
      })
    ),
  ]);

  await logAudit({
    userId: session.user.id,
    action: "UPDATE",
    entityType: "PlanColorAllocation",
    entityId: planCategoryId,
    metadata: { month: parsed.month, count: parsed.allocations.length },
  });
  revalidatePath(PLANNING_PATH);
  return { success: true as const };
}

export async function upsertColorAllocations(
  planCategoryId: string,
  allocations: Array<{
    variantSku: string;
    colorLabel?: string;
    allocatedQty: number;
    notes?: string;
  }>,
  options?: { month?: number }
) {
  return upsertMonthlyColorAllocations(planCategoryId, options?.month ?? 1, allocations);
}

export async function upsertMonthlyCmtAllocations(
  planCategoryId: string,
  month: number,
  variantSku: string,
  allocations: Array<{ supplierId: string; allocatedQty: number; notes?: string }>
) {
  const session = await requirePlanningManage();
  const parsed = upsertMonthlyCmtAllocationsSchema.parse({
    planCategoryId,
    month,
    variantSku,
    allocations,
  });
  const category = await prisma.planCategory.findUnique({
    where: { id: planCategoryId },
    include: { parent: true },
  });
  if (!category) throw new Error("Category not found");
  await requirePlanYearEditable(category.planYearId);

  for (const row of parsed.allocations) {
    await validateTailorSupplier(row.supplierId);
  }

  const colorRow = await prisma.planColorAllocation.findUnique({
    where: {
      planCategoryId_month_variantSku: {
        planCategoryId,
        month: parsed.month,
        variantSku: parsed.variantSku,
      },
    },
    select: { allocatedQty: true },
  });
  if (!colorRow) {
    throw new Error("Color allocation not found for this month and variant");
  }

  const validation = validateCmtAllocations(colorRow.allocatedQty, parsed.allocations);
  if (!validation.valid) {
    throw new Error(validation.message ?? "CMT allocation total does not match color quantity");
  }

  await prisma.$transaction([
    prisma.planCmtAllocation.deleteMany({
      where: {
        planCategoryId,
        month: parsed.month,
        variantSku: parsed.variantSku,
      },
    }),
    ...parsed.allocations.map((row) =>
      prisma.planCmtAllocation.create({
        data: {
          planCategoryId,
          month: parsed.month,
          variantSku: parsed.variantSku,
          supplierId: row.supplierId,
          allocatedQty: row.allocatedQty,
          notes: row.notes ?? null,
        },
      })
    ),
  ]);

  await logAudit({
    userId: session.user.id,
    action: "UPDATE",
    entityType: "PlanCmtAllocation",
    entityId: planCategoryId,
    metadata: {
      month: parsed.month,
      variantSku: parsed.variantSku,
      count: parsed.allocations.length,
    },
  });
  revalidatePath(PLANNING_PATH);
  return { success: true as const };
}

export async function upsertCmtAllocations(
  planCategoryId: string,
  allocations: Array<{ supplierId: string; allocatedQty: number; notes?: string }>,
  options?: { month?: number; variantSku?: string }
) {
  return upsertMonthlyCmtAllocations(
    planCategoryId,
    options?.month ?? 1,
    options?.variantSku ?? "__LEGACY__",
    allocations
  );
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
  if (!category) throw new Error("Category not found");
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
      throw new Error("Accessory item must be type ACCESSORIES");
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
    action: "UPDATE",
    entityType: "PlanAccessory",
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
    throw new Error("Category must be linked to a finished good item");
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
    base64: buffer.toString("base64"),
    filename: `plan-kerja-template.xlsx`,
  };
}

export async function importPlanFromExcel(planYearId: string, base64: string) {
  const session = await requirePlanningManage();
  await requirePlanYearUnlocked(planYearId);
  const buffer = Buffer.from(base64, "base64");
  const { rows, monthlyColors, monthlyCmt, errors: parseErrors } = parsePlanExcelBuffer(buffer);

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

  const itemCategories = await prisma.itemCategory.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true },
  });
  const categoryCodeToId = new Map<string, string>();
  const categoryById = new Map<string, { id: string; code: string | null; name: string }>();
  for (const ic of itemCategories) {
    categoryById.set(ic.id, ic);
    if (ic.code?.trim()) categoryCodeToId.set(ic.code.trim(), ic.id);
  }

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

      const isRoot = !parentId;
      let itemCategoryId: string | undefined;
      if (isRoot) {
        const lookupCode = (row.itemCategoryCode ?? row.code).trim();
        itemCategoryId = categoryCodeToId.get(lookupCode);
        if (!itemCategoryId) {
          errors.push({
            row: row.rowNumber,
            message: `Item category code "${lookupCode}" not found in master`,
          });
          continue;
        }
      }

      const rowCode =
        isRoot && itemCategoryId
          ? planCodeFromItemCategory(categoryById.get(itemCategoryId)!)
          : row.code;
      const existingId = codeToId.get(rowCode);
      if (existingId) {
        await updatePlanCategory(existingId, {
          ...(parentId ? { name: row.name } : {}),
          description: row.description,
          ...(parentId
            ? { parentSharePercent: row.parentSharePercent ?? undefined }
            : { targetQty: row.targetQty ?? undefined }),
          itemId: itemId ?? undefined,
        });
        updated += 1;
      } else if (isRoot && itemCategoryId) {
        const createdCat = await createPlanCategory({
          planYearId,
          itemCategoryId,
          description: row.description,
          targetQty: row.targetQty ?? 0,
          itemId: itemId ?? null,
        });
        codeToId.set(createdCat.code, createdCat.id);
        created += 1;
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
        message: err instanceof Error ? err.message : "Import failed",
      });
    }
  }

  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
  });
  const supplierCodeToId = new Map(suppliers.map((s) => [s.code, s.id]));

  const colorImportGroups = new Map<string, Map<number, Map<string, number>>>();
  for (const row of monthlyColors) {
    const categoryId = codeToId.get(row.code);
    if (!categoryId) {
      errors.push({
        row: row.rowNumber,
        message: `Category code ${row.code} not found for monthly color row`,
      });
      continue;
    }
    if (!colorImportGroups.has(categoryId)) {
      colorImportGroups.set(categoryId, new Map());
    }
    const monthMap = colorImportGroups.get(categoryId)!;
    if (!monthMap.has(row.month)) monthMap.set(row.month, new Map());
    const variantMap = monthMap.get(row.month)!;
    variantMap.set(row.variantSku, (variantMap.get(row.variantSku) ?? 0) + row.qty);
  }

  for (const [categoryId, monthMap] of colorImportGroups.entries()) {
    for (const [month, variantMap] of monthMap.entries()) {
      try {
        await upsertMonthlyColorAllocations(
          categoryId,
          month,
          [...variantMap.entries()].map(([variantSku, allocatedQty]) => ({
            variantSku,
            allocatedQty,
          }))
        );
      } catch (err) {
        errors.push({
          row: 0,
          message: err instanceof Error ? err.message : "Monthly color import failed",
        });
      }
    }
  }

  const cmtImportGroups = new Map<
    string,
    Map<number, Map<string, Map<string, number>>>
  >();
  for (const row of monthlyCmt) {
    const categoryId = codeToId.get(row.code);
    if (!categoryId) {
      errors.push({
        row: row.rowNumber,
        message: `Category code ${row.code} not found for monthly CMT row`,
      });
      continue;
    }
    const supplierId = supplierCodeToId.get(row.supplierCode);
    if (!supplierId) {
      errors.push({
        row: row.rowNumber,
        message: `Supplier code ${row.supplierCode} not found`,
      });
      continue;
    }
    if (!cmtImportGroups.has(categoryId)) {
      cmtImportGroups.set(categoryId, new Map());
    }
    const monthMap = cmtImportGroups.get(categoryId)!;
    if (!monthMap.has(row.month)) monthMap.set(row.month, new Map());
    const variantMap = monthMap.get(row.month)!;
    if (!variantMap.has(row.variantSku)) variantMap.set(row.variantSku, new Map());
    const supplierMap = variantMap.get(row.variantSku)!;
    supplierMap.set(supplierId, (supplierMap.get(supplierId) ?? 0) + row.qty);
  }

  for (const [categoryId, monthMap] of cmtImportGroups.entries()) {
    for (const [month, variantMap] of monthMap.entries()) {
      for (const [variantSku, supplierMap] of variantMap.entries()) {
        try {
          await upsertMonthlyCmtAllocations(
            categoryId,
            month,
            variantSku,
            [...supplierMap.entries()].map(([supplierId, allocatedQty]) => ({
              supplierId,
              allocatedQty,
            }))
          );
        } catch (err) {
          errors.push({
            row: 0,
            message: err instanceof Error ? err.message : "Monthly CMT import failed",
          });
        }
      }
    }
  }

  await logAudit({
    userId: session.user.id,
    action: "IMPORT",
    entityType: "PlanYear",
    entityId: planYearId,
    metadata: { created, updated, errorCount: errors.length },
  });
  revalidatePath(PLANNING_PATH);
  return { success: errors.length === 0, created, updated, errors };
}

async function validatePlanYearForActivation(planYearId: string) {
  const planYear = await prisma.planYear.findUnique({
    where: { id: planYearId },
    include: {
      categories: {
        include: {
          parent: true,
          monthlyTargets: true,
          colorAllocations: true,
          cmtAllocations: true,
        },
      },
    },
  });
  if (!planYear) throw new Error("Plan year not found");

  const leaves = planYear.categories.filter((c) => {
    const hasChildren = planYear.categories.some((child) => child.parentId === c.id);
    return !hasChildren;
  });

  for (const leaf of leaves) {
    if (!leaf.itemId) continue;

    const planningNode: PlanningCategoryNode = {
      id: leaf.id,
      parentId: leaf.parentId,
      targetQty: leaf.targetQty,
      parentSharePercent: leaf.parentSharePercent,
      itemId: leaf.itemId,
      parent: leaf.parent ? { targetQty: leaf.parent.targetQty } : null,
    };
    const effectiveTarget = getEffectiveTarget(planningNode);

    for (let month = 1; month <= 12; month += 1) {
      const monthlyTarget = getMonthlyTarget(effectiveTarget, month, leaf.monthlyTargets);
      if (monthlyTarget <= 0) continue;

      const colorRows = leaf.colorAllocations.filter((row) => row.month === month);
      const colorValidation = validateMonthlyColorAllocations(monthlyTarget, colorRows);
      if (!colorValidation.valid) {
        throw new Error(
          `${leaf.code} month ${month}: ${colorValidation.message ?? "color allocation mismatch"}`
        );
      }

      for (const color of colorRows) {
        if (color.allocatedQty <= 0) continue;
        const cmtRows = leaf.cmtAllocations.filter(
          (row) => row.month === month && row.variantSku === color.variantSku
        );
        const cmtValidation = validateCmtAllocations(color.allocatedQty, cmtRows);
        if (!cmtValidation.valid) {
          throw new Error(
            `${leaf.code} ${color.variantSku} month ${month}: ${cmtValidation.message ?? "CMT allocation mismatch"}`
          );
        }
      }
    }
  }
}

export async function activatePlanYear(planYearId: string) {
  const session = await requirePlanningManage();
  await requirePlanYearEditable(planYearId);
  await validatePlanYearForActivation(planYearId);

  const updated = await prisma.planYear.update({
    where: { id: planYearId },
    data: { status: "ACTIVE", isLocked: true },
  });

  await logAudit({
    userId: session.user.id,
    action: "UPDATE",
    entityType: "PlanYear",
    entityId: planYearId,
    metadata: { activated: true },
  });
  revalidatePath(PLANNING_PATH);
  return updated;
}

export async function reopenPlanYear(planYearId: string) {
  const session = await requirePlanningManage();
  const updated = await prisma.planYear.update({
    where: { id: planYearId },
    data: { status: "DRAFT", isLocked: false },
  });
  await logAudit({
    userId: session.user.id,
    action: "UPDATE",
    entityType: "PlanYear",
    entityId: planYearId,
    metadata: { reopened: true },
  });
  revalidatePath(PLANNING_PATH);
  return updated;
}

export async function generateWorkOrderFromCmtAllocation(cmtAllocationId: string) {
  const session = await requirePlanningManage();
  requirePermission(session.user.permissions, PERMISSIONS.WORK_ORDERS_CREATE);

  const cmt = await prisma.planCmtAllocation.findUnique({
    where: { id: cmtAllocationId },
    include: {
      supplier: { select: { name: true } },
      planCategory: {
        select: {
          id: true,
          code: true,
          itemId: true,
          planYear: { select: { id: true, year: true, status: true, isLocked: true } },
        },
      },
      planStage: { select: { id: true } },
    },
  });
  if (!cmt) throw new Error("CMT allocation not found");
  await requirePlanYearActive(cmt.planCategory.planYear.id);

  if (cmt.workOrderId) {
    const existingWo = await prisma.workOrder.findUnique({
      where: { id: cmt.workOrderId },
      select: { docNumber: true, status: true },
    });
    if (existingWo && existingWo.status !== "CANCELLED") {
      return {
        skipped: true as const,
        workOrderId: cmt.workOrderId,
        docNumber: existingWo.docNumber,
      };
    }
  }

  const woPayload = buildWoPayloadFromCmtRow(
    { itemId: cmt.planCategory.itemId, code: cmt.planCategory.code },
    {
      month: cmt.month,
      variantSku: cmt.variantSku,
      supplierId: cmt.supplierId,
      allocatedQty: cmt.allocatedQty,
      supplierName: cmt.supplier.name,
    },
    cmt.planCategory.planYear.year
  );

  const notes = `Plan Kerja ${cmt.planCategory.planYear.year} · ${cmt.planCategory.code} · M${cmt.month} · ${cmt.variantSku}`;
  const result = await createWorkOrder(
    {
      vendorId: woPayload.vendorId,
      finishedGoodId: woPayload.finishedGoodId,
      outputMode: "SKU",
      plannedQty: woPayload.plannedQty,
      targetDate: woPayload.targetDate,
      skuBreakdown: [{ variantSku: woPayload.variantSku, ratioPercent: 100 }],
      notes,
    },
    session.user.id,
    { skipStockCheck: true }
  );

  const stageName = stageNameFromAllocation(
    cmt.planCategory.code,
    cmt.month,
    cmt.variantSku,
    cmt.supplier.name
  );

  const stage = await prisma.planStage.upsert({
    where: { planCmtAllocationId: cmt.id },
    create: {
      planCategoryId: cmt.planCategory.id,
      name: stageName,
      targetQty: cmt.allocatedQty,
      targetMonth: cmt.month,
      variantSku: cmt.variantSku,
      supplierId: cmt.supplierId,
      workOrderId: result.id,
      planCmtAllocationId: cmt.id,
    },
    update: {
      name: stageName,
      targetQty: cmt.allocatedQty,
      targetMonth: cmt.month,
      variantSku: cmt.variantSku,
      supplierId: cmt.supplierId,
      workOrderId: result.id,
    },
  });

  await prisma.planCmtAllocation.update({
    where: { id: cmt.id },
    data: { workOrderId: result.id },
  });

  await logAudit({
    userId: session.user.id,
    action: "CREATE",
    entityType: "WorkOrder",
    entityId: result.id,
    metadata: { source: "PlanCmtAllocation", cmtAllocationId, stageId: stage.id },
  });

  revalidatePath(PLANNING_PATH);
  return { created: true as const, workOrderId: result.id, docNumber: result.docNumber };
}

export async function generateWorkOrdersFromPlan(
  planYearId: string,
  filters?: { categoryId?: string; month?: number }
) {
  await requirePlanningManage();
  await requirePlanYearActive(planYearId);

  const allocations = await prisma.planCmtAllocation.findMany({
    where: {
      planCategory: { planYearId },
      ...(filters?.categoryId ? { planCategoryId: filters.categoryId } : {}),
      ...(filters?.month != null ? { month: filters.month } : {}),
      allocatedQty: { gt: 0 },
    },
    select: { id: true },
    orderBy: [{ planCategoryId: "asc" }, { month: "asc" }, { variantSku: "asc" }],
  });

  const results: Array<{
    cmtAllocationId: string;
    status: "created" | "skipped" | "error";
    docNumber?: string;
    message?: string;
  }> = [];

  for (const row of allocations) {
    try {
      const outcome = await generateWorkOrderFromCmtAllocation(row.id);
      if ("skipped" in outcome && outcome.skipped) {
        results.push({
          cmtAllocationId: row.id,
          status: "skipped",
          docNumber: outcome.docNumber,
        });
      } else if ("created" in outcome && outcome.created) {
        results.push({
          cmtAllocationId: row.id,
          status: "created",
          docNumber: outcome.docNumber,
        });
      }
    } catch (err) {
      results.push({
        cmtAllocationId: row.id,
        status: "error",
        message: err instanceof Error ? err.message : "Failed to generate work order",
      });
    }
  }

  return {
    total: allocations.length,
    created: results.filter((r) => r.status === "created").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  };
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
  if (!stage) throw new Error("Stage not found");
  if (!stage.supplierId) {
    throw new Error("Pilih vendor CMT di tahap ini sebelum membuat Work Order.");
  }
  if (!stage.planCategory.itemId) {
    throw new Error("Kategori harus terhubung ke item barang jadi sebelum membuat Work Order.");
  }

  if (stage.workOrderId) {
    const existingWo = await prisma.workOrder.findUnique({
      where: { id: stage.workOrderId },
      select: { docNumber: true, status: true },
    });
    if (existingWo && existingWo.status !== "CANCELLED") {
      throw new Error(
        `Tahap ini sudah memiliki Work Order aktif (${existingWo.docNumber}).`
      );
    }
  }

  const result = await createWorkOrder(
    {
      vendorId: stage.supplierId,
      finishedGoodId: stage.planCategory.itemId,
      outputMode: stage.variantSku ? "SKU" : "GENERIC",
      plannedQty: stage.targetQty,
      targetDate: undefined,
      ...(stage.variantSku
        ? { skuBreakdown: [{ variantSku: stage.variantSku, ratioPercent: 100 }] }
        : {}),
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
    action: "CREATE",
    entityType: "WorkOrder",
    entityId: result.id,
    metadata: { source: "PlanStage", stageId },
  });

  revalidatePath(PLANNING_PATH);
  redirect(`/backoffice/work-orders/${result.id}`);
}

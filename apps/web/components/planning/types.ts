import type { RingkasanJadwal } from "@/lib/production/jadwal";

export type PlanStageDetail = {
  id: string;
  name: string;
  targetQty: number;
  targetMonth: number | null;
  variantSku: string | null;
  supplierId: string | null;
  supplierName: string | null;
  fabricNotes: string | null;
  colorNotes: string | null;
  workOrderId: string | null;
  workOrderDocNumber: string | null;
  workOrderStatus: string | null;
  planCmtAllocationId: string | null;
  sortOrder: number;
  /** Ringkasan jadwal proses tahap (langkah selesai/telat, perkiraan selesai). */
  jadwal: RingkasanJadwal;
};

export type PlanCategoryDetail = {
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
  monthlyBreakdown: Array<{ month: number; targetQty: number; isManualOverride: boolean }>;
  monthlyTargetsComputed: Array<{ month: number; targetQty: number; isManualOverride: boolean }>;
  monthlyTotal: number;
  monthlyActuals: Array<{ month: number; actual: number }>;
  monthlyMismatch: {
    hasMismatch: boolean;
    monthlySum: number;
    effectiveTarget: number;
    delta: number;
  } | null;
  children: PlanCategoryDetail[];
  stages: PlanStageDetail[];
  colorAllocations: Array<{
    id: string;
    month: number;
    variantSku: string;
    colorLabel: string | null;
    allocatedQty: number;
    notes: string | null;
  }>;
  cmtAllocations: Array<{
    id: string;
    month: number;
    variantSku: string;
    supplierId: string;
    allocatedQty: number;
    workOrderId: string | null;
    notes: string | null;
  }>;
  accessoryPlans: Array<{
    id: string;
    itemId: string;
    qtyPerPcs: number;
    totalQtyNeeded: number;
    notes: string | null;
  }>;
};

export type PlanYearDetail = {
  id: string;
  year: number;
  notes: string | null;
  status: "DRAFT" | "ACTIVE";
  isLocked: boolean;
  createdBy: { id: string; name: string };
  categories: PlanCategoryDetail[];
  totals: {
    totalPlan: number;
    totalActual: number;
    totalVariance: number;
    completionPercent: number;
    completionBand: "red" | "yellow" | "green";
  };
};

export type PlanDashboardData = {
  year: number;
  kpi: {
    totalPlan: number;
    totalActual: number;
    totalGap: number;
    totalVariance: number;
    completionPercent: number;
    completionBand: "red" | "yellow" | "green";
    /** Σ qty tahap yang punya ≥ 1 PO tidak batal; null bila penonton tidak memegang `purchase_orders:view`. */
    sudahAdaPo: number | null;
  };
  rows: Array<{
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
    /** Qty tahap jenis ini (dan turunannya) yang punya ≥ 1 PO tidak batal; null tanpa izin PO. */
    sudahAdaPo: number | null;
  }>;
  monthlyTimeline: Array<{ month: number; plan: number; actual: number }>;
  parentChart: Array<{ code: string; name: string; plan: number; actual: number }>;
  variantRows: Array<{
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
  }>;
};

export type ComboboxOption = { value: string; label: string };

/** Isian "Tambah tahap" (Isi Grid / Rincian Plan). */
export type PlanStageAddData = {
  name: string;
  targetQty: number;
  targetMonth?: number;
  variantSku?: string;
  supplierId?: string;
};

/** Perubahan satu tahap — hanya kolom yang berubah yang dikirim. */
export type PlanStageUpdateData = Partial<{
  name: string;
  targetQty: number;
  targetMonth: number | null;
  variantSku: string | null;
  supplierId: string | null;
  fabricNotes: string | null;
  colorNotes: string | null;
}>;

/** Penangan tahap mengembalikan `true` bila tersimpan (penolakan sudah ditampilkan pemanggil). */
export type PlanStageHandlers = {
  onAddStage: (data: PlanStageAddData) => Promise<boolean>;
  onUpdateStage: (stageId: string, data: PlanStageUpdateData) => Promise<boolean>;
};

export function formatPlanNumber(value: number) {
  return value.toLocaleString("id-ID");
}

export function collectLeafCategories(categories: PlanCategoryDetail[]): PlanCategoryDetail[] {
  const leaves: PlanCategoryDetail[] = [];
  const visit = (nodes: PlanCategoryDetail[]) => {
    for (const node of nodes) {
      if (node.children.length === 0) leaves.push(node);
      else visit(node.children);
    }
  };
  visit(categories);
  return leaves;
}

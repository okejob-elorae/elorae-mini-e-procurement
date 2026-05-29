"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { ItemType } from "@/lib/constants/enums";
import { PERMISSIONS, hasPermission } from "@/lib/rbac";
import { getItemsByType } from "@/app/actions/items";
import { getSuppliersForSelect } from "@/app/actions/suppliers";
import {
  createPlanCategory,
  createPlanStage,
  createPlanYear,
  createWorkOrderFromStage,
  deletePlanCategory,
  deletePlanStage,
  downloadPlanTemplate,
  getPlanDashboard,
  getPlanYear,
  getPlanYears,
  importPlanFromExcel,
  resetMonthlyOverride,
  resetMonthlyToAuto,
  setMonthlyOverride,
  setPlanYearLock,
  suggestAccessoryFromBom,
  updatePlanCategory,
  updatePlanStage,
  upsertAccessoryPlans,
  upsertCmtAllocations,
  upsertColorAllocations,
} from "@/app/actions/planning";
import { PlanningPageShell, PlanningTabPanel } from "@/components/planning/planning-page-shell";
import { PlanGridTab } from "@/components/planning/plan-grid-tab";
import { PlanDashboardTab } from "@/components/planning/plan-dashboard-tab";
import { PlanDetailsTab } from "@/components/planning/plan-details-tab";
import { PlanColorsTab } from "@/components/planning/plan-colors-tab";
import { PlanCmtTab } from "@/components/planning/plan-cmt-tab";
import { PlanAccessoriesTab } from "@/components/planning/plan-accessories-tab";
import type { ComboboxOption, PlanDashboardData, PlanYearDetail } from "@/components/planning/types";

export function PlanningPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const activeTab = searchParams.get("tab") || "grid";

  const isAdmin = session?.user?.role === "ADMIN";
  const canManage = hasPermission(
    session?.user?.permissions || [],
    PERMISSIONS.PRODUCTION_PLANNING_MANAGE
  );
  const canCreateWorkOrder = hasPermission(
    session?.user?.permissions || [],
    PERMISSIONS.WORK_ORDERS_CREATE
  );

  const [years, setYears] = useState<Array<{ id: string; year: number; isLocked: boolean }>>([]);
  const [selectedYearId, setSelectedYearId] = useState("");
  const [detail, setDetail] = useState<PlanYearDetail | null>(null);
  const [dashboard, setDashboard] = useState<PlanDashboardData | null>(null);
  const [newYear, setNewYear] = useState(String(new Date().getFullYear()));
  const [itemOptions, setItemOptions] = useState<ComboboxOption[]>([]);
  const [accessoryOptions, setAccessoryOptions] = useState<ComboboxOption[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<ComboboxOption[]>([]);
  const [tailorOptions, setTailorOptions] = useState<ComboboxOption[]>([]);

  const refreshAll = async (preferredYearId?: string) => {
    const planYears = await getPlanYears();
    setYears(
      planYears.map((y) => ({ id: y.id, year: y.year, isLocked: y.isLocked }))
    );
    const nextYearId = preferredYearId || selectedYearId || planYears[0]?.id || "";
    setSelectedYearId(nextYearId);
    if (!nextYearId) {
      setDetail(null);
      setDashboard(null);
      return;
    }
    const [yearDetail, dashboardData] = await Promise.all([
      getPlanYear(nextYearId),
      getPlanDashboard(nextYearId),
    ]);
    setDetail(yearDetail as PlanYearDetail);
    setDashboard(dashboardData as PlanDashboardData);
  };

  useEffect(() => {
    refreshAll().catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to load planning");
    });
    Promise.all([
      getItemsByType(ItemType.FINISHED_GOOD),
      getItemsByType(ItemType.ACCESSORIES),
      getSuppliersForSelect({ approvedOnly: true }),
      getSuppliersForSelect({ approvedOnly: true, typeId: "st-tailor" }),
    ]).then(([fgRows, accRows, suppliers, tailors]) => {
      setItemOptions(
        (fgRows as Array<{ id: string; sku: string; nameId: string }>).map((row) => ({
          value: row.id,
          label: `${row.nameId} (${row.sku})`,
        }))
      );
      setAccessoryOptions(
        (accRows as Array<{ id: string; sku: string; nameId: string }>).map((row) => ({
          value: row.id,
          label: `${row.nameId} (${row.sku})`,
        }))
      );
      const mapSupplier = (row: { id: string; code: string; name: string }) => ({
        value: row.id,
        label: `${row.name} (${row.code})`,
      });
      setSupplierOptions((suppliers as Array<{ id: string; code: string; name: string }>).map(mapSupplier));
      setTailorOptions((tailors as Array<{ id: string; code: string; name: string }>).map(mapSupplier));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  useEffect(() => {
    if (!selectedYearId) return;
    refreshAll(selectedYearId).catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to load plan year");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYearId]);

  const setTab = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.replace(`/backoffice/production/planning?${params.toString()}`);
  };

  const disabled = !canManage || (detail?.isLocked ?? false);

  const handleCreateWo = async (stageId: string) => {
    try {
      await createWorkOrderFromStage(stageId);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create WO");
    }
  };

  return (
    <PlanningPageShell
      activeTab={activeTab}
      onTabChange={setTab}
      years={years}
      selectedYearId={selectedYearId}
      onYearChange={setSelectedYearId}
      createdByName={detail?.createdBy.name}
      isLocked={detail?.isLocked}
      isAdmin={isAdmin}
      canManage={canManage}
      newYear={newYear}
      onNewYearChange={setNewYear}
      onCreateYear={async () => {
        if (!canManage) return;
        const year = Number(newYear);
        if (!Number.isInteger(year)) {
          toast.error("Invalid year");
          return;
        }
        try {
          const created = await createPlanYear({ year });
          await refreshAll(created.id);
          setNewYear(String(year + 1));
          toast.success("Plan year created");
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Failed to create year");
        }
      }}
      onToggleLock={async () => {
        if (!detail || !isAdmin) return;
        await setPlanYearLock(detail.id, !detail.isLocked);
        await refreshAll(detail.id);
      }}
      onDownloadTemplate={async () => {
        try {
          const { base64, filename } = await downloadPlanTemplate();
          const link = document.createElement("a");
          link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
          link.download = filename;
          link.click();
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Download failed");
        }
      }}
      onImportExcel={async (file) => {
        if (!detail) return;
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 1) {
          binary += String.fromCharCode(bytes[i]!);
        }
        const base64 = btoa(binary);
        try {
          const result = await importPlanFromExcel(detail.id, base64);
          await refreshAll(detail.id);
          toast.success(
            `Import: ${result.created} created, ${result.updated} updated, ${result.errors.length} errors`
          );
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Import failed");
        }
      }}
    >
      <PlanningTabPanel value="grid">
        {detail && (
          <PlanGridTab
            detail={detail}
            disabled={disabled}
            canManage={canManage}
            canCreateWo={canCreateWorkOrder}
            itemOptions={itemOptions}
            supplierOptions={tailorOptions.length ? tailorOptions : supplierOptions}
            onRefresh={() => refreshAll(detail.id)}
            onCreateParent={async (data) => {
              await createPlanCategory({
                planYearId: detail.id,
                code: data.code,
                name: data.name,
                targetQty: data.targetQty,
              });
            }}
            onCreateChild={async (parentId, data) => {
              await createPlanCategory({
                planYearId: detail.id,
                parentId,
                code: data.code,
                name: data.name,
                parentSharePercent: data.share,
              });
            }}
            onUpdateTarget={async (id, qty) => {
              await updatePlanCategory(id, { targetQty: qty });
            }}
            onUpdateShare={async (id, share) => {
              await updatePlanCategory(id, { parentSharePercent: share });
            }}
            onUpdateItem={async (id, itemId) => {
              await updatePlanCategory(id, { itemId });
            }}
            onDeleteCategory={async (id) => {
              await deletePlanCategory(id);
            }}
            onSaveMonth={async (id, month, qty) => {
              await setMonthlyOverride({ planCategoryId: id, month, targetQty: qty });
            }}
            onResetMonth={async (id, month) => {
              await resetMonthlyOverride(id, month);
            }}
            onResetAllMonths={async (id) => {
              await resetMonthlyToAuto(id);
            }}
            onAddStage={async (id, data) => {
              await createPlanStage({ planCategoryId: id, ...data });
            }}
            onUpdateStage={async (id, data) => {
              await updatePlanStage(id, data);
            }}
            onDeleteStage={async (id) => {
              await deletePlanStage(id);
            }}
            onCreateWo={handleCreateWo}
          />
        )}
      </PlanningTabPanel>

      <PlanningTabPanel value="dashboard">
        {dashboard && <PlanDashboardTab dashboard={dashboard} />}
      </PlanningTabPanel>

      <PlanningTabPanel value="rincian">
        {detail && (
          <PlanDetailsTab
            detail={detail}
            supplierOptions={tailorOptions}
            disabled={disabled}
            canCreateWo={canCreateWorkOrder}
            onRefresh={() => refreshAll(detail.id)}
            onAddStage={async (id, data) => {
              await createPlanStage({ planCategoryId: id, ...data });
            }}
            onUpdateStage={async (id, data) => {
              await updatePlanStage(id, data);
            }}
            onDeleteStage={(id) => deletePlanStage(id)}
            onCreateWo={handleCreateWo}
          />
        )}
      </PlanningTabPanel>

      <PlanningTabPanel value="warna">
        {detail && (
          <PlanColorsTab
            detail={detail}
            disabled={disabled}
            onRefresh={() => refreshAll(detail.id)}
            onSave={async (categoryId, allocations) => {
              const result = await upsertColorAllocations(categoryId, allocations);
              return { warning: result.warning };
            }}
          />
        )}
      </PlanningTabPanel>

      <PlanningTabPanel value="jahitan">
        {detail && (
          <PlanCmtTab
            detail={detail}
            tailorOptions={tailorOptions}
            disabled={disabled}
            onRefresh={() => refreshAll(detail.id)}
            onSave={async (categoryId, allocations) => {
              const result = await upsertCmtAllocations(categoryId, allocations);
              return { warning: result.warning };
            }}
          />
        )}
      </PlanningTabPanel>

      <PlanningTabPanel value="aksesoris">
        {detail && (
          <PlanAccessoriesTab
            detail={detail}
            accessoryOptions={accessoryOptions}
            disabled={disabled}
            onRefresh={() => refreshAll(detail.id)}
            onSave={async (categoryId, plans) => {
              await upsertAccessoryPlans(categoryId, plans);
            }}
            onSuggestBom={(categoryId) => suggestAccessoryFromBom(categoryId)}
          />
        )}
      </PlanningTabPanel>
    </PlanningPageShell>
  );
}

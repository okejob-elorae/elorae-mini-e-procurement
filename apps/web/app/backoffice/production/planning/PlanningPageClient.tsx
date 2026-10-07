"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarPlus } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ItemType } from "@/lib/constants/enums";
import { PERMISSIONS, hasPermission } from "@/lib/rbac";
import { getItemCategories } from "@/app/actions/item-categories";
import { getItemsByType } from "@/app/actions/items";
import { getSuppliersForSelect } from "@/app/actions/suppliers";
import {
  activatePlanYear,
  createPlanCategory,
  createPlanStage,
  createPlanYear,
  createWorkOrderFromStage,
  deletePlanCategory,
  deletePlanStage,
  downloadPlanTemplate,
  generateWorkOrdersFromPlan,
  getPlanDashboard,
  getPlanYear,
  getPlanYears,
  importPlanFromExcel,
  reopenPlanYear,
  resetMonthlyOverride,
  resetMonthlyToAuto,
  setMonthlyOverride,
  setPlanYearLock,
  suggestAccessoryFromBom,
  updatePlanCategory,
  updatePlanStage,
  upsertAccessoryPlans,
  upsertMonthlyCmtAllocations,
  upsertMonthlyColorAllocations,
  type HasilTahap,
} from "@/app/actions/planning";
import { PlanningPageShell, PlanningTabPanel } from "@/components/planning/planning-page-shell";
import { PlanGridTab } from "@/components/planning/plan-grid-tab";
import { PlanDashboardTab } from "@/components/planning/plan-dashboard-tab";
import { PlanDetailsTab } from "@/components/planning/plan-details-tab";
import { PlanColorsTab } from "@/components/planning/plan-colors-tab";
import { PlanCmtTab } from "@/components/planning/plan-cmt-tab";
import { PlanAccessoriesTab } from "@/components/planning/plan-accessories-tab";
import { PlanKalenderTab } from "@/components/planning/plan-kalender-tab";
import type {
  ComboboxOption,
  PlanDashboardData,
  PlanStageAddData,
  PlanStageUpdateData,
  PlanYearDetail,
} from "@/components/planning/types";

export function PlanningPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const tCmt = useTranslations("planning.cmt");
  const tColors = useTranslations("planning.colors");
  const tToast = useTranslations("planning.toasts");
  const tEmpty = useTranslations("planning.empty");
  const tTolak = useTranslations("jadwalProduksi.plan.tolak");
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
  const lihatPo = hasPermission(session?.user?.permissions || [], PERMISSIONS.PURCHASE_ORDERS_VIEW);
  const lihatSpk = hasPermission(session?.user?.permissions || [], PERMISSIONS.WORK_ORDERS_VIEW);

  const [years, setYears] = useState<
    Array<{ id: string; year: number; isLocked: boolean; status: "DRAFT" | "ACTIVE" }>
  >([]);
  const [selectedYearId, setSelectedYearId] = useState("");
  const [detail, setDetail] = useState<PlanYearDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dashboard, setDashboard] = useState<PlanDashboardData | null>(null);
  const [newYear, setNewYear] = useState(String(new Date().getFullYear()));
  const [itemOptions, setItemOptions] = useState<ComboboxOption[]>([]);
  const [itemCategoryOptions, setItemCategoryOptions] = useState<ComboboxOption[]>([]);
  const [accessoryOptions, setAccessoryOptions] = useState<ComboboxOption[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<ComboboxOption[]>([]);
  const [tailorOptions, setTailorOptions] = useState<ComboboxOption[]>([]);

  const refreshAll = async (preferredYearId?: string) => {
    const planYears = await getPlanYears();
    setYears(
      planYears.map((y) => ({
        id: y.id,
        year: y.year,
        isLocked: y.isLocked,
        status: y.status as "DRAFT" | "ACTIVE",
      }))
    );
    // ?tahun= di URL (dibagikan / kembali) dipakai sebelum tahun pertama.
    const tahunUrl = new URLSearchParams(window.location.search).get("tahun");
    const dariUrl = tahunUrl ? planYears.find((y) => String(y.year) === tahunUrl)?.id : undefined;
    const nextYearId = preferredYearId || selectedYearId || dariUrl || planYears[0]?.id || "";
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
    refreshAll()
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : tToast("loadFailed"));
      })
      .finally(() => setLoaded(true));
    Promise.all([
      getItemsByType(ItemType.FINISHED_GOOD),
      getItemsByType(ItemType.ACCESSORIES),
      getItemCategories(true),
      getSuppliersForSelect({ approvedOnly: true }),
      getSuppliersForSelect({ approvedOnly: true, typeId: "st-tailor" }),
    ]).then(([fgRows, accRows, categories, suppliers, tailors]) => {
      setItemOptions(
        (fgRows as Array<{ id: string; sku: string; nameId: string; hasSkuVariants?: boolean }>)
          .filter((row) => row.hasSkuVariants)
          .map((row) => ({
            value: row.id,
            label: `${row.nameId} (${row.sku})`,
          }))
      );
      setItemCategoryOptions(
        (categories as Array<{ id: string; code: string | null; name: string }>).map((row) => ({
          value: row.id,
          label: row.code ? `${row.code} — ${row.name}` : row.name,
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
      toast.error(err instanceof Error ? err.message : tToast("loadYearFailed"));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYearId]);

  const setTab = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.replace(`/backoffice/production/planning?${params.toString()}`);
  };

  const disabled = !canManage || detail?.status !== "DRAFT" || (detail?.isLocked ?? false);

  const workOrderLabels = useMemo(() => {
    const map = new Map<string, string>();
    if (!detail) return map;
    const visit = (nodes: PlanYearDetail["categories"]) => {
      for (const node of nodes) {
        for (const stage of node.stages) {
          if (stage.workOrderId && stage.workOrderDocNumber) {
            map.set(stage.workOrderId, stage.workOrderDocNumber);
          }
        }
        for (const cmt of node.cmtAllocations) {
          if (cmt.workOrderId) {
            const stageWo = node.stages.find((s) => s.workOrderId === cmt.workOrderId);
            if (stageWo?.workOrderDocNumber) map.set(cmt.workOrderId, stageWo.workOrderDocNumber);
          }
        }
        if (node.children.length) visit(node.children);
      }
    };
    visit(detail.categories);
    return map;
  }, [detail]);

  const findVariantlessLinkedLeaf = (
    nodes: PlanYearDetail["categories"]
  ): { code: string; itemLabel: string } | null => {
    for (const node of nodes) {
      if (node.children.length > 0) {
        const childHit = findVariantlessLinkedLeaf(node.children);
        if (childHit) return childHit;
      }
      if (node.itemId && !node.itemVariants.some((v) => v.variantSku.trim() !== "")) {
        return {
          code: node.code,
          itemLabel: node.itemName || node.code,
        };
      }
    }
    return null;
  };

  // Tambah/ubah tahap mengembalikan kode penolakan (tidak melempar); `true` = tersimpan.
  const hasilTahap = (hasil: HasilTahap): boolean => {
    if (hasil.ok) return true;
    toast.error(
      hasil.code === "SUDAH_ADA_WO"
        ? tTolak("SUDAH_ADA_WO", { docNumber: hasil.docNumber ?? "" })
        : tTolak(hasil.code)
    );
    return false;
  };
  const handleAddStage = async (planCategoryId: string, data: PlanStageAddData) => {
    try {
      return hasilTahap(await createPlanStage({ planCategoryId, ...data }));
    } catch {
      toast.error(tTolak("GAGAL"));
      return false;
    }
  };
  const handleUpdateStage = async (stageId: string, data: PlanStageUpdateData) => {
    try {
      return hasilTahap(await updatePlanStage(stageId, data));
    } catch {
      toast.error(tTolak("GAGAL"));
      return false;
    }
  };

  // Klik ganda pada "Buat WO" tidak boleh membuat dua WO untuk satu tahap.
  const woSedangDibuat = useRef(new Set<string>());
  const handleCreateWo = async (stageId: string) => {
    if (woSedangDibuat.current.has(stageId)) return;
    woSedangDibuat.current.add(stageId);
    try {
      // Penolakan datang sebagai kode; perpindahan ke WO baru dilakukan di sini
      // (aksi server tidak lagi memanggil redirect()).
      const hasil = await createWorkOrderFromStage(stageId);
      if (!hasil.ok) {
        toast.error(
          hasil.code === "SUDAH_ADA_WO"
            ? tToast("woDariTahap.SUDAH_ADA_WO", { docNumber: hasil.docNumber ?? "" })
            : tToast.has(`woDariTahap.${hasil.code}`)
              ? tToast(`woDariTahap.${hasil.code}`)
              : tToast("createWoFailed")
        );
        return;
      }
      toast.success(tToast("woDariTahap.berhasil", { docNumber: hasil.docNumber }));
      router.push(`/backoffice/work-orders/${hasil.id}`);
    } catch {
      toast.error(tToast("createWoFailed"));
    } finally {
      woSedangDibuat.current.delete(stageId);
    }
  };

  // Before the first load finishes there is nothing to say yet; after it, a
  // missing plan gets an explanation instead of a blank space under the tabs.
  const emptyPlan = loaded ? (
    <EmptyState
      icon={CalendarPlus}
      className="rounded-xl border bg-card"
      title={tEmpty("title")}
      description={canManage ? tEmpty("descriptionManage") : tEmpty("descriptionView")}
    />
  ) : null;

  return (
    <PlanningPageShell
      activeTab={activeTab}
      onTabChange={setTab}
      years={years}
      selectedYearId={selectedYearId}
      onYearChange={(id) => {
        setSelectedYearId(id);
        const tahun = years.find((y) => y.id === id)?.year;
        const params = new URLSearchParams(searchParams.toString());
        if (tahun != null) params.set("tahun", String(tahun));
        router.replace(`/backoffice/production/planning?${params.toString()}`);
      }}
      createdByName={detail?.createdBy.name}
      planStatus={detail?.status}
      isLocked={detail?.isLocked}
      isAdmin={isAdmin}
      canManage={canManage}
      newYear={newYear}
      onNewYearChange={setNewYear}
      onCreateYear={async () => {
        if (!canManage) return;
        const year = Number(newYear);
        if (!Number.isInteger(year)) {
          toast.error(tToast("invalidYear"));
          return;
        }
        try {
          const created = await createPlanYear({ year });
          await refreshAll(created.id);
          setNewYear(String(year + 1));
          toast.success(tToast("yearCreated"));
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : tToast("createYearFailed"));
        }
      }}
      onToggleLock={async () => {
        if (!detail || !isAdmin) return;
        await setPlanYearLock(detail.id, !detail.isLocked);
        await refreshAll(detail.id);
      }}
      onActivatePlan={async () => {
        if (!detail || !canManage) return;
        const variantlessLeaf = findVariantlessLinkedLeaf(detail.categories);
        if (variantlessLeaf) {
          toast.error(`${variantlessLeaf.itemLabel}: ${tColors("needsSkuVariants")}`);
          return;
        }
        try {
          await activatePlanYear(detail.id);
          await refreshAll(detail.id);
          toast.success(tToast("activated"));
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : tToast("activateFailed"));
        }
      }}
      onReopenPlan={async () => {
        if (!detail || !canManage) return;
        try {
          await reopenPlanYear(detail.id);
          await refreshAll(detail.id);
          toast.success(tToast("reopened"));
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : tToast("reopenFailed"));
        }
      }}
      onDownloadTemplate={async () => {
        try {
          const { base64, filename } = await downloadPlanTemplate();
          const link = document.createElement("a");
          link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
          link.download = filename;
          link.click();
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : tToast("downloadFailed"));
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
            tToast("importSummary", {
              created: result.created,
              updated: result.updated,
              errors: result.errors.length,
            })
          );
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : tToast("importFailed"));
        }
      }}
    >
      <PlanningTabPanel value="grid">
        {detail ? (
          <PlanGridTab
            detail={detail}
            disabled={disabled}
            canManage={canManage}
            canCreateWo={canCreateWorkOrder}
            itemOptions={itemOptions}
            itemCategoryOptions={itemCategoryOptions}
            supplierOptions={tailorOptions.length ? tailorOptions : supplierOptions}
            onRefresh={() => refreshAll(detail.id)}
            onCreateParent={async (data) => {
              await createPlanCategory({
                planYearId: detail.id,
                itemCategoryId: data.itemCategoryId,
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
            onAddStage={handleAddStage}
            onUpdateStage={handleUpdateStage}
            onDeleteStage={async (id) => {
              await deletePlanStage(id);
            }}
            onCreateWo={handleCreateWo}
          />
        ) : emptyPlan}
      </PlanningTabPanel>

      <PlanningTabPanel value="dashboard">
        {dashboard ? <PlanDashboardTab dashboard={dashboard} /> : emptyPlan}
      </PlanningTabPanel>

      <PlanningTabPanel value="rincian">
        {detail ? (
          <PlanDetailsTab
            detail={detail}
            supplierOptions={tailorOptions}
            disabled={disabled}
            canManage={canManage}
            canCreateWo={canCreateWorkOrder}
            onRefresh={() => refreshAll(detail.id)}
            onAddStage={handleAddStage}
            onUpdateStage={handleUpdateStage}
            onDeleteStage={(id) => deletePlanStage(id)}
            onCreateWo={handleCreateWo}
          />
        ) : emptyPlan}
      </PlanningTabPanel>

      <PlanningTabPanel value="kalender">
        {detail ? <PlanKalenderTab tahun={detail.year} lihatPo={lihatPo} lihatSpk={lihatSpk} /> : emptyPlan}
      </PlanningTabPanel>

      <PlanningTabPanel value="warna">
        {detail ? (
          <PlanColorsTab
            detail={detail}
            disabled={disabled}
            onRefresh={() => refreshAll(detail.id)}
            onSave={async (categoryId, month, allocations) => {
              await upsertMonthlyColorAllocations(categoryId, month, allocations);
              toast.success(tToast("colorsSaved"));
            }}
          />
        ) : emptyPlan}
      </PlanningTabPanel>

      <PlanningTabPanel value="jahitan">
        {detail ? (
          <PlanCmtTab
            detail={detail}
            tailorOptions={tailorOptions}
            disabled={disabled}
            canGenerateWo={canCreateWorkOrder}
            workOrderLabels={workOrderLabels}
            onRefresh={() => refreshAll(detail.id)}
            onSave={async (categoryId, month, variantSku, allocations) => {
              await upsertMonthlyCmtAllocations(categoryId, month, variantSku, allocations);
              toast.success(tToast("cmtSaved"));
            }}
            onGenerateWorkOrders={async (filters) => {
              const result = await generateWorkOrdersFromPlan(detail.id, filters);
              const summary = tCmt("generateSummary", {
                created: result.created,
                skipped: result.skipped,
                errors: result.errors,
              });
              if (result.errors > 0) {
                const firstError = result.results.find((r) => r.status === "error")?.message;
                toast.error(firstError ? `${summary}. ${firstError}` : summary);
              } else {
                toast.success(summary);
              }
              return result;
            }}
          />
        ) : emptyPlan}
      </PlanningTabPanel>

      <PlanningTabPanel value="aksesoris">
        {detail ? (
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
        ) : emptyPlan}
      </PlanningTabPanel>
    </PlanningPageShell>
  );
}

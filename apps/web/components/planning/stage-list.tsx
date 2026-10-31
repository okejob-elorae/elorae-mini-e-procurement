"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarRange, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ComboboxOption,
  PlanCategoryDetail,
  PlanStageDetail,
  PlanStageHandlers,
} from "./types";
import { formatPlanNumber } from "./types";
import { LencanaJadwal } from "./ringkasan-jadwal";

/** Radix Select tidak menerima nilai kosong — pilihan "belum dipilih". */
const KOSONG = "__kosong__";
const BULAN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** Ruang kerja tahap: jadwal proses, dokumen (WO/PO), kebutuhan bahan. */
export const tautanRuangKerjaTahap = (stageId: string) =>
  `/backoffice/production/planning/tahap/${stageId}`;

type StageListProps = PlanStageHandlers & {
  category: PlanCategoryDetail;
  supplierOptions: ComboboxOption[];
  /** Plan tidak bisa diubah (bukan DRAFT, terkunci) atau penonton tanpa izin kelola. */
  disabled?: boolean;
  /**
   * Penonton memegang `production_planning:manage`. Saat plan sudah aktif/terkunci
   * ia tetap boleh mengubah bulan, varian, dan penjahit tahap (masukan "Buat WO"
   * dan tab Kalender) — lihat `KOLOM_TAHAP_BERJALAN`.
   */
  canManage?: boolean;
  canCreateWo?: boolean;
  allowWoWhenLocked?: boolean;
  onDeleteStage: (stageId: string) => Promise<void>;
  onCreateWo: (stageId: string) => Promise<void>;
};

function useOpsiBulan() {
  const tb = useTranslations("jadwalProduksi.plan.bulan");
  return BULAN.map((m) => ({ value: String(m), label: tb(String(m) as "1") }));
}

/** Opsi varian dari barang jadi jenis ini; varian tersimpan yang bukan milik barang tetap tampil. */
function opsiVarian(category: PlanCategoryDetail, tersimpan: string | null, labelAsing: (sku: string) => string) {
  const opsi = category.itemVariants.map((v) => ({ value: v.variantSku, label: v.label }));
  const sku = (tersimpan ?? "").trim();
  if (sku && !opsi.some((o) => o.value === sku)) opsi.push({ value: sku, label: labelAsing(sku) });
  return opsi;
}

export function StageList({
  category,
  supplierOptions,
  disabled,
  canManage,
  canCreateWo,
  allowWoWhenLocked,
  onAddStage,
  onUpdateStage,
  onDeleteStage,
  onCreateWo,
}: StageListProps) {
  const t = useTranslations("planning.stages");
  const tj = useTranslations("jadwalProduksi.plan");
  const opsiBulan = useOpsiBulan();
  const [newStage, setNewStage] = useState({ name: "", targetQty: "", targetMonth: "", variantSku: "" });
  const [menyimpan, setMenyimpan] = useState(false);

  const woDisabled = disabled && !allowWoWhenLocked;
  const punyaVarian = category.itemVariants.length > 0;

  const handleAdd = async () => {
    if (!newStage.name.trim() || !newStage.targetQty || menyimpan) return;
    setMenyimpan(true);
    try {
      const ok = await onAddStage({
        name: newStage.name.trim(),
        targetQty: Number(newStage.targetQty),
        targetMonth: newStage.targetMonth ? Number(newStage.targetMonth) : undefined,
        variantSku: newStage.variantSku || undefined,
      });
      if (ok) setNewStage({ name: "", targetQty: "", targetMonth: "", variantSku: "" });
    } finally {
      setMenyimpan(false);
    }
  };

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="font-medium">{t("title")}</div>
      <p className="text-xs text-muted-foreground">{t("quickAddNote")}</p>

      {category.stages.map((stage) => (
        <StageRow
          key={stage.id}
          stage={stage}
          category={category}
          supplierOptions={supplierOptions}
          opsiBulan={opsiBulan}
          disabled={disabled}
          canManage={canManage}
          woDisabled={woDisabled}
          canCreateWo={canCreateWo}
          onUpdateStage={onUpdateStage}
          onDeleteStage={onDeleteStage}
          onCreateWo={onCreateWo}
        />
      ))}

      {!disabled && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              className="min-w-0"
              placeholder={t("namePlaceholder")}
              aria-label={t("namePlaceholder")}
              value={newStage.name}
              onChange={(e) => setNewStage((s) => ({ ...s, name: e.target.value }))}
            />
            <Input
              className="min-w-0"
              type="number"
              min={1}
              placeholder={t("qtyPlaceholder")}
              aria-label={t("qtyPlaceholder")}
              value={newStage.targetQty}
              onChange={(e) => setNewStage((s) => ({ ...s, targetQty: e.target.value }))}
            />
            <Select
              value={newStage.targetMonth || KOSONG}
              onValueChange={(v) => setNewStage((s) => ({ ...s, targetMonth: v === KOSONG ? "" : v }))}
            >
              <SelectTrigger className="w-full min-w-0" aria-label={tj("bulanTarget")}>
                <SelectValue placeholder={tj("bulanTarget")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KOSONG}>{tj("tanpaBulan")}</SelectItem>
                {opsiBulan.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {punyaVarian ? (
              <Select
                value={newStage.variantSku || KOSONG}
                onValueChange={(v) => setNewStage((s) => ({ ...s, variantSku: v === KOSONG ? "" : v }))}
              >
                <SelectTrigger className="w-full min-w-0" aria-label={tj("varian")}>
                  <SelectValue placeholder={tj("varian")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KOSONG}>{tj("tanpaVarian")}</SelectItem>
                  {category.itemVariants.map((v) => (
                    <SelectItem key={v.variantSku} value={v.variantSku}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="self-center text-xs text-muted-foreground">{tj("hubungkanBarang")}</p>
            )}
          </div>
          <Button
            type="button"
            className="w-full sm:w-fit"
            onClick={handleAdd}
            disabled={menyimpan || !newStage.name.trim() || !newStage.targetQty}
          >
            <Plus className="h-4 w-4" />
            {t("addNew")}
          </Button>
        </div>
      )}
    </div>
  );
}

function StageRow({
  stage,
  category,
  supplierOptions,
  opsiBulan,
  disabled,
  canManage,
  woDisabled,
  canCreateWo,
  onUpdateStage,
  onDeleteStage,
  onCreateWo,
}: {
  stage: PlanStageDetail;
  category: PlanCategoryDetail;
  supplierOptions: ComboboxOption[];
  opsiBulan: Array<{ value: string; label: string }>;
  disabled?: boolean;
  canManage?: boolean;
  woDisabled?: boolean;
  canCreateWo?: boolean;
  onUpdateStage: PlanStageHandlers["onUpdateStage"];
  onDeleteStage: (id: string) => Promise<void>;
  onCreateWo: (id: string) => Promise<void>;
}) {
  const t = useTranslations("planning.stages");
  const ta = useTranslations("planning.actions");
  const tj = useTranslations("jadwalProduksi.plan");

  // Aturan yang sama dengan server (tolakUbahTahap): plan terkunci → hanya
  // bulan/varian/penjahit; varian (dan penjahit saat terkunci) beku selama WO hidup.
  const woHidup = !!stage.workOrderId && stage.workOrderStatus !== "CANCELLED";
  const bolehBerjalan = !disabled || !!canManage;
  const bolehBulan = bolehBerjalan;
  const bolehVarian = bolehBerjalan && !woHidup && category.itemVariants.length > 0;
  const bolehPenjahit = !disabled || (!!canManage && !woHidup);
  const varian = opsiVarian(category, stage.variantSku, (sku) => tj("varianAsing", { sku }));

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          className="min-w-0"
          defaultValue={stage.name}
          aria-label={t("namePlaceholder")}
          disabled={disabled}
          onBlur={(e) => {
            const nama = e.target.value.trim();
            if (nama && nama !== stage.name) {
              void onUpdateStage(stage.id, { name: nama });
            }
          }}
        />
        <Input
          className="min-w-0"
          type="number"
          min={1}
          defaultValue={stage.targetQty}
          aria-label={t("qtyPlaceholder")}
          disabled={disabled}
          onBlur={(e) => {
            const val = Number(e.target.value);
            if (Number.isFinite(val) && val !== stage.targetQty) {
              void onUpdateStage(stage.id, { targetQty: val });
            }
          }}
        />
        <Select
          value={stage.targetMonth != null ? String(stage.targetMonth) : KOSONG}
          onValueChange={(v) =>
            void onUpdateStage(stage.id, { targetMonth: v === KOSONG ? null : Number(v) })
          }
          disabled={!bolehBulan}
        >
          <SelectTrigger className="w-full min-w-0" aria-label={tj("bulanTarget")}>
            <SelectValue placeholder={tj("bulanTarget")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={KOSONG}>{tj("tanpaBulan")}</SelectItem>
            {opsiBulan.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={stage.variantSku?.trim() || KOSONG}
          onValueChange={(v) => void onUpdateStage(stage.id, { variantSku: v === KOSONG ? null : v })}
          disabled={!bolehVarian}
        >
          <SelectTrigger className="w-full min-w-0" aria-label={tj("varian")}>
            <SelectValue placeholder={tj("varian")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={KOSONG}>
              {category.itemVariants.length > 0 ? tj("tanpaVarian") : tj("tanpaBarang")}
            </SelectItem>
            {varian.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SearchableCombobox
          className="min-w-0 sm:col-span-2"
          options={[{ value: "", label: "—" }, ...supplierOptions]}
          value={stage.supplierId || ""}
          onValueChange={(value) => void onUpdateStage(stage.id, { supplierId: value || null })}
          placeholder={t("noVendor")}
          disabled={!bolehPenjahit}
        />
      </div>
      {woHidup && bolehBerjalan && (
        <p className="text-xs text-muted-foreground">{tj("dikunciWo")}</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {stage.workOrderId ? (
            <Link href={`/backoffice/work-orders/${stage.workOrderId}`}>
              <Badge variant="outline" className="max-w-full truncate">
                {stage.workOrderDocNumber ?? stage.workOrderId.slice(0, 8)}
                {stage.workOrderStatus ? ` · ${stage.workOrderStatus}` : ""}
              </Badge>
            </Link>
          ) : (
            <Badge variant="secondary">—</Badge>
          )}
          <Badge variant={stage.planCmtAllocationId ? "default" : "secondary"}>
            {stage.planCmtAllocationId ? t("autoStage") : t("manualStage")}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {formatPlanNumber(stage.targetQty)}
          </span>
          <LencanaJadwal ringkasan={stage.jadwal} />
        </div>
        <div className="flex flex-wrap gap-1">
          <Button asChild type="button" size="sm" variant="outline" className="flex-1 sm:flex-none">
            <Link href={tautanRuangKerjaTahap(stage.id)}>
              <CalendarRange className="h-4 w-4" />
              {tj("ruangKerja")}
            </Link>
          </Button>
          <Button
            type="button"
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={() => onCreateWo(stage.id)}
            disabled={!canCreateWo || woDisabled}
          >
            {stage.workOrderId && stage.workOrderStatus === "CANCELLED"
              ? t("createNewWO")
              : t("createWO")}
          </Button>
          {!disabled && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="flex-1 sm:flex-none"
              onClick={() => onDeleteStage(stage.id)}
            >
              {ta("delete")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

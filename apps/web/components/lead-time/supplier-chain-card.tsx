"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ATRIBUT_BUTIR,
  atributDaftar,
  garisSisipDi,
  type PropsPegangan,
  type SesiSeret,
} from "@/components/gerak/useSeretUrut";
import { cn } from "@/lib/utils";
import { StepOverridePopover } from "./step-override-popover";
import { daftarPemasok, sedangDibawa, type DataSeretPapan } from "./seret-papan";
import type { SupplierChainCard } from "@/app/actions/lead-time";

export type SopOption = {
  id: string;
  name: string;
  stepCount: number;
};

type Props = {
  card: SupplierChainCard;
  canManage: boolean;
  assignMode: boolean;
  sopOptions: SopOption[];
  onAssignClick: () => void;
  onRemove: (stepId: string, name: string) => void;
  onReorder: (orderedStepIds: string[]) => void;
  onUpdated: () => void;
  onApplySop: (
    chainTemplateId: string,
    mode: "REPLACE" | "APPEND",
    sopName: string,
    stepCount: number
  ) => void;
  /** Seret-lepas (hanya untuk yang boleh mengelola). */
  seret?: {
    sesi: SesiSeret<DataSeretPapan> | null;
    pegangan: (data: DataSeretPapan) => PropsPegangan;
  };
};

export function SupplierChainCardView({
  card,
  canManage,
  assignMode,
  sopOptions,
  onAssignClick,
  onRemove,
  onReorder,
  onUpdated,
  onApplySop,
  seret,
}: Props) {
  const t = useTranslations("leadTime.papan");
  const tp = useTranslations("leadTime.pustaka");
  const tc = useTranslations("leadTime.common");
  const [editStepId, setEditStepId] = useState<string | null>(null);

  const weeks = (card.totalDaysFixedOnly / 7).toFixed(1);
  const months = (card.totalDaysFixedOnly / 30).toFixed(1);
  const totalLabel = `${card.hasPerQty ? `${t("minPrefix")} ` : ""}${t("totalFormat", {
    days: card.totalDaysFixedOnly,
    weeks,
    months,
  })}`;
  const isEmpty = card.steps.length === 0;

  const daftar = daftarPemasok(card.supplierId);
  const dataSeret = seret?.sesi?.data ?? null;
  const membawaProses = dataSeret?.jenis === "proses";
  const jadiSasaran = seret?.sesi?.sasaran?.daftar === daftar;
  const dariSeret =
    dataSeret?.jenis === "langkah" && dataSeret.supplierId === card.supplierId
      ? card.steps.findIndex((x) => x.id === dataSeret.stepId)
      : -1;
  const garisSisip = (i: number) =>
    garisSisipDi(seret?.sesi ?? null, daftar, i, dariSeret >= 0 ? dariSeret : null) ? (
      <div aria-hidden className="my-0.5 h-0.5 rounded-full bg-primary" />
    ) : null;

  function move(index: number, dir: -1 | 1) {
    const ids = card.steps.map((s) => s.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    const tmp = ids[index];
    ids[index] = ids[j];
    ids[j] = tmp;
    onReorder(ids);
  }

  function applyMenu() {
    if (!canManage) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant={isEmpty ? "default" : "outline"}
            onClick={(e) => e.stopPropagation()}
          >
            {t("applySop")}
            <ChevronDown className="h-3.5 w-3.5 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {sopOptions.length === 0 ? (
            <DropdownMenuItem disabled>{t("noSops")}</DropdownMenuItem>
          ) : (
            sopOptions.map((sop) => (
              <DropdownMenuSub key={sop.id}>
                <DropdownMenuSubTrigger>{sop.name}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    onClick={() =>
                      onApplySop(sop.id, "REPLACE", sop.name, sop.stepCount)
                    }
                  >
                    {t("applyReplace")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      onApplySop(sop.id, "APPEND", sop.name, sop.stepCount)
                    }
                  >
                    {t("applyAppend")}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Card
      {...(seret ? atributDaftar(daftar) : {})}
      className={cn(
        assignMode && "cursor-pointer ring-1 ring-amber-400/60 hover:ring-2",
        membawaProses && "outline-dashed outline-2 outline-offset-2 outline-primary/40",
        membawaProses && jadiSasaran && "bg-primary/5 outline-primary",
      )}
      onClick={assignMode ? onAssignClick : undefined}
    >
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2 space-y-0">
        <CardTitle className="text-sm font-semibold">
          {card.code} · {card.name}{" "}
          <span className="font-normal text-muted-foreground">({totalLabel})</span>
        </CardTitle>
        {applyMenu()}
      </CardHeader>
      <CardContent className="space-y-1" onClick={(e) => e.stopPropagation()}>
        {isEmpty ? (
          <>
            {garisSisip(0)}
            <p className="text-sm text-muted-foreground">{t("emptyChain")}</p>
          </>
        ) : (
          card.steps.map((step, index) => {
            const tmpl = step.processTemplate;
            const effectiveDays = step.overrideDays ?? tmpl.days;
            const effectiveRateQty = step.overrideRateQty ?? tmpl.rateQty;
            const isPerQty = tmpl.leadTimeType === "PER_QTY";
            const isOverride = step.overrideDays != null || step.overrideRateQty != null;
            const archived = !tmpl.isActive;
            const durationLabel = isPerQty
              ? tp("perQtyValue", {
                  days: effectiveDays,
                  rateQty: effectiveRateQty ?? 0,
                })
              : `${effectiveDays}h`;
            const diangkat = sedangDibawa(dataSeret, { jenis: "langkah", stepId: step.id });
            return (
              <div key={step.id}>
              {garisSisip(index)}
              <div
                {...ATRIBUT_BUTIR}
                className={cn(
                  "flex items-center gap-2 text-sm py-1",
                  index < card.steps.length - 1 && "border-b",
                  archived && "opacity-50",
                  diangkat &&
                    "rounded-md bg-primary/10 shadow-md ring-1 ring-primary/40 motion-safe:scale-[1.01] motion-safe:transition-transform",
                )}
              >
                {canManage && seret ? (
                  <span
                    {...seret.pegangan({
                      jenis: "langkah",
                      supplierId: card.supplierId,
                      stepId: step.id,
                      nama: tmpl.name,
                    })}
                    aria-hidden
                    title={t("seretLangkah")}
                    className="-ml-1 flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing"
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                  </span>
                ) : null}
                <div className="flex-1 min-w-0">
                  <div className="font-medium flex items-center gap-1 flex-wrap">
                    <span className="truncate">
                      {tmpl.name}
                      {archived ? ` ${tc("archivedSuffix")}` : ""}
                    </span>
                    {tmpl.isApproval && (
                      <Badge
                        variant="outline"
                        className="text-[10px] shrink-0"
                        title={tp("isApproval")}
                      >
                        ✋
                      </Badge>
                    )}
                    {isPerQty && (
                      <Badge
                        variant="outline"
                        className="border-amber-500 text-amber-700 text-[10px] shrink-0"
                      >
                        {tp("perQty")}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 text-muted-foreground">
                  {isOverride && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" />
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("overrideTooltip", {
                            default: tmpl.days,
                          })}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  <span className="text-xs whitespace-nowrap">{durationLabel}</span>
                </div>
                {canManage && (
                  <div className="flex items-center gap-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label={t("moveUpAria", { name: tmpl.name })}
                      title={t("moveUp")}
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label={t("moveDownAria", { name: tmpl.name })}
                      title={t("moveDown")}
                      onClick={() => move(index, 1)}
                      disabled={index === card.steps.length - 1}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <StepOverridePopover
                      open={editStepId === step.id}
                      onOpenChange={(o) => setEditStepId(o ? step.id : null)}
                      step={step}
                      onSaved={onUpdated}
                      trigger={
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          aria-label={t("editStepAria", { name: tmpl.name })}
                          title={t("editStepAria", { name: tmpl.name })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      }
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label={t("removeStepAria", { name: tmpl.name })}
                      title={t("removeStepAria", { name: tmpl.name })}
                      onClick={() =>
                        onRemove(step.id, step.processTemplate.name)
                      }
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              {index === card.steps.length - 1 ? garisSisip(card.steps.length) : null}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

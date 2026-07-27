"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ChevronDown, Pencil, X } from "lucide-react";
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
import { StepOverridePopover } from "./step-override-popover";
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
}: Props) {
  const t = useTranslations("leadTime.papan");
  const tp = useTranslations("leadTime.pustaka");
  const [editStepId, setEditStepId] = useState<string | null>(null);

  const weeks = (card.totalDaysFixedOnly / 7).toFixed(1);
  const months = (card.totalDaysFixedOnly / 30).toFixed(1);
  const totalLabel = `${card.hasPerQty ? `${t("minPrefix")} ` : ""}${t("totalFormat", {
    days: card.totalDaysFixedOnly,
    weeks,
    months,
  })}`;
  const isEmpty = card.steps.length === 0;

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
      className={assignMode ? "cursor-pointer ring-1 ring-amber-400/60 hover:ring-2" : undefined}
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
          <p className="text-sm text-muted-foreground">{t("emptyChain")}</p>
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
            return (
              <div
                key={step.id}
                className={`flex items-center gap-2 text-sm py-1 border-b last:border-0 ${
                  archived ? "opacity-50" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium flex items-center gap-1 flex-wrap">
                    <span className="truncate">
                      {tmpl.name}
                      {archived ? " (arsip)" : ""}
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
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
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
                        <Button size="icon" variant="ghost" className="h-7 w-7">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      }
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() =>
                        onRemove(step.id, step.processTemplate.name)
                      }
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

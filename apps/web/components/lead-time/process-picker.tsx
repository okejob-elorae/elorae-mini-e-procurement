"use client";

import { useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { GripVertical, ListChecks, Search } from "lucide-react";
import { formatAngka } from "@/app/backoffice/lead-time/papan-aturan";
import type { PropsPegangan } from "@/components/gerak/useSeretUrut";
import { cn } from "@/lib/utils";
import type { DataSeretPapan } from "./seret-papan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type PickerTemplate = {
  id: string;
  name: string;
  leadTimeType: "FIXED" | "PER_QTY";
  days: number;
  rateQty: number | null;
  isApproval?: boolean;
};

type Props = {
  templates: PickerTemplate[];
  search: string;
  onSearchChange: (v: string) => void;
  selectedId: string | null;
  onSelect: (t: PickerTemplate | null) => void;
  /** Pegangan seret ke kartu pemasok; tanpa ini palet hanya bisa diklik. */
  pegangan?: (data: DataSeretPapan) => PropsPegangan;
  /** Proses yang sedang diseret (tampil terangkat). */
  dibawaId?: string | null;
  /**
   * "Centang pemasok…" untuk proses yang dipilih. Ada = boleh mengelola: tombolnya
   * selalu tampil, nonaktif dengan alasan selama belum ada proses yang dipilih.
   */
  onCentang?: () => void;
};

export function ProcessPicker({
  templates,
  search,
  onSearchChange,
  selectedId,
  onSelect,
  pegangan,
  dibawaId = null,
  onCentang,
}: Props) {
  const t = useTranslations("leadTime.papan");
  const tp = useTranslations("leadTime.pustaka");
  const locale = useLocale();
  const idAlasan = useId();
  const selected = templates.find((x) => x.id === selectedId) ?? null;

  return (
    <Card className="sticky top-4 w-full max-w-[280px] shrink-0">
      <CardHeader className="space-y-2 pb-2">
        <CardTitle className="text-base">{t("pickerTitle")}</CardTitle>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={tp("searchV2")}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 max-h-[70vh] overflow-y-auto">
        {onCentang && !selected ? (
          <div className="space-y-1">
            <Button size="sm" variant="outline" disabled aria-describedby={idAlasan}>
              <ListChecks className="mr-1 h-3.5 w-3.5" />
              {t("centang.tombol")}
            </Button>
            <p id={idAlasan} className="text-xs text-muted-foreground">
              {t("centangAlasan")}
            </p>
          </div>
        ) : null}
        {selected && (
          <div className="rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2 py-2 text-xs space-y-1">
            <p>{t("assignBanner", { name: selected.name })}</p>
            <div className="flex flex-wrap gap-1">
              {onCentang ? (
                <Button size="sm" variant="outline" onClick={onCentang}>
                  <ListChecks className="mr-1 h-3.5 w-3.5" />
                  {t("centang.tombol")}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
                {t("cancelV2")}
              </Button>
            </div>
          </div>
        )}
        {templates.map((tmpl) => (
          <button
            key={tmpl.id}
            type="button"
            {...(pegangan ? pegangan({ jenis: "proses", template: tmpl }) : {})}
            onClick={() => onSelect(tmpl)}
            title={pegangan ? t("seretPalet") : undefined}
            className={cn(
              "flex w-full items-start gap-1.5 rounded-md border px-2 py-2 text-left text-sm hover:bg-muted/50",
              selectedId === tmpl.id && "border-primary bg-muted/40",
              pegangan && "cursor-grab active:cursor-grabbing",
              dibawaId === tmpl.id && "opacity-60 shadow-md ring-2 ring-primary motion-safe:scale-[0.98] motion-safe:transition-transform",
            )}
          >
            {pegangan ? (
              <span
                aria-hidden
                className="-ml-1 flex h-6 w-5 shrink-0 touch-none items-center justify-center text-muted-foreground"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </span>
            ) : null}
            <span className="block min-w-0 flex-1">
            <div className="font-medium flex items-center gap-1 flex-wrap">
              {tmpl.name}
              {tmpl.isApproval && (
                <Badge
                  variant="outline"
                  className="text-[10px]"
                  title={tp("isApproval")}
                >
                  ✋
                </Badge>
              )}
              {tmpl.leadTimeType === "PER_QTY" && (
                <Badge variant="outline" className="border-amber-500 text-amber-700 text-[10px]">
                  {tp("perQtyV2")}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {tmpl.leadTimeType === "PER_QTY"
                ? tp("perQtyValue", {
                    days: formatAngka(tmpl.days, locale),
                    rateQty: formatAngka(tmpl.rateQty ?? 0, locale),
                  })
                : tp("days", { days: formatAngka(tmpl.days, locale) })}
            </div>
            </span>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

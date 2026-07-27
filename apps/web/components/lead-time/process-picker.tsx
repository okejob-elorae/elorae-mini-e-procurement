"use client";

import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
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
};

export function ProcessPicker({
  templates,
  search,
  onSearchChange,
  selectedId,
  onSelect,
}: Props) {
  const t = useTranslations("leadTime.papan");
  const tp = useTranslations("leadTime.pustaka");
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
            placeholder={tp("search")}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 max-h-[70vh] overflow-y-auto">
        {selected && (
          <div className="rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2 py-2 text-xs space-y-1">
            <p>{t("assignBanner", { name: selected.name })}</p>
            <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
              {t("cancel")}
            </Button>
          </div>
        )}
        {templates.map((tmpl) => (
          <button
            key={tmpl.id}
            type="button"
            onClick={() => onSelect(tmpl)}
            className={`w-full text-left rounded-md border px-2 py-2 text-sm hover:bg-muted/50 ${
              selectedId === tmpl.id ? "border-primary bg-muted/40" : ""
            }`}
          >
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
                  {tp("perQty")}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {tmpl.leadTimeType === "PER_QTY"
                ? tp("perQtyValue", { days: tmpl.days, rateQty: tmpl.rateQty ?? 0 })
                : tp("days", { days: tmpl.days })}
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

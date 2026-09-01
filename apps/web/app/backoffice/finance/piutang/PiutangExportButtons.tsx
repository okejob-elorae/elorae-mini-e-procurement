"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportReceivablesReport } from "@/app/actions/reports/piutang";
import type { ReceivableFilters } from "@/lib/finance/ar/queries";

type Props = { filters: ReceivableFilters };

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function PiutangExportButtons({ filters }: Props) {
  const t = useTranslations("piutang.export");
  const [pending, setPending] = useState<"csv" | "excel" | null>(null);

  async function handleExport(format: "csv" | "excel") {
    setPending(format);
    try {
      const result = await exportReceivablesReport(filters, format);
      if (result.data !== undefined) {
        downloadBlob(new Blob([result.data], { type: "text/csv;charset=utf-8" }), result.filename);
      } else {
        const bin = atob(result.base64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        downloadBlob(
          new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
          result.filename,
        );
      }
      if (result.truncated) {
        toast.warning(t("truncated", { total: result.totalRows }));
      } else {
        toast.success(t("started"));
      }
    } catch {
      toast.error(t("failed"));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" onClick={() => handleExport("csv")} disabled={pending !== null}>
        {pending === "csv" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {t("csv")}
      </Button>
      <Button variant="outline" onClick={() => handleExport("excel")} disabled={pending !== null}>
        {pending === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {t("excel")}
      </Button>
    </div>
  );
}

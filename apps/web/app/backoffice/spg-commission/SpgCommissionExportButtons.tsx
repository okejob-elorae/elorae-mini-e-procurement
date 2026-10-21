"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportSpgCommissionRecap } from "@/app/actions/reports/spg-commission";

type Props = { month: string; disabled?: boolean };

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SpgCommissionExportButtons({ month, disabled = false }: Props) {
  const t = useTranslations("spgCommission.export");
  const [pending, setPending] = useState<"csv" | "excel" | null>(null);

  async function handleExport(format: "csv" | "excel") {
    setPending(format);
    try {
      const result = await exportSpgCommissionRecap(month, format);
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
      toast.success(t("started"));
    } catch {
      toast.error(t("failed"));
    } finally {
      setPending(null);
    }
  }

  const isDisabled = disabled || pending !== null;

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        className="h-10 flex-1 sm:flex-none"
        onClick={() => void handleExport("csv")}
        disabled={isDisabled}
      >
        {pending === "csv" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {t("csv")}
      </Button>
      <Button
        variant="outline"
        className="h-10 flex-1 sm:flex-none"
        onClick={() => void handleExport("excel")}
        disabled={isDisabled}
      >
        {pending === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {t("excel")}
      </Button>
    </div>
  );
}

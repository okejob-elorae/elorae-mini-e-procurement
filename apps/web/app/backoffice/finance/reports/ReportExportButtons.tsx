"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  onExcel: () => Promise<{ base64: string; filename: string }>;
  printHref: string;
};

/**
 * Excel download plus a print link, shared by all three financial reports so
 * each page wires its own action and print route and nothing else.
 */
export function ReportExportButtons({ onExcel, printHref }: Props) {
  const t = useTranslations("financeReports");
  const [isExporting, setIsExporting] = useState(false);

  async function downloadExcel() {
    setIsExporting(true);
    try {
      const result = await onExcel();
      const bin = atob(result.base64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("export.started"));
    } catch {
      toast.error(t("export.failed"));
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" onClick={downloadExcel} disabled={isExporting}>
        <Download className="mr-2 h-4 w-4" />
        {t("export.excel")}
      </Button>
      <Button variant="outline" asChild>
        <a href={printHref} target="_blank" rel="noopener noreferrer">
          <Printer className="mr-2 h-4 w-4" />
          {t("export.print")}
        </a>
      </Button>
    </div>
  );
}

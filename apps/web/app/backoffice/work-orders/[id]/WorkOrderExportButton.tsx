"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportWorkOrderXlsx } from "@/app/actions/work-order-export";
import { downloadBase64File, XLSX_MIME } from "@/lib/download-file";

export function WorkOrderExportButton({ workOrderId }: { workOrderId: string }) {
  const t = useTranslations("workOrders");
  const [pending, setPending] = useState(false);

  async function handleExport() {
    setPending(true);
    try {
      const result = await exportWorkOrderXlsx(workOrderId);
      if (result.status === "ok") {
        downloadBase64File(result.base64, result.filename, XLSX_MIME);
      } else if (result.status === "forbidden") {
        toast.error(t("export.forbidden"));
      } else {
        toast.error(t("export.notFound"));
      }
    } catch {
      toast.error(t("export.failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant="outline"
      onClick={() => void handleExport()}
      disabled={pending}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {pending ? t("export.exporting") : t("export.button")}
    </Button>
  );
}

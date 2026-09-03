"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { getShipmentAction, completeShipmentAction } from "@/app/actions/delivery-shipments";

type Props = {
  shipmentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
};

type Line = { id: string; productName: string; plannedQty: number };

export function CompleteShipmentDialog({ shipmentId, open, onOpenChange, onDone }: Props) {
  const t = useTranslations("deliveryShipments");
  const [lines, setLines] = useState<Line[]>([]);
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>({});
  const [proofPhotoUrl, setProofPhotoUrl] = useState("");
  const [proofPhotoR2Key, setProofPhotoR2Key] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [uploading, setUploading] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setInvoiceDate(formatDateOnlyJakarta(new Date()));
    setDueDate(formatDateOnlyJakarta(new Date()));
    setProofPhotoUrl("");
    setProofPhotoR2Key("");
    getShipmentAction(shipmentId).then((detail) => {
      if (!detail) return;
      const nextLines = detail.lines.map((l) => ({ id: l.id, productName: l.productName, plannedQty: l.plannedQty }));
      setLines(nextLines);
      setQtyInputs(Object.fromEntries(nextLines.map((l) => [l.id, String(l.plannedQty)])));
    });
  }, [open, shipmentId]);

  async function handleUpload(file: File): Promise<void> {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("shipmentId", shipmentId);
      const res = await fetch("/backoffice/api/upload/delivery-proof", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Upload failed");
        return;
      }
      setProofPhotoUrl(data.url);
      setProofPhotoR2Key(data.key);
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit(): void {
    if (!proofPhotoUrl) {
      toast.error(t("proofPhotoRequired"));
      return;
    }
    const payloadLines = lines.map((line) => ({
      shipmentLineId: line.id,
      deliveredQty: Number(qtyInputs[line.id] ?? "0"),
    }));
    startTransition(async () => {
      const result = await completeShipmentAction({
        shipmentId,
        proofPhotoUrl,
        proofPhotoR2Key,
        invoiceDate,
        dueDate,
        lines: payloadLines,
      });
      if (!result.ok) {
        toast.error(t(`err.${result.reason}` as any));
        return;
      }
      toast.success(t("complete"));
      onOpenChange(false);
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("completeTitle")}</DialogTitle>
          <DialogDescription>{t("completeDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="proofPhoto">{t("proofPhoto")}</Label>
            <Input
              id="proofPhoto"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
            {uploading && <p className="mt-1 text-xs text-muted-foreground">{t("uploading")}</p>}
            {proofPhotoUrl && !uploading && (
              <img src={proofPhotoUrl} alt="" className="mt-2 h-24 w-24 rounded object-cover" />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="invoiceDate">{t("invoiceDate")}</Label>
              <Input id="invoiceDate" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="dueDate">{t("dueDate")}</Label>
              <Input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            {lines.map((line) => (
              <div key={line.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-sm">{line.productName}</span>
                <Input
                  type="number"
                  min={0}
                  max={line.plannedQty}
                  className="w-24"
                  value={qtyInputs[line.id] ?? ""}
                  onChange={(e) => setQtyInputs((prev) => ({ ...prev, [line.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending || uploading}>
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

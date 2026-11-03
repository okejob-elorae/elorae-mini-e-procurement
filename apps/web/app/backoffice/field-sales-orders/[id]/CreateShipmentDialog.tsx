"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { createShipmentAction } from "@/app/actions/delivery-shipments";
import { computeDueDate } from "@/lib/field-sales/delivery/plan";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { parseDateOnlyInput } from "./nota-dialog";

type Line = { id: string; productName: string; outstanding: number };

type Props = {
  orderId: string;
  /** PUTUS issues the nota tagihan when the shipment is created; KONSI moves the goods into transit. */
  orderType?: "PUTUS" | "KONSI";
  /** The store's payment tempo in days — prefills the due date (still editable). */
  paymentTempo?: number;
  lines: Line[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** A fresh key per dialog open; kept across retries so a double submit makes one shipment. */
function kunciBaru(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function CreateShipmentDialog({ orderId, orderType = "PUTUS", paymentTempo = 0, lines, open, onOpenChange }: Props) {
  const t = useTranslations("deliveryShipments");
  const router = useRouter();
  const [method, setMethod] = useState<"EXPEDITION" | "SALESMAN_CARRY">("EXPEDITION");
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>({});
  const [kunci, setKunci] = useState<string>(() => kunciBaru());
  const [dueDate, setDueDate] = useState("");
  const [isPending, startTransition] = useTransition();
  const putus = orderType === "PUTUS";

  const rows = lines.filter((line) => line.outstanding > 0);
  /* The nota is dated the WIB day the shipment is created (P17); only the due date is asked. */
  const notaDate = formatDateOnlyJakarta(new Date());

  useEffect(() => {
    if (!open) return;
    setMethod("EXPEDITION");
    setQtyInputs(Object.fromEntries(rows.map((line) => [line.id, String(line.outstanding)])));
    setKunci(kunciBaru());
    const hariIni = parseDateOnlyInput(formatDateOnlyJakarta(new Date()));
    setDueDate(hariIni && paymentTempo > 0 ? formatDateOnlyJakarta(computeDueDate(hariIni, paymentTempo)) : "");
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open]);

  const parsedDue = parseDateOnlyInput(dueDate);
  const parsedNota = parseDateOnlyInput(notaDate);
  const dueBeforeNota = parsedDue !== null && parsedNota !== null && parsedDue.getTime() < parsedNota.getTime();
  const datesReady = !putus || (parsedDue !== null && !dueBeforeNota);

  function handleSubmit(): void {
    const payloadLines = rows
      .map((line) => ({ orderLineId: line.id, qty: Number(qtyInputs[line.id] ?? "0") }))
      .filter((line) => line.qty > 0);
    startTransition(async () => {
      try {
        const result = await createShipmentAction({
          orderId,
          method,
          lines: payloadLines,
          idempotencyKey: kunci,
          ...(putus ? { dueDate } : {}),
        });
        if (!result.ok) {
          toast.error(t(`err.${result.reason}` as any, { detail: result.detail ?? "" }));
          return;
        }
        toast.success(result.ulang && result.docNo ? t("createShipmentUlang", { docNo: result.docNo }) : t("createShipment"));
        onOpenChange(false);
        router.refresh();
      } catch {
        toast.error(t("err.UNEXPECTED"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("createShipmentTitle")}</DialogTitle>
          <DialogDescription>{t("createShipmentDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{putus ? t("createShipmentPutusNote") : t("createShipmentKonsiNote")}</p>
          <div>
            <Label>{t("methodLabel")}</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as "EXPEDITION" | "SALESMAN_CARRY")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EXPEDITION">{t("methodExpedition")}</SelectItem>
                <SelectItem value="SALESMAN_CARRY">{t("methodSalesmanCarry")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {putus && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="create-shipment-nota-date" className="text-xs text-muted-foreground">
                  {t("notaDateLabel")}
                </Label>
                <TanggalInput id="create-shipment-nota-date" className="h-10" value={notaDate} disabled onChange={() => undefined} />
                <p className="text-xs text-muted-foreground">{t("notaDateFixed")}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="create-shipment-due-date" className="text-xs text-muted-foreground">
                  {t("dueDateLabel")}
                </Label>
                <TanggalInput
                  id="create-shipment-due-date"
                  className="h-10"
                  value={dueDate}
                  min={notaDate}
                  disabled={isPending}
                  onChange={(e) => setDueDate(e.target.value)}
                />
                {dueDate === "" && <p className="text-xs text-muted-foreground">{t("dueDateRequired")}</p>}
                {dueBeforeNota && <p className="text-xs text-destructive">{t("dueDateBeforeNota")}</p>}
              </div>
            </div>
          )}
          <div className="space-y-2">
            {rows.map((line) => (
              <div key={line.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-sm">{line.productName}</span>
                <Input
                  type="number"
                  min={0}
                  max={line.outstanding}
                  className="w-24"
                  value={qtyInputs[line.id] ?? ""}
                  onChange={(e) => setQtyInputs((prev) => ({ ...prev, [line.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending || !datesReady}>
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { createShipmentAction } from "@/app/actions/delivery-shipments";

type Line = { id: string; productName: string; outstanding: number };

type Props = {
  orderId: string;
  lines: Line[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CreateShipmentDialog({ orderId, lines, open, onOpenChange }: Props) {
  const t = useTranslations("deliveryShipments");
  const router = useRouter();
  const [method, setMethod] = useState<"EXPEDITION" | "SALESMAN_CARRY">("EXPEDITION");
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const rows = lines.filter((line) => line.outstanding > 0);

  useEffect(() => {
    if (!open) return;
    setMethod("EXPEDITION");
    setQtyInputs(Object.fromEntries(rows.map((line) => [line.id, String(line.outstanding)])));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open]);

  function handleSubmit(): void {
    const payloadLines = rows
      .map((line) => ({ orderLineId: line.id, qty: Number(qtyInputs[line.id] ?? "0") }))
      .filter((line) => line.qty > 0);
    startTransition(async () => {
      /**
       * `OVER_PLANNED` is genuinely reachable from here now that `createDeliveryShipment` also
       * subtracts quantity already claimed by other open shipments on the same order line, while
       * the prefill below still suggests the plain outstanding figure. That arrives as a mapped
       * reason; the catch covers an unexpected rejection, which would otherwise be swallowed by
       * the transition and leave the dialog dead.
       */
      try {
        const result = await createShipmentAction({ orderId, method, lines: payloadLines });
        if (!result.ok) {
          toast.error(t(`err.${result.reason}` as any));
          return;
        }
        toast.success(t("createShipment"));
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
          <Button onClick={handleSubmit} disabled={isPending}>
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

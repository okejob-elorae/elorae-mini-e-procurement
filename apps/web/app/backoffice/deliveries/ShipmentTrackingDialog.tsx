"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getShipmentAction,
  updateShipmentTrackingAction,
  shipShipmentAction,
  cancelShipmentAction,
} from "@/app/actions/delivery-shipments";
import { formatDateOnlyJakarta } from "@/lib/date-only";

type Props = {
  shipmentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  carriers: { id: string; name: string }[];
};

export function ShipmentTrackingDialog({ shipmentId, open, onOpenChange, onDone, carriers }: Props) {
  const t = useTranslations("deliveryShipments");
  const [carrierName, setCarrierName] = useState("");
  const [resiNumber, setResiNumber] = useState("");
  const [method, setMethod] = useState("");
  const [carriedById, setCarriedById] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    getShipmentAction(shipmentId).then((detail) => {
      setCarrierName(detail?.carrierName ?? "");
      setResiNumber(detail?.resiNumber ?? "");
      setMethod(detail?.method ?? "");
      setCarriedById(detail?.carriedById ?? "");
      setInvoiceDate(detail?.invoiceDate ? formatDateOnlyJakarta(detail.invoiceDate) : "");
      setDueDate(detail?.dueDate ? formatDateOnlyJakarta(detail.dueDate) : "");
    });
  }, [open, shipmentId]);

  /**
   * Every action call below is wrapped. A rejection inside `startTransition` is otherwise
   * swallowed whole — no toast, no state change, the dialog simply stops responding — and in
   * production a thrown server action is digest-masked, so there is nothing for the operator to
   * read either. The action layer's `mapError` returns a named reason for everything it can
   * classify; these catches cover the rest.
   */
  function handleSave(): void {
    startTransition(async () => {
      try {
        const result = await updateShipmentTrackingAction({
          shipmentId,
          carrierName,
          resiNumber,
          carriedById: carriedById || undefined,
          invoiceDate: invoiceDate || undefined,
          dueDate: dueDate || undefined,
        });
        if (!result.ok) {
          toast.error(t(`err.${result.reason}` as any));
          return;
        }
        toast.success(t("save"));
        onDone();
      } catch {
        toast.error(t("err.UNEXPECTED"));
      }
    });
  }

  function handleShip(): void {
    if (method === "SALESMAN_CARRY" && (!carriedById || !invoiceDate || !dueDate)) {
      toast.error(t("err.MISSING_CARRIER"));
      return;
    }
    if (!resiNumber) {
      toast.error(t("shipMissingResi"));
      return;
    }
    startTransition(async () => {
      try {
        const trackingResult = await updateShipmentTrackingAction({
          shipmentId,
          carrierName,
          resiNumber,
          carriedById: carriedById || undefined,
          invoiceDate: invoiceDate || undefined,
          dueDate: dueDate || undefined,
        });
        if (!trackingResult.ok) {
          toast.error(t(`err.${trackingResult.reason}` as any));
          return;
        }
        const result = await shipShipmentAction({ shipmentId });
        if (!result.ok) {
          toast.error(t(`err.${result.reason}` as any));
          return;
        }
        toast.success(t("ship"));
        onOpenChange(false);
        onDone();
      } catch {
        toast.error(t("err.UNEXPECTED"));
      }
    });
  }

  function handleCancel(): void {
    if (!confirm(t("cancelConfirm"))) return;
    startTransition(async () => {
      try {
        const result = await cancelShipmentAction({ shipmentId });
        if (!result.ok) {
          toast.error(t(`err.${result.reason}` as any));
          return;
        }
        onOpenChange(false);
        onDone();
      } catch {
        toast.error(t("err.UNEXPECTED"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editTrackingTitle")}</DialogTitle>
          <DialogDescription>{t("editTrackingDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="carrierName">{t("carrierNameLabel")}</Label>
            <Input id="carrierName" value={carrierName} onChange={(e) => setCarrierName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="resiNumber">{t("resiNumberLabel")}</Label>
            <Input id="resiNumber" value={resiNumber} onChange={(e) => setResiNumber(e.target.value)} />
          </div>
          {method === "SALESMAN_CARRY" && (
            <>
              <div>
                <Label htmlFor="carriedBy">{t("carriedByLabel")}</Label>
                <SearchableCombobox
                  id="carriedBy"
                  options={carriers.map((c) => ({ value: c.id, label: c.name }))}
                  value={carriedById}
                  onValueChange={setCarriedById}
                  placeholder={t("carriedByPlaceholder")}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="invoiceDate">{t("invoiceDateLabel")}</Label>
                  <Input
                    id="invoiceDate"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="dueDate2">{t("dueDateLabel2")}</Label>
                  <Input id="dueDate2" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>
            </>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="destructive" onClick={handleCancel} disabled={isPending}>
            {t("cancel")}
          </Button>
          <Button variant="outline" onClick={handleSave} disabled={isPending}>
            {t("save")}
          </Button>
          <Button onClick={handleShip} disabled={isPending}>
            {t("ship")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

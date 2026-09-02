"use client";

import { useState } from "react";
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
import { markCreatedAction } from "@/app/actions/tax-invoices";
import { looksLikeDjpInvoiceNumber } from "@/lib/tax-invoices/invoice-number-format";

type Row = { id: string; docNo: string; storeId: string; storeNpwp: string | null };

type Props = {
  row: Row | null;
  ppnRatePercent: number;
  onClose: () => void;
  onSuccess: () => void;
};

/** Same rounding the writer applies server-side — the preview shown here must not disagree with what gets saved. */
function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function MarkCreatedDialog({ row, ppnRatePercent, onClose, onSuccess }: Props) {
  const t = useTranslations("fakturPajak");
  const tCommon = useTranslations("common");
  const [isPending, setIsPending] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [buyerNpwp, setBuyerNpwp] = useState(row?.storeNpwp ?? "");
  const [taxableAmount, setTaxableAmount] = useState<number | "">("");
  const [ppnAmount, setPpnAmount] = useState<number | "">("");
  const [ppnTouched, setPpnTouched] = useState(false);

  if (!row) return null;

  const trimmedInvoiceNo = invoiceNo.trim();
  const trimmedNpwp = buyerNpwp.trim();
  const npwpMissingOnStore = row.storeNpwp === null || row.storeNpwp.trim() === "";
  const canSubmit =
    !isPending &&
    trimmedInvoiceNo !== "" &&
    trimmedNpwp !== "" &&
    typeof taxableAmount === "number" && Number.isFinite(taxableAmount) && taxableAmount >= 0 &&
    typeof ppnAmount === "number" && Number.isFinite(ppnAmount) && ppnAmount >= 0;

  function handleTaxableAmountChange(raw: string): void {
    const parsed = raw === "" ? "" : Number(raw);
    setTaxableAmount(parsed);
    /* Editing taxableAmount recomputes ppnAmount UNLESS the admin has already typed their own
       ppnAmount by hand — editing ppnAmount directly must never be fought by a recompute. */
    if (!ppnTouched && typeof parsed === "number" && Number.isFinite(parsed)) {
      setPpnAmount(roundCents((parsed * ppnRatePercent) / 100));
    }
  }

  function handlePpnAmountChange(raw: string): void {
    setPpnTouched(true);
    setPpnAmount(raw === "" ? "" : Number(raw));
  }

  function handleClose(): void {
    setInvoiceNo("");
    setBuyerNpwp(row?.storeNpwp ?? "");
    setTaxableAmount("");
    setPpnAmount("");
    setPpnTouched(false);
    onClose();
  }

  function handleSubmit(): void {
    if (!canSubmit || typeof taxableAmount !== "number" || typeof ppnAmount !== "number") return;
    setIsPending(true);
    markCreatedAction({
      taxInvoiceId: row.id,
      invoiceNo: trimmedInvoiceNo,
      buyerNpwp: trimmedNpwp,
      taxableAmount,
      ppnAmount,
    })
      .then((result) => {
        if (result.ok) {
          toast.success(t("markCreatedSuccess"));
          handleClose();
          onSuccess();
          return;
        }
        toast.error(t(`actionErr.${result.code}`));
      })
      .catch(() => toast.error(t("errGeneric")))
      .finally(() => setIsPending(false));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("markCreatedTitle")}</DialogTitle>
          <DialogDescription>{t("markCreatedDescription", { docNo: row.docNo })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="mc-invoice-no">{t("markCreatedFieldLabel")}</Label>
            <Input
              id="mc-invoice-no"
              className="h-10"
              value={invoiceNo}
              disabled={isPending}
              placeholder={t("markCreatedFieldPlaceholder")}
              onChange={(e) => setInvoiceNo(e.target.value)}
            />
            {trimmedInvoiceNo !== "" && !looksLikeDjpInvoiceNumber(trimmedInvoiceNo) && (
              <p className="text-xs text-muted-foreground">{t("markCreatedInvoiceNoFormatHint")}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mc-npwp">{t("markCreatedNpwpLabel")}</Label>
            <Input
              id="mc-npwp"
              className="h-10"
              value={buyerNpwp}
              disabled={isPending}
              placeholder={t("markCreatedNpwpPlaceholder")}
              onChange={(e) => setBuyerNpwp(e.target.value)}
            />
            {npwpMissingOnStore && (
              <p className="text-xs text-muted-foreground">
                {t("markCreatedNpwpMissingHint")}{" "}
                <a href={`/backoffice/stores/${row.storeId}`} className="underline" target="_blank" rel="noreferrer">
                  {t("markCreatedNpwpMissingLink")}
                </a>
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mc-taxable">{t("markCreatedTaxableLabel")}</Label>
              <Input
                id="mc-taxable"
                type="number"
                min={0}
                className="h-10"
                value={taxableAmount}
                disabled={isPending}
                onChange={(e) => handleTaxableAmountChange(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mc-ppn">{t("markCreatedPpnLabel", { rate: ppnRatePercent })}</Label>
              <Input
                id="mc-ppn"
                type="number"
                min={0}
                className="h-10"
                value={ppnAmount}
                disabled={isPending}
                onChange={(e) => handlePpnAmountChange(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-10" disabled={isPending} onClick={handleClose}>
            {tCommon("cancel")}
          </Button>
          <Button className="h-10" disabled={!canSubmit} onClick={handleSubmit}>
            {isPending ? t("markCreatedSubmitting") : t("markCreatedSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

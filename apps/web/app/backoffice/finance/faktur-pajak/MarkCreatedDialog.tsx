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
import { looksLikeDjpInvoiceNumber, periksaFormatNomorFaktur } from "@/lib/tax-invoices/invoice-number-format";

type Row = { id: string; docNo: string; storeId: string; storeNpwp: string | null; total: number | null };

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
  /* Prefilled from the nota's own total — the parent remounts this component per row (`key`),
     so these initializers re-run fresh for every faktur rather than carrying a stale figure. */
  const [taxableAmount, setTaxableAmount] = useState<number | "">(row?.total ?? "");
  const [ppnAmount, setPpnAmount] = useState<number | "">(
    row && row.total !== null ? roundCents((row.total * ppnRatePercent) / 100) : "",
  );
  const [ppnTouched, setPpnTouched] = useState(false);
  /* The writer's refusal of the number itself (malformed, or already on another nota) belongs
     under the field, not in a toast that vanishes while the admin is still looking at the number. */
  const [invoiceNoError, setInvoiceNoError] = useState<string | null>(null);

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

  function handleInvoiceNoChange(raw: string): void {
    setInvoiceNo(raw);
    setInvoiceNoError(null);
  }

  function handleClose(): void {
    setInvoiceNo("");
    setInvoiceNoError(null);
    setBuyerNpwp(row?.storeNpwp ?? "");
    setTaxableAmount(row?.total ?? "");
    setPpnAmount(row && row.total !== null ? roundCents((row.total * ppnRatePercent) / 100) : "");
    setPpnTouched(false);
    onClose();
  }

  function handleSubmit(): void {
    if (!row || !canSubmit || typeof taxableAmount !== "number" || typeof ppnAmount !== "number") return;
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
        if (result.code === "NOMOR_FAKTUR_GANDA" || result.code === "NOMOR_FAKTUR_FORMAT") {
          setInvoiceNoError(
            result.code === "NOMOR_FAKTUR_GANDA" && result.dipakaiDi
              ? t("nomorFakturGandaDi", { docNo: result.dipakaiDi })
              : t(`actionErr.${result.code}`),
          );
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
              aria-invalid={invoiceNoError !== null}
              aria-describedby={invoiceNoError !== null ? "mc-invoice-no-error" : undefined}
              onChange={(e) => handleInvoiceNoChange(e.target.value)}
            />
            {invoiceNoError !== null ? (
              <p id="mc-invoice-no-error" role="alert" className="text-sm text-destructive">
                {invoiceNoError}
              </p>
            ) : (
              /* "Can still be saved" only holds for a number the writer accepts; anything else is refused on submit. */
              periksaFormatNomorFaktur(trimmedInvoiceNo) &&
              !looksLikeDjpInvoiceNumber(trimmedInvoiceNo) && (
                <p className="text-xs text-muted-foreground">{t("markCreatedInvoiceNoFormatHint")}</p>
              )
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
                <a href={`/backoffice/stores/${row.storeId}/edit`} className="underline" target="_blank" rel="noreferrer">
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

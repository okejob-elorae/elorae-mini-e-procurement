"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Info, Loader2 } from "lucide-react";
import { recordRoundingAdjustmentAction } from "@/app/actions/payments";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  receivableId: string;
  /* Display only: the writer reads the residue itself and never takes an amount from here. */
  residueLabel: string;
};

/**
 * The write-off control for a receivable left at `PARTIAL` below one rupiah. The parent renders
 * it only for a residue and only for a `payments:manage` holder; the writer re-checks both.
 *
 * The event id is reseeded each time the dialog opens and kept stable across a double-click or a
 * retried confirm inside one opening, so a retry replays the payment already posted instead of
 * posting a second one.
 */
export function RoundingResidueNotice({ receivableId, residueLabel }: Props) {
  const t = useTranslations("piutang");
  const tPayments = useTranslations("payments");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [eventId, setEventId] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const description = t("detail.roundingResidue.description", { amount: residueLabel });
  const dialogTitle = t("detail.roundingResidue.dialogTitle", { amount: residueLabel });

  function handleOpenChange(next: boolean): void {
    if (submitting) return;
    if (next) setEventId(crypto.randomUUID());
    setOpen(next);
  }

  async function handleConfirm(): Promise<void> {
    setSubmitting(true);
    try {
      const result = await recordRoundingAdjustmentAction({ receivableId, eventId });
      if (result.ok) {
        setOpen(false);
        if (result.alreadyApplied) {
          toast.info(t("detail.roundingResidue.alreadyToast"));
        } else {
          toast.success(t("detail.roundingResidue.successToast", { docNo: result.docNo ?? "" }));
        }
        router.refresh();
        return;
      }
      toast.error(tPayments(`err.${result.reason}`));
    } catch {
      toast.error(tPayments("err.ERROR"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>{t("detail.roundingResidue.title")}</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <span>{description}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-fit h-10"
            onClick={() => handleOpenChange(true)}
          >
            {t("detail.roundingResidue.action")}
          </Button>
        </AlertDescription>
      </Alert>

      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t("detail.roundingResidue.dialogDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(e) => {
                /* Keep the dialog open so the pending label stays visible; handleConfirm() closes it. */
                e.preventDefault();
                void handleConfirm();
              }}
            >
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {submitting ? t("detail.roundingResidue.submitting") : t("detail.roundingResidue.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

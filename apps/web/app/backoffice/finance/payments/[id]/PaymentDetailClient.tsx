"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ExternalLink, Loader2, Receipt, XCircle } from "lucide-react";
import type { getPayment } from "@/lib/finance/ar/queries";
import {
  voidPaymentAction,
  postPaymentJournalAction,
  postPaymentVoidJournalAction,
  type PaymentActionReason,
} from "@/app/actions/payments";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

type PaymentDetail = NonNullable<Awaited<ReturnType<typeof getPayment>>>;
type PaymentStatusValue = "POSTED" | "VOIDED";

type Props = {
  payment: PaymentDetail;
  receiptJournalRetryable: boolean;
  voidJournalRetryable: boolean;
};

const STATUS_BADGE_CLASS: Record<PaymentStatusValue, string> = {
  POSTED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  VOIDED: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

function formatRupiahExact(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/**
 * Mirrors the exact check `voidPayment` (`void-writer.ts`) runs server-side: a reason of pure
 * zero-width/format characters (Unicode category `Cf`, e.g. U+200B ZERO WIDTH SPACE) or U+2800
 * BRAILLE PATTERN BLANK survives `.trim()` unchanged, so the confirm button has to test for at
 * least one character outside those classes rather than trusting a non-empty string.
 */
const HAS_VISIBLE_CONTENT = /[^\s\p{Cf}\u2800]/u;

/**
 * Every reason the void/retry actions can return is already covered by `payments.err` — the same
 * record `recordPaymentAction`'s own caller uses — so no separate map is needed here, unlike
 * `ReceivableDetailClient`'s `journalErrorKey`, which maps a different action's reason union.
 */
function errKey(reason: PaymentActionReason): string {
  return `err.${reason}`;
}

export function PaymentDetailClient({ payment: p, receiptJournalRetryable, voidJournalRetryable }: Props) {
  const t = useTranslations("payments");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [postingReceipt, setPostingReceipt] = useState(false);
  const [postingVoidJournal, setPostingVoidJournal] = useState(false);

  const status = p.status as PaymentStatusValue;
  const isVoided = status === "VOIDED";
  const reasonHasVisibleContent = HAS_VISIBLE_CONTENT.test(voidReason);

  async function handleVoid(): Promise<void> {
    setVoiding(true);
    try {
      const result = await voidPaymentAction({ paymentId: p.id, reason: voidReason });
      if (result.ok) {
        setVoidOpen(false);
        setVoidReason("");
        /**
         * `alreadyVoided` is the only signal that distinguishes a real cancellation from a
         * double-click that changed nothing — a flat success toast on the latter would tell the
         * operator this click did something it did not.
         */
        if (result.alreadyVoided) {
          toast.info(t("detail.voidAlreadyVoidedToast"));
        } else {
          toast.success(t("detail.voidSuccessToast", { docNo: p.docNo }));
        }
        router.refresh();
        return;
      }
      toast.error(t(errKey(result.reason)));
    } catch {
      toast.error(t("err.ERROR"));
    } finally {
      setVoiding(false);
    }
  }

  /**
   * `result.ok` is the only signal read for whether THIS attempt posted — never a re-check of
   * `isArJournalRetryable`, which ignores `readAt` and would read "still pending" forever, even
   * immediately after a retry that just succeeded. A failure here always carries a reason already
   * covered by `payments.err`, `STILL_PENDING` included, so it is never reported as a flat
   * success.
   */
  async function handlePostReceiptJournal(): Promise<void> {
    setPostingReceipt(true);
    try {
      const result = await postPaymentJournalAction(p.id);
      if (result.ok) {
        toast.success(t("receiptJournalWarning.successToast"));
        router.refresh();
        return;
      }
      toast.error(t(errKey(result.reason)));
    } catch {
      toast.error(t("err.ERROR"));
    } finally {
      setPostingReceipt(false);
    }
  }

  async function handlePostVoidJournal(): Promise<void> {
    setPostingVoidJournal(true);
    try {
      const result = await postPaymentVoidJournalAction(p.id);
      if (result.ok) {
        toast.success(t("voidJournalWarning.successToast"));
        router.refresh();
        return;
      }
      toast.error(t(errKey(result.reason)));
    } catch {
      toast.error(t("err.ERROR"));
    } finally {
      setPostingVoidJournal(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/backoffice/finance/payments">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("detail.back")}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold font-mono truncate">{p.docNo}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={STATUS_BADGE_CLASS[status]}>
            {t(status === "POSTED" ? "statusPosted" : "statusVoided")}
          </Badge>
          {/* Hidden entirely, not disabled — a VOIDED payment has nothing left to void. */}
          {!isVoided && (
            <Button variant="destructive" className="h-10" onClick={() => setVoidOpen(true)}>
              <XCircle className="h-4 w-4 mr-2" />
              {t("detail.voidButton")}
            </Button>
          )}
        </div>
      </div>

      {receiptJournalRetryable && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("receiptJournalWarning.title")}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{t("receiptJournalWarning.description")}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-fit h-10"
              disabled={postingReceipt}
              onClick={handlePostReceiptJournal}
            >
              {postingReceipt && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {postingReceipt ? t("receiptJournalWarning.retrying") : t("receiptJournalWarning.retryButton")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/**
       * `isVoided` is checked here even though the server only ever raises this flag for a VOIDED
       * payment — the entry gate the server used may be stale by the time this renders (another
       * retry could have won the race between load and click), and this is the ONLY route back to
       * the reversal journal from a VOIDED payment, so it must never render for a POSTED one.
       */}
      {isVoided && voidJournalRetryable && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("voidJournalWarning.title")}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{t("voidJournalWarning.description")}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-fit h-10"
              disabled={postingVoidJournal}
              onClick={handlePostVoidJournal}
            >
              {postingVoidJournal && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {postingVoidJournal ? t("voidJournalWarning.retrying") : t("voidJournalWarning.retryButton")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card className="p-4 space-y-2">
        <h2 className="font-semibold">{t("detail.factsTitle")}</h2>
        <Field label={t("colStore")} value={p.store.name} />
        <Field label={t("detail.paidAtLabel")} value={formatDateOnlyJakarta(p.paidAt)} />
        <Field label={t("colMethod")} value={t(p.method === "CASH" ? "methodCash" : "methodTransfer")} />
        <Field label={t("detail.amountLabel")} value={formatRupiahExact(p.amount)} />
        <Field label={t("detail.referenceLabel")} value={p.reference} />
        <Field label={t("detail.noteLabel")} value={p.note} />
        <Field label={t("detail.recordedByLabel")} value={p.recordedBy.name} />
        {isVoided && (
          <>
            <Field label={t("detail.voidedAtLabel")} value={p.voidedAt ? formatDateOnlyJakarta(p.voidedAt) : null} />
            <Field label={t("detail.voidedByLabel")} value={p.voidedBy?.name ?? null} />
            <Field label={t("detail.voidReasonLabel")} value={p.voidReason} />
          </>
        )}
      </Card>

      <Card className="p-4 space-y-2">
        <h2 className="font-semibold">{t("detail.proofTitle")}</h2>
        {p.proofUrl ? (
          <div className="space-y-2">
            <div className="overflow-hidden rounded-md border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element -- external R2-hosted photo, not an optimizable local asset */}
              <img src={p.proofUrl} alt={t("detail.proofTitle")} className="max-h-[70vh] w-full object-contain" />
            </div>
            <a
              href={p.proofUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm hover:underline"
            >
              {t("detail.proofViewFull")}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("detail.proofEmpty")}</p>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            {t("detail.allocationsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {p.allocations.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">{t("detail.allocationsEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("detail.colNota")}</TableHead>
                    <TableHead className="text-right">{t("detail.colAllocatedAmount")}</TableHead>
                    <TableHead className="text-right">{t("detail.colCurrentOutstanding")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.allocations.map((a) => (
                    <TableRow key={a.receivableId}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        <Link href={`/backoffice/finance/piutang/${a.receivableId}`} className="hover:underline">
                          {a.docNo}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">
                        {formatRupiahExact(a.amount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">
                        {formatRupiahExact(a.outstandingAmount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={voidOpen}
        onOpenChange={(open) => {
          if (voiding) return;
          setVoidOpen(open);
          if (!open) setVoidReason("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("detail.voidDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("detail.voidDialogDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="void-reason">{t("detail.voidReasonFieldLabel")}</Label>
            {/*
              `maxLength` matches the note field in `RecordPaymentSheet`. Without it a pasted
              essay reaches the writer intact and MariaDB rejects the oversized `voidReason` with
              1406, which `toResult` cannot recognise as a `PaymentError` and so collapses to the
              generic `ERROR` — the operator is told the void failed with no hint that the reason
              text was the problem. Capping in the field turns that into an input that simply
              stops accepting characters.
            */}
            <Textarea
              id="void-reason"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              disabled={voiding}
              rows={3}
              maxLength={500}
              placeholder={t("detail.voidReasonPlaceholder")}
              aria-invalid={voidReason.length > 0 && !reasonHasVisibleContent}
            />
            {voidReason.length > 0 && !reasonHasVisibleContent && (
              <p className="text-xs text-destructive">{t("detail.voidReasonRequired")}</p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={voiding}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={voiding || !reasonHasVisibleContent}
              onClick={(e) => {
                /* Keep the dialog open so the pending label is visible; handleVoid() closes it. */
                e.preventDefault();
                handleVoid();
              }}
            >
              {voiding && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {voiding ? t("detail.voidSubmitting") : t("detail.voidConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

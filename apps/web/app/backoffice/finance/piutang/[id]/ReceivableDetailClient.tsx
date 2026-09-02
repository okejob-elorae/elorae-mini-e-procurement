"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ExternalLink, Loader2, Receipt, Wallet } from "lucide-react";
import type { getReceivable, AllocationCandidate } from "@/lib/finance/ar/queries";
import { postFieldDeliveryJournalsAction } from "@/app/actions/field-sales-deliveries";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { AGING_BUCKET_LABELS } from "@/lib/finance/ar/aging";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RecordPaymentSheet } from "./RecordPaymentSheet";
import { AssignCollectorCard } from "./AssignCollectorCard";

type ReceivableDetail = NonNullable<Awaited<ReturnType<typeof getReceivable>>>;
type ReceivableStatusValue = "OUTSTANDING" | "PARTIAL" | "PAID" | "WRITTEN_OFF";
type CollectionSubmissionStatus = "PENDING" | "VERIFIED" | "REJECTED";

type Props = {
  receivable: ReceivableDetail;
  canManagePayments: boolean;
  canManageCollections: boolean;
  journalRetryable: boolean;
  allocationCandidates: AllocationCandidate[];
  collectorCandidates: { id: string; name: string }[];
};

const SUBMISSION_STATUS_BADGE_CLASS: Record<CollectionSubmissionStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  VERIFIED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const SUBMISSION_STATUS_LABEL_KEY: Record<
  CollectionSubmissionStatus,
  "submissionStatusPending" | "submissionStatusVerified" | "submissionStatusRejected"
> = {
  PENDING: "submissionStatusPending",
  VERIFIED: "submissionStatusVerified",
  REJECTED: "submissionStatusRejected",
};

const STATUS_BADGE_CLASS: Record<ReceivableStatusValue, string> = {
  OUTSTANDING: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  PARTIAL: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  PAID: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  WRITTEN_OFF: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

const STATUS_LABEL_KEY: Record<
  ReceivableStatusValue,
  "statusOutstanding" | "statusPartial" | "statusPaid" | "statusWrittenOff"
> = {
  OUTSTANDING: "statusOutstanding",
  PARTIAL: "statusPartial",
  PAID: "statusPaid",
  WRITTEN_OFF: "statusWrittenOff",
};

/**
 * The money card shows sen, unlike the two AR LIST pages, which round to whole rupiah by house
 * convention. The detail card is where an operator decides whether an invoice is settled, and a
 * rounded readout invites a phantom receipt: an outstanding of 0,40 rendered as `Rp 0` beside a
 * `PARTIAL` badge, with "Record payment" still enabled and the sheet prefilling 0,40, makes
 * booking a `Rp 0,40` CASH payment nobody received the cheapest way to clear the badge — posting
 * `DR Cash 0.40` against nothing. Original, Paid and every allocation-history row use it too, so
 * the figures on the page visibly reconcile (`original − paid = outstanding`, and the history rows
 * sum to Paid); rounding some of them and not the others would show arithmetic that does not add
 * up. This is the only formatter on the card — there is no whole-rupiah variant left to reach for
 * by accident.
 *
 * Same shape as the local helper in `RecordPaymentSheet` and `PaymentDetailClient`, which is where
 * an allocation is entered against these figures.
 */
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
 * Every `postFieldDeliveryJournalsAction` failure reason mapped explicitly so a future reason
 * added there does not silently fall through to the generic message without anyone noticing —
 * same shape as `ERROR_CODE_MAP` in `app/actions/payments.ts`. `NOT_RETRYABLE` can still surface
 * here even though the button only renders when the server said retryable: another retry can win
 * the race between this page's load and the click.
 */
function journalErrorKey(reason: string): string {
  switch (reason) {
    case "FORBIDDEN":
      return "journalWarning.err.FORBIDDEN";
    case "INVALID_REQUEST":
      return "journalWarning.err.INVALID_REQUEST";
    case "NOT_RETRYABLE":
      return "journalWarning.err.NOT_RETRYABLE";
    default:
      return "journalWarning.err.GENERIC";
  }
}

export function ReceivableDetailClient({
  receivable: r,
  canManagePayments,
  canManageCollections,
  journalRetryable,
  allocationCandidates,
  collectorCandidates,
}: Props) {
  const t = useTranslations("piutang");
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [postingJournal, setPostingJournal] = useState(false);

  const status = r.status as ReceivableStatusValue;
  const isSettled = status === "PAID" || status === "WRITTEN_OFF";
  const primaryActionLabel = isSettled
    ? t(status === "PAID" ? "detail.primaryActionDisabledPaid" : "detail.primaryActionDisabledWrittenOff")
    : t("recordPaymentAction");
  const isOverdueBucket = r.bucket !== "CURRENT";

  /**
   * `stillPending` is read from the action's own returned outcome, never from re-checking
   * `isArJournalRetryable` — that gate ignores `readAt` and nothing in production clears a
   * JOURNAL_PENDING row, so it would read "still pending" forever, even immediately after a
   * retry that just succeeded. Reporting "posted" when one of the two kinds is still failing
   * would be a flat-success lie over a half-done retry.
   */
  async function handlePostJournal(): Promise<void> {
    setPostingJournal(true);
    try {
      const result = await postFieldDeliveryJournalsAction(r.deliveryId);
      if (result.ok) {
        if (result.stillPending.length === 0) {
          toast.success(t("journalWarning.successAll"));
        } else {
          toast.error(t("journalWarning.stillPendingToast"));
        }
        router.refresh();
        return;
      }
      toast.error(t(journalErrorKey(result.reason)));
    } catch {
      toast.error(t("journalWarning.err.GENERIC"));
    } finally {
      setPostingJournal(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/backoffice/finance/piutang">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("detail.back")}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold font-mono truncate">{r.delivery.docNo}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={STATUS_BADGE_CLASS[status]}>{t(STATUS_LABEL_KEY[status])}</Badge>
          {canManagePayments && (
            <Button className="h-10" disabled={isSettled} onClick={() => setSheetOpen(true)}>
              <Wallet className="h-4 w-4 mr-2" />
              {primaryActionLabel}
            </Button>
          )}
        </div>
      </div>

      {journalRetryable && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("journalWarning.title")}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{t("journalWarning.description")}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-fit h-10"
              disabled={postingJournal}
              onClick={handlePostJournal}
            >
              {postingJournal && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {postingJournal ? t("journalWarning.retrying") : t("journalWarning.retryButton")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card className="p-4 space-y-2">
        <h2 className="font-semibold">{t("detail.invoiceFactsTitle")}</h2>
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-muted-foreground">{t("colDocNo")}</span>
          <Link
            href={`/backoffice/field-sales-orders/${r.delivery.order.id}`}
            className="inline-flex items-center gap-1 font-mono hover:underline"
          >
            {r.delivery.docNo}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        <Field label={t("colStore")} value={r.store.name} />
        <Field label={t("colSalesman")} value={r.delivery.order.salesman.name} />
        <Field label={t("colInvoiceDate")} value={formatDateOnlyJakarta(r.invoiceDate)} />
        <Field label={t("colDueDate")} value={formatDateOnlyJakarta(r.dueDate)} />
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-muted-foreground">{t("colDaysOverdue")}</span>
          <span className="flex items-center gap-2">
            {r.daysOverdue > 0 ? (
              <span className="font-medium text-red-600 dark:text-red-400 tabular-nums">{r.daysOverdue}</span>
            ) : (
              <span className="text-muted-foreground">{t("notYetDue")}</span>
            )}
            <Badge
              variant="outline"
              className={cn(
                isOverdueBucket
                  ? "border-red-200 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-900 dark:text-red-200"
                  : "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-900 dark:text-blue-200",
              )}
            >
              {AGING_BUCKET_LABELS[r.bucket]}
            </Badge>
          </span>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">{t("detail.moneyTitle")}</h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">{t("colOriginal")}</p>
            <p className="text-sm font-medium tabular-nums">{formatRupiahExact(r.originalAmount)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("detail.paid")}</p>
            <p className="text-sm font-medium tabular-nums">{formatRupiahExact(r.paidAmount)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("colOutstanding")}</p>
            <p className="text-xl font-bold tabular-nums text-primary">{formatRupiahExact(r.outstandingAmount)}</p>
          </div>
        </div>
      </Card>

      <AssignCollectorCard
        receivableId={r.id}
        collectorId={r.collectorId}
        collectorName={r.collectorName}
        collectors={collectorCandidates}
        canManageCollections={canManageCollections}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            {t("submissionHistoryTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {r.submissions.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">{t("detail.submissionEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("detail.colSubmissionAmount")}</TableHead>
                    <TableHead>{t("detail.colMethod")}</TableHead>
                    <TableHead>{t("detail.colPaidAt")}</TableHead>
                    <TableHead>{t("detail.colSubmissionCollector")}</TableHead>
                    <TableHead>{t("colStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.submissions.map((s) => {
                    const status = s.status as CollectionSubmissionStatus;
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="tabular-nums whitespace-nowrap">
                          {formatRupiahExact(s.amount)}
                        </TableCell>
                        <TableCell>{t(s.method === "CASH" ? "methodCash" : "methodTransfer")}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDateOnlyJakarta(s.paidAt)}</TableCell>
                        <TableCell className="max-w-[160px] truncate">{s.collectorName ?? "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge className={SUBMISSION_STATUS_BADGE_CLASS[status]}>
                              {t(SUBMISSION_STATUS_LABEL_KEY[status])}
                            </Badge>
                            {status === "REJECTED" && s.rejectReason && (
                              <span className="text-xs text-muted-foreground">
                                {t("detail.submissionRejectReasonLabel")}: {s.rejectReason}
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            {t("detail.allocationHistoryTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {r.allocations.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">{t("detail.allocationEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("detail.colPaymentDocNo")}</TableHead>
                    <TableHead>{t("detail.colPaidAt")}</TableHead>
                    <TableHead>{t("detail.colMethod")}</TableHead>
                    <TableHead className="text-right">{t("detail.colAllocatedAmount")}</TableHead>
                    <TableHead>{t("colStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.allocations.map((a) => {
                    const voided = a.payment.status === "VOIDED";
                    return (
                      <TableRow key={a.payment.id}>
                        <TableCell
                          className={cn(
                            "whitespace-nowrap font-mono text-xs",
                            voided && "text-muted-foreground line-through",
                          )}
                        >
                          <Link href={`/backoffice/finance/payments/${a.payment.id}`} className="hover:underline">
                            {a.payment.docNo}
                          </Link>
                        </TableCell>
                        <TableCell
                          className={cn("whitespace-nowrap", voided && "text-muted-foreground line-through")}
                        >
                          {formatDateOnlyJakarta(a.payment.paidAt)}
                        </TableCell>
                        <TableCell className={cn(voided && "text-muted-foreground line-through")}>
                          {t(a.payment.method === "CASH" ? "methodCash" : "methodTransfer")}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums whitespace-nowrap",
                            voided && "text-muted-foreground line-through",
                          )}
                        >
                          {formatRupiahExact(a.amount)}
                        </TableCell>
                        <TableCell>
                          {voided && <Badge variant="destructive">{t("detail.voidedBadge")}</Badge>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {canManagePayments && (
        <RecordPaymentSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          storeId={r.storeId}
          storeName={r.store.name}
          receivableId={r.id}
          candidates={allocationCandidates}
          onRecorded={() => {
            setSheetOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

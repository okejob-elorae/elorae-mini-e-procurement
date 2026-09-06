"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  FileText,
  ImageOff,
  ListChecks,
  Loader2,
  Receipt,
  Scissors,
  Wallet,
  XCircle,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import {
  approveSettlementAction,
  rejectSettlementAction,
  type SettlementApprovalActionReason,
} from "@/app/actions/store-settlements";
import type {
  SettlementApprovalDetail,
  SettlementCheck,
  SettlementComponentDetail,
  SettlementDeductionDetail,
  SettlementDeductionTypeValue,
  SettlementStatusValue,
} from "@/lib/finance/ar-settlement/queries";

type Props = {
  settlement: SettlementApprovalDetail;
};

const QUEUE_PATH = "/backoffice/finance/pelunasan";
const MAX_REASON_LENGTH = 191;

/**
 * Mirrors the visible-content check both writers run server-side: a reason made only of
 * zero-width/format characters (Unicode `Cf`, e.g. U+200B) or U+2800 BRAILLE PATTERN BLANK
 * survives `.trim()` unchanged and would otherwise be accepted here and refused there.
 */
const HAS_VISIBLE_CONTENT = /[^\s\p{Cf}⠀]/u;

const STATUS_BADGE_CLASS: Record<SettlementStatusValue, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  APPROVED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  REJECTED: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

const STATUS_LABEL_KEY: Record<
  SettlementStatusValue,
  "statusPending" | "statusApproved" | "statusRejected"
> = {
  PENDING: "statusPending",
  APPROVED: "statusApproved",
  REJECTED: "statusRejected",
};

const DEDUCTION_TYPE_LABEL_KEY: Record<
  SettlementDeductionTypeValue,
  "deductionRetur" | "deductionProgram" | "deductionAdminFee"
> = {
  RETUR_OFFSET: "deductionRetur",
  PROGRAM: "deductionProgram",
  ADMIN_FEE: "deductionAdminFee",
};

type ReceivableStatusValue = "OUTSTANDING" | "PARTIAL" | "PAID" | "WRITTEN_OFF";

/**
 * Exhaustive over `ReceivableStatus`, so a widened enum is a compile error here rather than a raw
 * database token rendered into a finance screen. Deliberately NOT a map over `FieldReturnStatus` —
 * four `Record<FieldReturnStatus, …>` maps already exist across the backoffice clients and a fifth
 * is a known trap, so a retur's state is reported below as the specific thing that is wrong with
 * it instead of as its status label.
 */
const RECEIVABLE_STATUS_LABEL_KEY: Record<
  ReceivableStatusValue,
  "statusOutstanding" | "statusPartial" | "statusPaid" | "statusWrittenOff"
> = {
  OUTSTANDING: "statusOutstanding",
  PARTIAL: "statusPartial",
  PAID: "statusPaid",
  WRITTEN_OFF: "statusWrittenOff",
};

function receivableStatusLabelKey(status: string): string {
  return RECEIVABLE_STATUS_LABEL_KEY[status as ReceivableStatusValue] ?? "statusUnknown";
}

/**
 * Exhaustive over the four methods a settlement component can post as, rather than reusing
 * `paymentMethodLabelKey` — that map spans every `PaymentMethod` member, including two this
 * document can never produce, and `financeStoreSettlements` carries copy only for the four.
 */
const COMPONENT_METHOD_LABEL_KEY: Record<
  SettlementComponentDetail["method"],
  "methodReturOffset" | "methodProgramDeduction" | "methodAdminFee" | "methodCash"
> = {
  RETUR_OFFSET: "methodReturOffset",
  PROGRAM_DEDUCTION: "methodProgramDeduction",
  ADMIN_FEE: "methodAdminFee",
  CASH: "methodCash",
};

function formatRupiahExact(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function TotalRow({
  label,
  value,
  emphasis,
  tone,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: "muted" | "danger";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className={cn("text-muted-foreground", emphasis && "text-foreground font-medium")}>{label}</span>
      <span
        className={cn(
          "text-right whitespace-nowrap tabular-nums",
          emphasis && "font-semibold",
          tone === "muted" && "text-muted-foreground",
          tone === "danger" && "text-destructive font-medium",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function SettlementApprovalClient({ settlement: s }: Props) {
  const t = useTranslations("financeStoreSettlements");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [postingJournals, setPostingJournals] = useState(false);

  const busy = approving || rejecting;
  const isPending = s.status === "PENDING";
  const overrideOk = !s.needsOverrideReason || HAS_VISIBLE_CONTENT.test(overrideReason);
  const rejectOk = HAS_VISIBLE_CONTENT.test(rejectReason);
  const overTender = s.checks.some((check) => check.id === "NO_OVER_TENDER" && check.status !== "PASS");
  /**
   * Hoisted out of the JSX below: narrowing a PROPERTY does not survive into the nested render
   * closures that read its members, while narrowing a local const does. Same reason the deduction
   * rows hoist their own `fieldReturn`.
   */
  const varianceOverride = s.varianceOverride;

  /**
   * Two different questions, one filter.
   *
   * While the document is open: a zero-amount component with no payment behind it is genuinely
   * nothing — on the common cash-only settlement the program and admin-fee rows would otherwise
   * head the card as two "Rp 0,00 — nothing to post" lines. A row that is BROKEN is never hidden:
   * a retur deduction with no `fieldReturnId` carries a real amount, no idempotency key and no
   * payment, and dropping it would make the document read as cheaper than it is while finance
   * works out why it is blocked.
   *
   * Once REJECTED nothing was meant to post, so the card only earns its place if something did —
   * the orphaned-payment case the writer logs, reachable when approval posts one component, throws
   * before the next, and the still-`PENDING` document is then rejected. Its copy tells finance to
   * void what is listed, so the list has to be the payments and nothing else: showing the unposted
   * siblings under that heading would name rows there is nothing to void.
   */
  const visibleComponents = s.components.filter((component) =>
    s.status === "REJECTED"
      ? component.paymentId !== null
      : component.amount > 0 || component.paymentId !== null,
  );
  const showComponents = visibleComponents.length > 0;

  /**
   * `checks` is computed server-side only while the document is `PENDING` (and `approvable` spells
   * the status test out separately rather than leaning on this row), so `STATUS_PENDING` can never
   * say anything but "passed" by the time it reaches here — pure noise beside the ten checks that
   * can actually fail. The row is still produced so the `SettlementCheckId` union stays fully
   * represented in both locale files.
   */
  const renderedChecks = s.checks.filter((check) => check.id !== "STATUS_PENDING");

  /**
   * `toApprovalResult` passes any `PaymentError.code` straight through, and that union is wider
   * than the copy this namespace carries — a member with no key would render the raw key path to
   * the operator. `t.has` keeps that impossible without a hand-maintained list of codes to drift
   * out of sync with `errors.ts`.
   */
  const errorMessage = (reason: SettlementApprovalActionReason): string => {
    const key = `err.${reason}`;
    return t.has(key) ? t(key) : t("err.UNEXPECTED");
  };

  const formatTimestamp = (date: Date) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);

  function checkSubjectText(check: SettlementCheck): string | null {
    if (check.subjects.length === 0) return null;
    const names = check.subjects.map((subject) => {
      if (check.subjectKind === "DEDUCTION_TYPE") {
        return t(DEDUCTION_TYPE_LABEL_KEY[subject as SettlementDeductionTypeValue]);
      }
      if (check.subjectKind === "PAYMENT") {
        return t(COMPONENT_METHOD_LABEL_KEY[subject as SettlementComponentDetail["method"]]);
      }
      /* A raw cuid on its own is unactionable; say what kind of record it identifies. */
      if (check.subjectKind === "INVOICE_ID") return t("subjectInvoiceId", { id: subject });
      if (check.subjectKind === "RETUR_ID") return t("subjectReturId", { id: subject });
      return subject;
    });
    return names.join(", ");
  }

  async function handleApprove(): Promise<void> {
    if (approving) return;
    setApproving(true);
    try {
      const result = await approveSettlementAction({
        settlementId: s.id,
        overrideReason: s.needsOverrideReason ? overrideReason.trim() : undefined,
      });
      if (result.ok) {
        setApproveOpen(false);
        setOverrideReason("");
        toast[result.alreadyApproved ? "info" : "success"](
          result.alreadyApproved
            ? t("approveAlreadyToast")
            : t("approveSuccessToast", { docNo: s.docNo }),
        );
        router.refresh();
        return;
      }
      /**
       * The dialog closes on a refusal too, not only on success. A typed refusal is very often
       * something that moved under the operator while the page sat open — another admin approving
       * it, a retur drawn elsewhere — and `router.refresh()` re-renders the banner and the
       * checklist behind it. Leaving the modal up would hide that refreshed answer behind its own
       * overlay, over a question that is no longer the one being asked.
       */
      setApproveOpen(false);
      toast.error(errorMessage(result.reason));
      router.refresh();
    } catch {
      toast.error(t("err.UNEXPECTED"));
    } finally {
      setApproving(false);
    }
  }

  /**
   * Re-runs the journal-posting loop for an APPROVED settlement whose component payments never got
   * their `PAYMENT_RECEIPT` entries — see `paymentsMissingJournal` in
   * `lib/finance/ar-settlement/queries.ts` for how that gap opens and why nothing else can close
   * it (no `JOURNAL_PENDING` notification was ever written, so the payment detail page's own retry
   * control does not appear).
   *
   * It calls the approve action deliberately rather than a second endpoint of its own. On an
   * already-`APPROVED` settlement that action takes `approveSettlement`'s write-free
   * `alreadyApproved` branch, hands back the same `paymentIds`, and re-runs the loop — and the
   * repeat is absorbed by `Journal @@unique([sourceType, sourceId])`, so a payment that DID get its
   * journal is untouched. No money moves and no status changes; this is not a second approval, and
   * the copy around the button has to keep saying so.
   *
   * A success result does not mean every journal posted: `postArJournalSafely` never throws and
   * degrades a failure to a `JOURNAL_PENDING` flag. Hence the deliberately non-committal toast —
   * the refreshed alert below is the real answer.
   */
  async function handlePostJournals(): Promise<void> {
    if (postingJournals) return;
    setPostingJournals(true);
    try {
      const result = await approveSettlementAction({ settlementId: s.id });
      if (result.ok) {
        toast.info(t("journalGapToast"));
      } else {
        toast.error(errorMessage(result.reason));
      }
      router.refresh();
    } catch {
      toast.error(t("err.UNEXPECTED"));
    } finally {
      setPostingJournals(false);
    }
  }

  async function handleReject(): Promise<void> {
    if (rejecting) return;
    const reason = rejectReason.trim();
    if (!HAS_VISIBLE_CONTENT.test(reason)) return;
    setRejecting(true);
    try {
      const result = await rejectSettlementAction({ settlementId: s.id, reason });
      if (result.ok) {
        setRejectOpen(false);
        setRejectReason("");
        toast.success(t("rejectSuccessToast", { docNo: s.docNo }));
        router.refresh();
        return;
      }
      setRejectOpen(false);
      toast.error(errorMessage(result.reason));
      router.refresh();
    } catch {
      toast.error(t("err.UNEXPECTED"));
    } finally {
      setRejecting(false);
    }
  }

  return (
    <div className={cn("space-y-6", isPending && "pb-40 lg:pb-6")}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <Button variant="ghost" size="sm" className="-ml-2 h-10" asChild>
            <Link href={QUEUE_PATH}>
              <ArrowLeft className="h-4 w-4" />
              {t("backToQueue")}
            </Link>
          </Button>
          <h1 className="truncate text-2xl font-bold tracking-tight font-mono">{s.docNo}</h1>
          <p className="truncate text-muted-foreground">
            {t("headerSubtitle", { store: s.storeName, salesman: s.salesmanName })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge className={STATUS_BADGE_CLASS[s.status]}>{t(STATUS_LABEL_KEY[s.status])}</Badge>
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {formatTimestamp(s.createdAt)}
          </span>
        </div>
      </div>

      {s.status === "REJECTED" && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>{t("rejectedTitle")}</AlertTitle>
          <AlertDescription>
            <p className="whitespace-pre-wrap break-words">{s.rejectReason ?? t("noReasonRecorded")}</p>
            {s.reviewedByName && s.reviewedAt && (
              <p className="text-xs">
                {t("reviewedBy", { name: s.reviewedByName, at: formatTimestamp(s.reviewedAt) })}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {s.status === "APPROVED" && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>{t("approvedTitle")}</AlertTitle>
          <AlertDescription>
            {s.reviewedByName && s.reviewedAt && (
              <p className="text-xs">
                {t("reviewedBy", { name: s.reviewedByName, at: formatTimestamp(s.reviewedAt) })}
              </p>
            )}
            {varianceOverride !== null ? (
              <>
                <p className="font-medium">{t("overrideRecordedTitle")}</p>
                <p className="whitespace-pre-wrap break-words">
                  {varianceOverride.reason ?? t("noReasonRecorded")}
                </p>
                <p className="text-xs">
                  {t("reviewedBy", {
                    name: varianceOverride.byName,
                    at: formatTimestamp(varianceOverride.at),
                  })}
                </p>
              </>
            ) : (
              <p className="text-xs">{t("noOverrideRecorded")}</p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {s.paymentsMissingJournal.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("journalGapTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("journalGapMessage", { count: s.paymentsMissingJournal.length })}</p>
            <Button
              variant="outline"
              className="mt-2 h-10"
              disabled={postingJournals}
              onClick={() => void handlePostJournals()}
            >
              {postingJournals && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("journalGapButton")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {s.storedFiguresDiffer && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("storedDriftTitle")}</AlertTitle>
          <AlertDescription>
            {t(isPending ? "storedDriftMessage" : "storedDriftMessageClosed", {
              storedExpected: formatRupiahExact(s.storedExpectedAmount),
              expected: formatRupiahExact(s.expectedAmount),
            })}
          </AlertDescription>
        </Alert>
      )}

      {overTender && isPending && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("overTenderTitle")}</AlertTitle>
          <AlertDescription>{t("err.OVER_TENDER")}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {t("invoicesTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {s.invoices.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("invoicesEmpty")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("colInvoiceDocNo")}</TableHead>
                        <TableHead>{t("colDueDate")}</TableHead>
                        <TableHead className="text-right">{t("colAgreed")}</TableHead>
                        <TableHead className="text-right">{t("colLiveOutstanding")}</TableHead>
                        <TableHead>{t("colReceivableStatus")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {s.invoices.map((invoice) => (
                        <TableRow key={invoice.receivableId}>
                          <TableCell className="whitespace-nowrap font-mono text-xs">
                            {invoice.docNo ? (
                              <Link
                                href={`/backoffice/finance/piutang/${invoice.receivableId}`}
                                className="hover:underline"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {invoice.docNo}
                              </Link>
                            ) : (
                              <span className="text-destructive">{t("invoiceMissing")}</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {invoice.dueDate ? formatDateOnlyJakarta(invoice.dueDate) : "—"}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap tabular-nums">
                            {formatRupiahExact(invoice.agreedAmount)}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap tabular-nums">
                            {invoice.liveOutstanding === null
                              ? "—"
                              : formatRupiahExact(invoice.liveOutstanding)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {invoice.receivableStatus === null ? (
                              <Badge variant="destructive">{t("invoiceMissing")}</Badge>
                            ) : invoice.storeMatches ? (
                              <Badge variant="outline">
                                {t(receivableStatusLabelKey(invoice.receivableStatus))}
                              </Badge>
                            ) : (
                              <Badge variant="destructive">{t("invoiceWrongStore")}</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scissors className="h-5 w-5" />
                {t("deductionsTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {s.deductions.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("deductionsEmpty")}</p>
              ) : (
                <div className="space-y-4">
                  {s.deductions.map((deduction) => (
                    <DeductionRow
                      key={deduction.id}
                      deduction={deduction}
                      labelKey={DEDUCTION_TYPE_LABEL_KEY[deduction.type]}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {showComponents && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="h-5 w-5" />
                  {t(
                    s.status === "PENDING"
                      ? "componentsTitle"
                      : s.status === "APPROVED"
                        ? "componentsTitlePosted"
                        : "componentsTitleOrphaned",
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-sm text-muted-foreground">
                  {t(
                    s.status === "PENDING"
                      ? "componentsHint"
                      : s.status === "APPROVED"
                        ? "componentsHintPosted"
                        : "componentsHintOrphaned",
                  )}
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("colComponent")}</TableHead>
                        <TableHead className="text-right">{t("colAmount")}</TableHead>
                        <TableHead>{t("colPosted")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleComponents.map((component, index) => {
                        const paymentId = component.paymentId;
                        const unlinked = component.key === null;
                        return (
                          <TableRow key={`${component.method}-${index}`}>
                            <TableCell className="whitespace-nowrap">
                              {t(COMPONENT_METHOD_LABEL_KEY[component.method])}
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap tabular-nums">
                              {formatRupiahExact(component.amount)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {unlinked ? (
                                <span className="text-sm font-medium text-destructive">
                                  {t("componentUnlinked")}
                                </span>
                              ) : paymentId === null ? (
                                <span className="text-sm text-muted-foreground">
                                  {t("componentNotPosted")}
                                </span>
                              ) : (
                                <Link
                                  href={`/backoffice/finance/payments/${paymentId}`}
                                  className="inline-flex items-center gap-1 text-sm hover:underline"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {component.paymentStatus === "VOIDED"
                                    ? t("componentVoided")
                                    : t("componentPosted")}
                                  <ExternalLink className="h-3 w-3" />
                                </Link>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                {t("totalsTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <TotalRow label={t("totalInvoices")} value={formatRupiahExact(s.invoiceTotal)} />
              <TotalRow label={t("totalRetur")} value={`− ${formatRupiahExact(s.returTotal)}`} />
              <TotalRow label={t("totalProgram")} value={`− ${formatRupiahExact(s.programTotal)}`} />
              <TotalRow
                label={
                  s.adminFeePercent === null
                    ? t("totalAdminFee")
                    : t("totalAdminFeeWithPercent", { percent: s.adminFeePercent })
                }
                value={`− ${formatRupiahExact(s.adminFee)}`}
              />
              <TotalRow label={t("totalAdminFeeBase")} value={formatRupiahExact(s.adminFeeBase)} tone="muted" />
              <div className="border-t pt-2">
                <TotalRow label={t("totalExpected")} value={formatRupiahExact(s.expectedAmount)} emphasis />
                <TotalRow label={t("totalActual")} value={formatRupiahExact(s.actualAmount)} emphasis />
                <TotalRow
                  label={t("totalVariance")}
                  value={formatRupiahExact(s.varianceAmount)}
                  emphasis
                  tone={s.varianceAmount === 0 ? undefined : "danger"}
                />
              </div>
              {isPending && (
                <p className="text-xs text-muted-foreground">
                  {t("toleranceHint", { tolerance: formatRupiahExact(s.toleranceRupiah) })}
                </p>
              )}
              {s.needsOverrideReason && isPending && !overTender && (
                <p className="text-xs text-amber-600 dark:text-amber-400">{t("overrideRequiredHint")}</p>
              )}
              {s.note && (
                <div className="border-t pt-2">
                  <p className="text-xs text-muted-foreground">{t("noteLabel")}</p>
                  <p className="whitespace-pre-wrap break-words text-sm">{s.note}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {isPending && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ListChecks className="h-5 w-5" />
                  {t("checklistTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{t("checklistHint")}</p>
                {renderedChecks.map((check) => {
                  const subject = checkSubjectText(check);
                  return (
                    <div key={check.id} className="flex items-start gap-2">
                      {check.status === "PASS" ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                      ) : check.status === "SKIPPED" ? (
                        <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      )}
                      <div className="min-w-0 space-y-0.5">
                        <p
                          className={cn(
                            "text-sm",
                            check.status === "FAIL" && "font-medium text-destructive",
                            check.status === "SKIPPED" && "text-muted-foreground",
                          )}
                        >
                          {t(`check.${check.id}`)}
                        </p>
                        {check.status === "SKIPPED" && (
                          <p className="text-xs text-muted-foreground">{t("checkSkipped")}</p>
                        )}
                        {check.reason !== null && (
                          <p className="text-xs text-muted-foreground">{t(`err.${check.reason}`)}</p>
                        )}
                        {subject !== null && (
                          <p className="break-words text-xs text-muted-foreground">
                            {t("checkAffected", { subjects: subject })}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {isPending && (
        /**
         * `pr-28` (112px) is not decoration: `components/QuickActionFAB.tsx` is `fixed bottom-6
         * right-6 z-50` with an `h-14 w-14` button, so it occupies 24-80px from both the bottom and
         * the right on EVERY backoffice route, and its `shadow-lg` spreads ~12px further left. This
         * is the only `fixed inset-x-0 bottom-0` bar in `app/backoffice`, so nothing else has ever
         * had to survive it — without the clearance a finance operator on a phone or tablet taps
         * the right end of Approve and gets the Quick Action dropdown instead, on the control that
         * moves the money. `lg:` drops the whole thing back to a normal in-flow row.
         */
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 py-3 pl-3 pr-28 backdrop-blur lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0 lg:pr-0 lg:backdrop-blur-none">
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="destructive"
              className="h-11 w-full sm:w-auto"
              disabled={busy}
              onClick={() => setRejectOpen(true)}
            >
              {rejecting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("rejectButton")}
            </Button>
            <Button
              className="h-11 w-full sm:w-auto"
              disabled={busy || !s.approvable}
              onClick={() => setApproveOpen(true)}
            >
              {approving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("approveButton")}
            </Button>
          </div>
          {!s.approvable && (
            <p className="mt-2 text-right text-xs text-muted-foreground">
              {t("approveBlockedHint")}
            </p>
          )}
        </div>
      )}

      <AlertDialog
        open={approveOpen}
        onOpenChange={(open) => {
          if (approving) return;
          setApproveOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("approveDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("approveDialogDescription", {
                docNo: s.docNo,
                amount: formatRupiahExact(s.actualAmount),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {s.needsOverrideReason && (
            <div className="space-y-1.5">
              <Label htmlFor="settlement-override-reason" className="text-xs">
                {t("overrideReasonLabel", { variance: formatRupiahExact(s.varianceAmount) })}
              </Label>
              <Textarea
                id="settlement-override-reason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                disabled={approving}
                maxLength={MAX_REASON_LENGTH}
                rows={3}
              />
              <div className="flex items-start justify-between gap-3">
                {/**
                  * Rendered whenever the confirm button is blocked, not only once something has
                  * been typed — with an empty box, the state the dialog opens in, the operator
                  * would otherwise see a greyed-out button and nothing saying why.
                  */}
                <p className={cn("text-xs", overrideOk ? "invisible" : "text-destructive")}>
                  {t("reasonRequired")}
                </p>
                <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {overrideReason.length}/{MAX_REASON_LENGTH}
                </p>
              </div>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={approving}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={approving || !overrideOk}
              onClick={(e) => {
                e.preventDefault();
                void handleApprove();
              }}
            >
              {approving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("approveConfirmButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={rejectOpen}
        onOpenChange={(open) => {
          if (rejecting) return;
          setRejectOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rejectDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("rejectDialogDescription", { docNo: s.docNo })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="settlement-reject-reason" className="text-xs">
              {t("rejectReasonLabel")}
            </Label>
            <Textarea
              id="settlement-reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              disabled={rejecting}
              maxLength={MAX_REASON_LENGTH}
              rows={3}
            />
            <div className="flex items-start justify-between gap-3">
              <p className={cn("text-xs", rejectOk ? "invisible" : "text-destructive")}>
                {t("reasonRequired")}
              </p>
              <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {rejectReason.length}/{MAX_REASON_LENGTH}
              </p>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={rejecting}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={rejecting || !rejectOk}
              onClick={(e) => {
                e.preventDefault();
                void handleReject();
              }}
            >
              {rejecting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("rejectConfirmButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DeductionRow({
  deduction,
  labelKey,
}: {
  deduction: SettlementDeductionDetail;
  labelKey: "deductionRetur" | "deductionProgram" | "deductionAdminFee";
}) {
  const t = useTranslations("financeStoreSettlements");
  /**
   * Hoisted before the guard below: narrowing `deduction.fieldReturn` as a property does not
   * survive into the nested JSX that reads its members, but narrowing this local const does.
   */
  const retur = deduction.fieldReturn;
  /**
   * A dead or expired R2 URL otherwise renders the browser's broken-image glyph with no
   * explanation. Evidence is load-bearing on a screen that moves money — "the photo will not load"
   * and "there is no photo" are different findings and have to read differently.
   */
  const [evidenceBroken, setEvidenceBroken] = useState(false);

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{t(labelKey)}</p>
          {deduction.percent !== null && (
            <p className="text-xs text-muted-foreground">
              {t("deductionPercent", { percent: deduction.percent })}
            </p>
          )}
          {deduction.note && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {deduction.note}
            </p>
          )}
        </div>
        <span className="shrink-0 whitespace-nowrap tabular-nums font-semibold">
          {formatRupiahExact(deduction.amount)}
        </span>
      </div>

      {deduction.type === "RETUR_OFFSET" && (
        <div className="mt-2 space-y-1 border-t pt-2 text-xs">
          {retur === null ? (
            <p className="text-destructive">{t("returMissing")}</p>
          ) : (
            <>
              <Link
                href={`/backoffice/field-returns/${retur.id}`}
                className="block truncate font-mono hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {retur.docNo}
              </Link>
              <p className="text-muted-foreground">
                {t("returRemaining", {
                  remaining: retur.remaining === null ? "—" : formatRupiahExact(retur.remaining),
                  total: retur.totalValue === null ? "—" : formatRupiahExact(retur.totalValue),
                })}
              </p>
              {!retur.storeMatches && <p className="text-destructive">{t("returWrongStore")}</p>}
              {retur.status !== "APPROVED" && (
                <p className="text-destructive">{t("returNotApproved")}</p>
              )}
              {retur.valuationStatus !== "VALUED" && (
                <p className="text-destructive">{t("returNotValued")}</p>
              )}
            </>
          )}
        </div>
      )}

      {deduction.type !== "RETUR_OFFSET" && (
        <div className="mt-2 border-t pt-2">
          {!deduction.proofUrl ? (
            <p className="text-xs text-destructive">{t("evidenceMissing")}</p>
          ) : evidenceBroken ? (
            <div className="flex items-center gap-2 rounded-md border border-dashed p-3">
              <ImageOff className="h-4 w-4 shrink-0 text-destructive" />
              <p className="min-w-0 text-xs text-destructive">{t("evidenceUnavailable")}</p>
              <a
                href={deduction.proofUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto shrink-0 text-xs hover:underline"
              >
                {t("evidenceOpenDirect")}
              </a>
            </div>
          ) : (
            <a
              href={deduction.proofUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-md border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- external R2-hosted photo, not an optimizable local asset */}
              <img
                src={deduction.proofUrl}
                alt={t("evidenceAlt")}
                className="max-h-48 w-full object-contain"
                onError={() => setEvidenceBroken(true)}
              />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, AlertTriangle, CheckCircle2, Info, Wallet } from "lucide-react";
import type {
  FieldReturnDetail,
  FieldReturnOrigin,
  FieldReturnStatus,
  KonsiReturStockImpactLine,
} from "@/lib/field-sales/retur/queries";
import { isSettled } from "@/lib/field-sales/retur/variance";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { approveAction, previewKonsiReturStockImpactAction } from "@/app/actions/field-returns";
import type { AllocationCandidate } from "@/lib/finance/ar/queries";
import { ReceiveForm, fieldReturnErrorKey } from "./ReceiveForm";
import { ResolutionControls } from "./ResolutionControls";
import { LinePriceControls } from "./LinePriceControls";
import { OffsetToPiutangSheet } from "./OffsetToPiutangSheet";

type Props = {
  fieldReturn: FieldReturnDetail;
  canManage: boolean;
  canWriteOff: boolean;
  canOffsetPayments: boolean;
  allocationCandidates: AllocationCandidate[];
  suggestedAllocations: Array<{ receivableId: string; amount: number }>;
};

const STATUS_BADGE_VARIANT: Record<FieldReturnStatus, "secondary" | "destructive" | "default" | "outline"> = {
  PENDING_WAREHOUSE_RECEIVING: "secondary",
  MISMATCH_PENDING_RESOLUTION: "outline",
  PENDING_APPROVAL: "outline",
  APPROVED: "default",
  CANCELLED: "destructive",
};

const STATUS_BADGE_CLASS: Record<FieldReturnStatus, string> = {
  PENDING_WAREHOUSE_RECEIVING: "",
  MISMATCH_PENDING_RESOLUTION: "border-amber-500/40 text-amber-700",
  PENDING_APPROVAL: "border-amber-500/40 text-amber-700",
  APPROVED: "",
  CANCELLED: "",
};

const ORIGIN_BADGE_VARIANT: Record<FieldReturnOrigin, "secondary" | "outline"> = {
  FIELD: "secondary",
  ADMIN: "outline",
};

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/** Every discrepant line with no SETTLING resolution as its latest — mirrors allDiscrepantLinesSettled. */
function outstandingLineCount(lines: FieldReturnDetail["lines"]): number {
  return lines.filter((l) => {
    if (l.variance === 0) return false;
    return !isSettled(l.resolutions[0]?.type ?? null);
  }).length;
}

/** Mirrors setLinePriceAction's own PRICEABLE_STATUSES — the line price controls must stop
 *  rendering the instant a retur is no longer eligible to be repriced. */
const PRICEABLE_STATUSES: ReadonlySet<FieldReturnStatus> = new Set([
  "PENDING_WAREHOUSE_RECEIVING",
  "MISMATCH_PENDING_RESOLUTION",
  "PENDING_APPROVAL",
]);

/**
 * A line still awaiting an admin's pricing decision on a retur that is STILL OPEN — `priceState`
 * AMBIGUOUS or UNPRICEABLE is exactly the pair LinePriceControls itself renders a picker/manual
 * form for. Deliberately NOT used once the retur is APPROVED: `priceState` reads "SET" for a
 * preserved-but-never-resolved admin choice (a dangling `priceDeliveryLineId`, a MANUAL choice
 * whose price was never actually recorded), so on an approved retur this count can read 0 while
 * a line's `lineValue` is genuinely null — see `unvaluedLineCount` for the post-approval signal.
 */
function unpricedLineCount(lines: FieldReturnDetail["lines"]): number {
  return lines.filter((l) => l.priceState === "AMBIGUOUS" || l.priceState === "UNPRICEABLE").length;
}

/**
 * The header's post-approval signal, and the one that must agree with the register's own
 * `status === "APPROVED" && valuationStatus === "PENDING"` badge condition. `lineValue` is
 * stamped once, at approval, straight from what actually got priced — unlike `priceState`,
 * it cannot read "resolved" for a line whose admin choice never actually resolved.
 */
function unvaluedLineCount(lines: FieldReturnDetail["lines"]): number {
  return lines.filter((l) => l.lineValue === null).length;
}

/** Same 2dp Rupiah formatting LinePriceControls uses beside it — money always renders id-ID grouped. */
function formatMoney2(n: number): string {
  return `Rp ${n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function FieldReturnDetailClient({
  fieldReturn: r, canManage, canWriteOff, canOffsetPayments, allocationCandidates, suggestedAllocations,
}: Props) {
  const t = useTranslations("fieldReturns");
  const tReceiving = useTranslations("fieldReturnReceiving");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [previewPending, startPreviewTransition] = useTransition();
  const [approveOpen, setApproveOpen] = useState(false);
  const [offsetSheetOpen, setOffsetSheetOpen] = useState(false);
  const [stockImpact, setStockImpact] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "loaded"; rows: KonsiReturStockImpactLine[] }
    | { status: "error" }
  >({ status: "idle" });

  const outstanding = outstandingLineCount(r.lines);
  const showReceiveForm = canManage && r.status === "PENDING_WAREHOUSE_RECEIVING";
  /*
   * Without canManage, the receive form and the approve button must not render at all — but
   * the resolution card itself stays visible to any authenticated viewer once the retur has
   * been received: the counts, split, variance and resolution history are the record of what
   * happened, not an action surface. ResolutionControls' own `actionable` check is what gates
   * the resolution buttons on canManage + status (APPROVED/CANCELLED stay read-only even for a
   * manager).
   */
  const showResolutionControls = r.status !== "PENDING_WAREHOUSE_RECEIVING";
  const showApprove = canManage && r.status === "PENDING_APPROVAL";
  const showLinePriceControls = canManage && PRICEABLE_STATUSES.has(r.status);
  const unpricedCount = unpricedLineCount(r.lines);
  /* ACCEPT_SURPLUS is the one settlement path that credits a line above what the store's own
     paper claimed — surfaced once at the card header rather than only per-line, per the spec's
     surplus rule. */
  const hasSurplusCredit = r.lines.some((l) => l.resolutions[0]?.type === "ACCEPT_SURPLUS");

  /*
   * Fetched fresh every time the dialog opens, not once at page load — the approver should see
   * the consequence of the stock ledger as it stands right before they commit, not as it stood
   * when the page first rendered. Runs in its own transition so the fetch's pending state never
   * gets confused with callApprove's own (the confirm button would otherwise flash a
   * "submitting" label before anyone has clicked it).
   */
  function openApproveDialog(): void {
    setApproveOpen(true);
    setStockImpact({ status: "loading" });
    startPreviewTransition(async () => {
      try {
        const result = await previewKonsiReturStockImpactAction(r.id);
        setStockImpact(result.ok ? { status: "loaded", rows: result.rows } : { status: "error" });
      } catch {
        setStockImpact({ status: "error" });
      }
    });
  }

  function callApprove(): void {
    startTransition(async () => {
      try {
        const result = await approveAction(r.id);
        if (result.ok) {
          toast.success(tReceiving("successApproved"));
          setApproveOpen(false);
          router.refresh();
          return;
        }
        setApproveOpen(false);
        if (result.code === "UNRESOLVED_LINES") {
          toast.error(tReceiving("approveErrUnresolvedLines", { count: outstanding }));
          return;
        }
        toast.error(tReceiving(fieldReturnErrorKey(result.code)));
      } catch {
        setApproveOpen(false);
        toast.error(tReceiving(fieldReturnErrorKey("ERROR")));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/backoffice/field-returns">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("detail.back")}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold font-mono">{r.docNo}</h1>
          <Badge variant={ORIGIN_BADGE_VARIANT[r.origin]}>{t(`origin.${r.origin}`)}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_BADGE_VARIANT[r.status]} className={STATUS_BADGE_CLASS[r.status]}>
            {t(`status.${r.status}`)}
          </Badge>
          {showApprove && (
            <Button className="h-10" disabled={isPending} onClick={openApproveDialog}>
              <CheckCircle2 className="h-4 w-4" />
              {tReceiving("approveButton")}
            </Button>
          )}
        </div>
      </div>

      <Card className="p-4 space-y-2">
        <h2 className="font-semibold">{t("detail.summaryTitle")}</h2>
        <Field label={t("detail.store")} value={r.storeName} />
        <Field label={t("detail.raisedBy")} value={r.raisedByLabel} />
        <Field label={t("detail.raisedAt")} value={formatDateOnlyJakarta(r.createdAt)} />
        {/* ADMIN-origin, not yet shipped — hidden rather than rendered with an empty value. */}
        {r.transport && (
          <>
            <Field label={t("detail.transport")} value={t(`transport.${r.transport}`)} />
            {r.transport === "EXPEDITION" && (
              <>
                <Field label={t("detail.expeditionName")} value={r.expeditionName} />
                <Field label={t("detail.resiNo")} value={r.resiNo} />
              </>
            )}
          </>
        )}
        <Field label={t("detail.note")} value={r.note} />
      </Card>

      {r.notaPhotoUrl && (
        <Card className="p-4 space-y-2">
          <h2 className="font-semibold">{t("detail.notaPhoto")}</h2>
          <div className="overflow-hidden rounded-md border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- external R2-hosted photo, not an optimizable local asset */}
            <img
              src={r.notaPhotoUrl}
              alt={t("detail.notaPhoto")}
              className="max-h-[70vh] w-full object-contain"
            />
          </div>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="font-semibold mb-2">{t("detail.linesTitle")}</h2>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("detail.colProduct")}</TableHead>
                <TableHead>{t("detail.colVariant")}</TableHead>
                <TableHead className="text-right">{t("detail.colQty")}</TableHead>
                <TableHead>{t("detail.colReason")}</TableHead>
                <TableHead>{t("detail.colReasonNote")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{line.itemName}</p>
                      <p className="text-xs text-muted-foreground font-mono">{line.itemSku}</p>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{line.variantSku || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.qty}</TableCell>
                  <TableCell>{t(`reason.${line.reason}`)}</TableCell>
                  <TableCell className="text-muted-foreground">{line.reasonNote || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {showReceiveForm && (
        <ReceiveForm
          returnId={r.id}
          lines={r.lines.map((l) => ({
            id: l.id,
            itemName: l.itemName,
            itemSku: l.itemSku,
            variantSku: l.variantSku,
            qty: l.qty,
          }))}
        />
      )}

      {showResolutionControls && (
        <ResolutionControls
          status={r.status}
          origin={r.origin}
          lines={r.lines}
          canManage={canManage}
          canWriteOff={canWriteOff}
        />
      )}

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            {t("valuation.cardTitle")}
          </CardTitle>
          {r.status === "CANCELLED" ? (
            /* A cancelled retur never gets priced — an "incomplete" alarm here would point at
               controls that no longer render for anyone, on a document nobody can act on. */
            <p className="text-sm text-muted-foreground">{t("valuation.cancelledBody")}</p>
          ) : r.valuationStatus === "VALUED" && r.totalValue !== null ? (
            <p className="text-2xl font-bold tabular-nums">{formatMoney2(r.totalValue)}</p>
          ) : r.status === "APPROVED" ? (
            /*
             * APPROVED but NOT valued — the same signal the register's own badge condition
             * uses (status === APPROVED && valuationStatus === PENDING). Values are frozen at
             * approval with no UI path back to re-enter them, so this is a STATEMENT of a
             * permanent gap, never an instruction — there is nothing left for the operator to
             * do about it here. unvaluedLineCount (lineValue === null), not the priceState-based
             * unpricedCount, because a preserved dangling admin choice reads priceState "SET"
             * despite never having resolved to an actual value.
             */
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-amber-700">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium">{t("valuation.incompleteTitle")}</p>
                <p className="text-xs">
                  {t("valuation.incompleteBodyApproved", { count: unvaluedLineCount(r.lines) })}
                </p>
              </div>
            </div>
          ) : unpricedCount > 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-amber-700">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium">{t("valuation.incompleteTitle")}</p>
                <p className="text-xs">{t("valuation.incompleteBody", { count: unpricedCount })}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("valuation.notYetValuedBody")}</p>
          )}
          {hasSurplusCredit && (
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-emerald-700">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <p className="text-xs">{t("valuation.surplusNote")}</p>
            </div>
          )}
        </CardHeader>
        <CardContent className="divide-y">
          {r.lines.map((line) => {
            const isSurplus = line.resolutions[0]?.type === "ACCEPT_SURPLUS";
            return (
              <div key={line.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{line.itemName}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {line.itemSku}
                      {line.variantSku ? ` · ${line.variantSku}` : ""}
                    </p>
                  </div>
                  {isSurplus && (
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">
                      {t("valuation.surplusBadge")}
                    </Badge>
                  )}
                </div>

                {isSurplus && (
                  <p className="text-xs text-muted-foreground">
                    {/* creditedQty is only stamped at approval — before that, "0" would falsely
                        read as a computed answer rather than "not decided yet". */}
                    {t("valuation.surplusStats", {
                      claimed: line.qty,
                      received: line.receivedQty ?? "—",
                      credited: line.creditedQty ?? "—",
                    })}
                  </p>
                )}

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {t("valuation.colCreditedQty")}:{" "}
                    <span className="tabular-nums text-foreground">{line.creditedQty ?? "—"}</span>
                  </span>
                  <span>
                    {t("valuation.colUnitPriceRef")}:{" "}
                    <span className="tabular-nums text-foreground">
                      {line.unitPrice !== null ? formatMoney2(line.unitPrice) : "—"}
                    </span>
                  </span>
                  <span>
                    {t("valuation.colLineValue")}:{" "}
                    <span className="tabular-nums font-medium text-foreground">
                      {line.lineValue !== null ? formatMoney2(line.lineValue) : "—"}
                    </span>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t("valuation.colProvenance")}:</span>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {line.priceSource === "DELIVERY"
                      ? (line.priceDeliveryDocNo ?? "—")
                      : line.priceSource === "MANUAL"
                        ? t("valuation.provenanceManual")
                        : t("valuation.provenanceNone")}
                  </Badge>
                </div>

                {showLinePriceControls && <LinePriceControls line={line} />}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {r.status === "APPROVED" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              {t("credit.cardTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {r.valuationStatus !== "VALUED" || r.totalValue === null ? (
              /* Terminal, not a transient state — post-approval repricing has no UI path, so an
                 approved-but-incomplete valuation can never become offsettable. Say so plainly
                 rather than rendering a control that would always refuse. */
              <p className="text-sm text-muted-foreground">{t("credit.neverOffsettable")}</p>
            ) : r.offsetStatus === "APPLIED" && r.offsetPayment ? (
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">{t("credit.appliedBody")}</p>
                <Link
                  href={`/backoffice/finance/payments/${r.offsetPayment.id}`}
                  className="inline-flex items-center gap-1 font-mono text-sm hover:underline"
                >
                  {r.offsetPayment.docNo}
                </Link>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-2xl font-bold tabular-nums">{formatMoney2(r.totalValue)}</p>
                  <p className="text-xs text-muted-foreground">{t("credit.availableBody")}</p>
                </div>
                {canOffsetPayments && (
                  <Button className="h-10" onClick={() => setOffsetSheetOpen(true)}>
                    <Wallet className="h-4 w-4 mr-2" />
                    {t("credit.offsetAction")}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={approveOpen}
        onOpenChange={(open) => {
          /*
           * Only isPending (the actual approve mutation) blocks closing — previewPending is a
           * read-only stock-impact fetch with nothing to protect mid-flight, so gating Cancel on
           * it as well left the button looking live while doing nothing for the 1-2s the preview
           * takes. The fetch itself is safe to let finish in the background: this component stays
           * mounted regardless of dialog visibility, and its result only ever feeds a warning
           * inside a now-closed dialog.
           */
          if (isPending) return;
          setApproveOpen(open);
          if (!open) setStockImpact({ status: "idle" });
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tReceiving("approveConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tReceiving("approveConfirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          {unpricedCount > 0 && (
            /*
             * Surfaced here, not just discovered afterwards on the card below — approving with
             * an incomplete valuation must be a deliberate choice. There is no post-approval
             * repricing path (values freeze at approval by design), so this is the only moment
             * this warning can still change anyone's mind.
             */
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-amber-700">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <p className="text-xs">{tReceiving("approveConfirmValuationWarning", { count: unpricedCount })}</p>
            </div>
          )}
          {stockImpact.status === "loading" && (
            <p className="text-xs text-muted-foreground">{tReceiving("konsiStockWarning.loading")}</p>
          )}
          {stockImpact.status === "error" && (
            <p className="text-xs text-destructive">{tReceiving("konsiStockWarning.error")}</p>
          )}
          {stockImpact.status === "loaded" && stockImpact.rows.length > 0 && (
            /*
             * This is a WARNING, not a gate — approve still proceeds on confirm. A konsi retur
             * can legitimately drive a store's stock negative (the goods physically arrived and
             * were counted; bookkeeping must never block that), so this only makes the
             * consequence visible before it commits rather than discovering it afterwards on the
             * store's stock card. There is no manual correction path in this slice — say so
             * plainly rather than implying one exists.
             */
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="text-xs space-y-1.5">
                <p className="font-medium">{tReceiving("konsiStockWarning.title")}</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {stockImpact.rows.map((row) => (
                    <li key={row.lineId}>
                      {tReceiving("konsiStockWarning.line", {
                        itemName: row.itemName,
                        variantSku: row.variantSku || "—",
                        storeQty: row.storeQty,
                        creditedQty: row.creditedQty,
                        shortfall: row.shortfall,
                      })}
                    </li>
                  ))}
                </ul>
                <p>{tReceiving("konsiStockWarning.noManualFix")}</p>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending || previewPending}
              onClick={(e) => {
                /* Keep the dialog open so the pending label is visible; callApprove() closes it. */
                e.preventDefault();
                callApprove();
              }}
            >
              {isPending ? tReceiving("submitting") : tReceiving("approveConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canOffsetPayments && r.totalValue !== null && (
        <OffsetToPiutangSheet
          open={offsetSheetOpen}
          onOpenChange={setOffsetSheetOpen}
          returnId={r.id}
          totalValue={r.totalValue}
          candidates={allocationCandidates}
          suggestedAllocations={suggestedAllocations}
          onApplied={() => {
            setOffsetSheetOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

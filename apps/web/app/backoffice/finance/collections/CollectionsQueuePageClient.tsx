"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { AlertCircle, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Pagination } from "@/components/ui/pagination";
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
import { formatDateOnlyJakarta } from "@/lib/date-only";
import {
  verifyCollectionAction,
  rejectCollectionAction,
  type CollectionActionReason,
} from "@/app/actions/collections";

export type CollectionQueueRow = {
  id: string;
  receivableId: string;
  storeName: string;
  docNo: string;
  collectorName: string;
  amount: number;
  method: string;
  paidAt: Date;
  createdAt: Date;
  note: string | null;
  proofUrl: string | null;
  liveOutstanding: number;
};

type Props = {
  rows: CollectionQueueRow[];
  total: number;
  collectors: { id: string; name: string }[];
  storeOptions: { id: string; name: string }[];
  collectorId: string;
  storeId: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
  canVerify: boolean;
  loadError: boolean;
};

const BASE_PATH = "/backoffice/finance/collections";
const ALL_STORES = "__all__";
const ALL_COLLECTORS = "__all__";

/**
 * Mirrors `HAS_VISIBLE_CONTENT` from `PaymentDetailClient.tsx` — the writer's own check for
 * `rejectCollection` rejects a reason made only of zero-width/format characters (Unicode `Cf`,
 * e.g. U+200B) or U+2800 BRAILLE PATTERN BLANK, which `.trim()` alone does not catch.
 */
const HAS_VISIBLE_CONTENT = /[^\s\p{Cf}⠀]/u;

function formatRupiahExact(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function errKey(reason: CollectionActionReason): string {
  return `err.${reason}`;
}

export function CollectionsQueuePageClient(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("financeCollections");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [isNavPending, startNavTransition] = useTransition();
  const [isActionPending, startActionTransition] = useTransition();

  const [activeRow, setActiveRow] = useState<CollectionQueueRow | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  function pushParams(next: Record<string, string | undefined>): void {
    const params = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    params.delete("page");
    startNavTransition(() => router.push(`${BASE_PATH}?${params.toString()}`));
  }

  function reset(): void {
    startNavTransition(() => router.push(BASE_PATH));
  }

  function goToPage(p: number): void {
    const params = new URLSearchParams(sp.toString());
    params.set("page", String(p));
    startNavTransition(() => router.push(`${BASE_PATH}?${params.toString()}`));
  }

  function closeDialog(): void {
    setActiveRow(null);
    setRejecting(false);
    setRejectReason("");
  }

  function handleVerify(): void {
    if (!activeRow) return;
    const submissionId = activeRow.id;
    startActionTransition(async () => {
      try {
        const r = await verifyCollectionAction(submissionId);
        if (r.ok) {
          toast[r.alreadyVerified ? "info" : "success"](
            r.alreadyVerified ? t("alreadyVerifiedToast") : t("verifySuccessToast"),
          );
          closeDialog();
          router.refresh();
        } else {
          toast.error(t(errKey(r.reason)));
        }
      } catch {
        toast.error(t("err.ERROR"));
      }
    });
  }

  function handleReject(): void {
    if (!activeRow) return;
    const reason = rejectReason.trim();
    if (!HAS_VISIBLE_CONTENT.test(reason)) return;
    const submissionId = activeRow.id;
    startActionTransition(async () => {
      try {
        const r = await rejectCollectionAction(submissionId, reason);
        if (r.ok) {
          toast.success(t("rejectSuccessToast"));
          closeDialog();
          router.refresh();
        } else {
          toast.error(t(errKey(r.reason)));
        }
      } catch {
        toast.error(t("err.ERROR"));
      }
    });
  }

  const formatSubmittedAt = (date: Date) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);

  const hasFilters = !!props.storeId || !!props.collectorId || !!props.dateFrom || !!props.dateTo;
  const reasonInvalid = rejecting && !HAS_VISIBLE_CONTENT.test(rejectReason.trim());
  const overOutstanding = !!activeRow && activeRow.amount > activeRow.liveOutstanding;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      {props.loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <div>
              <p className="font-medium">{t("loadErrorTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("loadErrorMessage")}</p>
            </div>
            <Button variant="outline" className="h-10" onClick={() => router.refresh()}>
              {t("loadErrorRetry")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3">
            <SearchableCombobox
              options={[
                { value: ALL_STORES, label: t("allStores") },
                ...props.storeOptions.map((s) => ({ value: s.id, label: s.name })),
              ]}
              value={props.storeId || ALL_STORES}
              onValueChange={(v) => pushParams({ storeId: v === ALL_STORES ? undefined : v })}
              placeholder={t("allStores")}
              searchPlaceholder={t("storeSearchPlaceholder")}
              emptyMessage={t("storeSearchEmpty")}
              triggerClassName="h-10 w-full sm:w-[220px]"
            />
            <SearchableCombobox
              options={[
                { value: ALL_COLLECTORS, label: t("allCollectors") },
                ...props.collectors.map((c) => ({ value: c.id, label: c.name })),
              ]}
              value={props.collectorId || ALL_COLLECTORS}
              onValueChange={(v) => pushParams({ collectorId: v === ALL_COLLECTORS ? undefined : v })}
              placeholder={t("allCollectors")}
              searchPlaceholder={t("collectorSearchPlaceholder")}
              emptyMessage={t("collectorSearchEmpty")}
              triggerClassName="h-10 w-full sm:w-[220px]"
            />
            <Input
              type="date"
              value={props.dateFrom}
              onChange={(e) => pushParams({ from: e.target.value || undefined })}
              className="h-10 w-full sm:w-[160px]"
              aria-label={t("fromLabel")}
            />
            <Input
              type="date"
              value={props.dateTo}
              onChange={(e) => pushParams({ to: e.target.value || undefined })}
              className="h-10 w-full sm:w-[160px]"
              aria-label={t("toLabel")}
            />
            <Button variant="outline" className="h-10" onClick={reset}>
              {t("reset")}
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HandCoins className="h-5 w-5" />
                {t("listTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isNavPending ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : props.rows.length === 0 ? (
                <div className="text-center py-12">
                  <HandCoins className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">{hasFilters ? t("noResults") : t("empty")}</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("colStore")}</TableHead>
                          <TableHead>{t("colDocNo")}</TableHead>
                          <TableHead>{t("colCollector")}</TableHead>
                          <TableHead>{t("colMethod")}</TableHead>
                          <TableHead className="text-right">{t("colAmount")}</TableHead>
                          <TableHead>{t("colPaidAt")}</TableHead>
                          <TableHead>{t("colSubmittedAt")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {props.rows.map((row) => (
                          <TableRow
                            key={row.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => setActiveRow(row)}
                          >
                            <TableCell className="max-w-[180px] truncate font-medium">{row.storeName}</TableCell>
                            <TableCell className="whitespace-nowrap font-mono text-xs">{row.docNo}</TableCell>
                            <TableCell className="max-w-[160px] truncate">{row.collectorName}</TableCell>
                            <TableCell>{t(row.method === "CASH" ? "methodCash" : "methodTransfer")}</TableCell>
                            <TableCell className="text-right whitespace-nowrap tabular-nums font-medium">
                              {formatRupiahExact(row.amount)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{formatDateOnlyJakarta(row.paidAt)}</TableCell>
                            <TableCell className="whitespace-nowrap">{formatSubmittedAt(row.createdAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <Pagination
                    page={props.page}
                    totalPages={Math.max(1, Math.ceil(props.total / props.pageSize))}
                    onPageChange={goToPage}
                    totalCount={props.total}
                    pageSize={props.pageSize}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <AlertDialog
        open={!!activeRow}
        onOpenChange={(open) => {
          if (isActionPending) return;
          if (!open) closeDialog();
        }}
      >
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
          {activeRow && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("reviewTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("reviewDescription")}</AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <span className="text-muted-foreground">{t("colStore")}</span>
                  <span className="text-right font-medium truncate">{activeRow.storeName}</span>
                  <span className="text-muted-foreground">{t("colDocNo")}</span>
                  <span className="text-right font-mono text-xs">
                    <Link
                      href={`/backoffice/finance/piutang/${activeRow.receivableId}`}
                      className="hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {activeRow.docNo}
                    </Link>
                  </span>
                  <span className="text-muted-foreground">{t("fieldCollector")}</span>
                  <span className="text-right truncate">{activeRow.collectorName}</span>
                  <span className="text-muted-foreground">{t("fieldMethod")}</span>
                  <span className="text-right">
                    <Badge variant="outline">
                      {t(activeRow.method === "CASH" ? "methodCash" : "methodTransfer")}
                    </Badge>
                  </span>
                  <span className="text-muted-foreground">{t("fieldPaidAt")}</span>
                  <span className="text-right">{formatDateOnlyJakarta(activeRow.paidAt)}</span>
                  <span className="text-muted-foreground">{t("fieldSubmittedAt")}</span>
                  <span className="text-right">{formatSubmittedAt(activeRow.createdAt)}</span>
                  {activeRow.note && (
                    <>
                      <span className="text-muted-foreground">{t("fieldNote")}</span>
                      <span className="text-right whitespace-pre-wrap break-words">{activeRow.note}</span>
                    </>
                  )}
                </div>

                <div className="rounded-md border p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("claimedAmountLabel")}</span>
                    <span className="font-semibold tabular-nums">{formatRupiahExact(activeRow.amount)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("liveOutstandingLabel")}</span>
                    <span className="tabular-nums">{formatRupiahExact(activeRow.liveOutstanding)}</span>
                  </div>
                  {overOutstanding && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">{t("overOutstandingWarning")}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="font-medium">{t("proofTitle")}</p>
                  {activeRow.proofUrl ? (
                    <div className="space-y-2">
                      <div className="overflow-hidden rounded-md border bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element -- external R2-hosted photo, not an optimizable local asset */}
                        <img
                          src={activeRow.proofUrl}
                          alt={t("proofTitle")}
                          className="max-h-[40vh] w-full object-contain"
                        />
                      </div>
                      <a
                        href={activeRow.proofUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm hover:underline"
                      >
                        {t("proofViewFull")}
                      </a>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("proofEmpty")}</p>
                  )}
                </div>

                {rejecting && (
                  <div className="space-y-1.5">
                    <Label htmlFor="collection-reject-reason" className="text-xs">
                      {t("rejectReasonLabel")}
                    </Label>
                    <Textarea
                      id="collection-reject-reason"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      disabled={isActionPending}
                      rows={3}
                    />
                    {reasonInvalid && rejectReason.length > 0 && (
                      <p className="text-xs text-destructive">{t("rejectReasonRequired")}</p>
                    )}
                  </div>
                )}

                {!props.canVerify && <p className="text-xs text-muted-foreground">{t("noPermissionNote")}</p>}
              </div>

              <AlertDialogFooter>
                {rejecting ? (
                  <>
                    <Button variant="outline" disabled={isActionPending} onClick={() => setRejecting(false)}>
                      {t("back")}
                    </Button>
                    <AlertDialogAction
                      variant="destructive"
                      disabled={isActionPending || reasonInvalid}
                      onClick={handleReject}
                    >
                      {t("confirmRejectButton")}
                    </AlertDialogAction>
                  </>
                ) : (
                  <>
                    <AlertDialogCancel disabled={isActionPending}>{tCommon("cancel")}</AlertDialogCancel>
                    {props.canVerify && (
                      <>
                        <Button
                          variant="destructive"
                          disabled={isActionPending}
                          onClick={() => setRejecting(true)}
                        >
                          {t("rejectButton")}
                        </Button>
                        <AlertDialogAction disabled={isActionPending} onClick={handleVerify}>
                          {t("verifyButton")}
                        </AlertDialogAction>
                      </>
                    )}
                  </>
                )}
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

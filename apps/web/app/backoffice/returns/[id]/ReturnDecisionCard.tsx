"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
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
import {
  acceptReturnItemAction,
  rejectReturnItemAction,
  submitReturnDecisionAction,
  postSalesReturnJournalsAction,
  type DecisionActionResult,
} from "@/app/actions/sales-return-decision";
import type { SalesReturnDetail } from "@/lib/sales-returns/queries";
import {
  RETURN_STATUS_TAILWIND,
  ITEM_DECISION_TAILWIND,
} from "@/lib/sales-returns/format";

type Props = {
  ret: SalesReturnDetail;
  canDecide: boolean;
  canPostJournal: boolean;
};

function fmtCurrency(v: unknown, locale: string): string {
  const n = v == null ? 0 : Number(v);
  return new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtDateTime(d: Date | string | null | undefined, locale: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(d));
}

export function ReturnDecisionCard({ ret, canDecide, canPostJournal }: Props) {
  const t = useTranslations("salesReturns.decision");
  const tj = useTranslations("salesReturns");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [postingJournal, setPostingJournal] = useState(false);

  const locked = ret.pushOutboxRowId !== null;
  const allDecided = ret.items.every((i) => i.decision !== "PENDING");

  function handle(result: DecisionActionResult, successKey: string): void {
    if (result.ok) {
      toast.success(t(successKey));
      router.refresh();
    } else {
      toast.error(t(`error.${result.reason}` as never));
    }
  }

  function onAccept(itemId: string): void {
    startTransition(async () => {
      const r = await acceptReturnItemAction(itemId, t("defaultAcceptReason"));
      handle(r, "toast.accepted");
    });
  }

  function onReject(itemId: string): void {
    startTransition(async () => {
      const r = await rejectReturnItemAction(itemId, t("defaultRejectReason"));
      handle(r, "toast.rejected");
    });
  }

  function onSubmit(): void {
    startTransition(async () => {
      const r = await submitReturnDecisionAction(ret.id);
      setSubmitDialogOpen(false);
      handle(r, "toast.submitted");
    });
  }

  async function handlePostReturnJournals(): Promise<void> {
    setPostingJournal(true);
    try {
      const res = await postSalesReturnJournalsAction(ret.id);
      if (res.ok) {
        toast.success(res.created === false ? tj("journal.alreadyPostedToast") : tj("journal.postedToast"));
      } else {
        switch (res.code) {
          case "UNMAPPED_ROLE":
            toast.error(tj("journal.errUNMAPPED_ROLE", { role: res.role ?? "" }));
            break;
          case "UNBALANCED":
            toast.error(tj("journal.errUNBALANCED"));
            break;
          /*
           * Warning, not error, and given room to be read: the sales journal
           * sweep can bring the original sale onto the ledger minutes from now,
           * and the same button then posts. The "Post journal" button is gated
           * on the return's own journals being absent, so it stays offered.
           */
          case "ORIGINAL_SALE_NOT_JOURNALED":
            toast.warning(tj("journal.errORIGINAL_SALE_NOT_JOURNALED"), { duration: 12000 });
            break;
          case "FORBIDDEN":
            toast.error(tj("journal.errFORBIDDEN"));
            break;
          default:
            toast.error(tj("journal.errBAD_STATE"));
        }
      }
      router.refresh();
    } catch {
      toast.error(tj("journal.errUnexpected"));
    } finally {
      setPostingJournal(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-3">
        <Link href="/backoffice/returns">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t("back")}
        </Link>
      </Button>
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">
            {t("title")}: {ret.jubelioReturnNo ?? `#${ret.jubelioReturnId}`}
          </h1>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${RETURN_STATUS_TAILWIND[ret.status]}`}
          >
            {t(`status.${ret.status}` as never)}
          </span>
        </div>

        <div className="grid grid-cols-2 text-sm gap-y-1">
          <span className="text-muted-foreground">{t("channel")}</span>
          <span>{ret.channel}</span>
          <span className="text-muted-foreground">{t("orderNo")}</span>
          <span className="font-mono">{ret.channelOrderNo ?? "—"}</span>
          <span className="text-muted-foreground">{t("buyer")}</span>
          <span>{ret.buyerName ?? "—"}</span>
          <span className="text-muted-foreground">{t("receivedAt")}</span>
          <span>{fmtDateTime(ret.receivedAt, locale)}</span>
        </div>

        {locked && (
          <div className="text-sm bg-muted px-3 py-2 rounded">
            {t("lockedBanner", {
              when: fmtDateTime(ret.decidedAt, locale),
              who: ret.decidedBy?.name ?? "—",
            })}
          </div>
        )}

        {ret.decidedAt && (
          <div className="space-y-2">
            <div className="text-sm font-medium">{tj("journal.title")}</div>
            {(
              [
                { label: tj("journal.revenue"), id: ret.revenueJournalId },
                { label: tj("journal.cogs"), id: ret.cogsJournalId },
              ] as const
            ).map((row) => (
              <div key={row.label} className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{row.label}</span>
                {row.id ? (
                  <>
                    <Badge variant="default">{tj("journal.posted")}</Badge>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/backoffice/finance/journals/${row.id}`}>{tj("journal.view")}</Link>
                    </Button>
                  </>
                ) : null}
              </div>
            ))}
            {canPostJournal && (!ret.revenueJournalId || !ret.cogsJournalId) && (
              <Button
                size="sm"
                variant="outline"
                disabled={postingJournal}
                onClick={handlePostReturnJournals}
              >
                {tj("journal.postJournal")}
              </Button>
            )}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col.product")}</TableHead>
              <TableHead>{t("col.sku")}</TableHead>
              <TableHead className="text-right">{t("col.qty")}</TableHead>
              <TableHead className="text-right">{t("col.unitPrice")}</TableHead>
              <TableHead className="text-right">{t("col.subtotal")}</TableHead>
              <TableHead>{t("col.decision")}</TableHead>
              {canDecide && !locked && <TableHead>{t("col.actions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ret.items.map((item) => {
              const pending = item.decision === "PENDING";
              return (
                <TableRow key={item.id}>
                  <TableCell>{item.productName}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {item.variantSku ?? item.externalSku}
                  </TableCell>
                  <TableCell className="text-right">{Number(item.qty)}</TableCell>
                  <TableCell className="text-right">
                    {fmtCurrency(item.unitPrice, locale)}
                  </TableCell>
                  <TableCell className="text-right">
                    {fmtCurrency(item.subtotal, locale)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${ITEM_DECISION_TAILWIND[item.decision]}`}
                    >
                      {t(`itemDecision.${item.decision}` as never)}
                    </span>
                  </TableCell>
                  {canDecide && !locked && (
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!pending || isPending}
                          onClick={() => onAccept(item.id)}
                        >
                          {t("accept")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!pending || isPending}
                          onClick={() => onReject(item.id)}
                        >
                          {t("reject")}
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {canDecide && !locked && (
          <div className="pt-4 flex justify-end">
            <Button
              disabled={!allDecided || isPending}
              onClick={() => setSubmitDialogOpen(true)}
            >
              {t("submit")}
            </Button>
          </div>
        )}
      </Card>

      <AlertDialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("submitConfirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("submitConfirm.body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("submitConfirm.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={onSubmit}>
              {t("submitConfirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

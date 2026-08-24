"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { formatDateTime } from "@/lib/sales-orders/format";
import { lineVariance, isSettled } from "@/lib/field-sales/retur/variance";
import type { FieldReturnLineDetail, FieldReturnStatus } from "@/lib/field-sales/retur/queries";
import { resolveAction } from "@/app/actions/field-returns";
import { fieldReturnErrorKey } from "./ReceiveForm";

type ResolutionType = "SALESMAN_BEARS" | "INVESTIGATE" | "WRITE_OFF" | "ACCEPT_SURPLUS";

/** Shortage-direction resolutions (variance < 0) — WRITE_OFF is filtered out separately by canWriteOff. */
const SHORTAGE_TYPES: ResolutionType[] = ["SALESMAN_BEARS", "INVESTIGATE", "WRITE_OFF"];
/** Surplus-direction resolutions (variance > 0). */
const SURPLUS_TYPES: ResolutionType[] = ["ACCEPT_SURPLUS"];
/** The two types whose consequence can't be walked back from a note left blank. */
const NOTE_REQUIRED_TYPES: ReadonlySet<ResolutionType> = new Set(["INVESTIGATE", "ACCEPT_SURPLUS"]);

type Props = {
  status: FieldReturnStatus;
  lines: FieldReturnLineDetail[];
  canManage: boolean;
  canWriteOff: boolean;
};

function VarianceBadge({ variance }: { variance: number }) {
  const t = useTranslations("fieldReturnReceiving");
  if (variance === 0) {
    return <Badge variant="secondary">{t("varianceNone")}</Badge>;
  }
  if (variance > 0) {
    return (
      <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">
        {t("varianceSurplus", { n: variance })}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-500/40 text-amber-700">
      {t("varianceShort", { n: Math.abs(variance) })}
    </Badge>
  );
}

/**
 * The card that turns a warehouse count into a settled retur. Renders for any status past
 * PENDING_WAREHOUSE_RECEIVING (MISMATCH_PENDING_RESOLUTION, PENDING_APPROVAL, APPROVED,
 * CANCELLED) so the counts and resolution history stay visible read-only once the retur moves
 * on — only the action controls are gated on status and canManage.
 */
export function ResolutionControls({ status, lines, canManage, canWriteOff }: Props) {
  const t = useTranslations("fieldReturnReceiving");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<{ lineId: string; type: ResolutionType } | null>(null);
  const [note, setNote] = useState("");

  const actionable = canManage && (status === "MISMATCH_PENDING_RESOLUTION" || status === "PENDING_APPROVAL");

  function openDialog(lineId: string, type: ResolutionType): void {
    setNote("");
    setDialog({ lineId, type });
  }

  const noteRequired = dialog !== null && NOTE_REQUIRED_TYPES.has(dialog.type);
  const canConfirm = !isPending && (!noteRequired || note.trim() !== "");

  function confirm(): void {
    if (!dialog || !canConfirm) return;
    const trimmed = note.trim();
    startTransition(async () => {
      try {
        const result = await resolveAction({
          lineId: dialog.lineId,
          type: dialog.type,
          note: trimmed === "" ? null : trimmed,
        });
        if (result.ok) {
          toast.success(t("successResolved"));
          setDialog(null);
          router.refresh();
          return;
        }
        toast.error(t(fieldReturnErrorKey(result.code)));
      } catch {
        toast.error(t(fieldReturnErrorKey("ERROR")));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5" />
          {t("resolutionTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        {lines.map((line) => {
          const variance = lineVariance(line.qty, line.receivedQty);
          const latest = line.resolutions[0] ?? null;
          const availableTypes = variance === 0
            ? []
            : variance > 0
              ? SURPLUS_TYPES
              : SHORTAGE_TYPES.filter((type) => type !== "WRITE_OFF" || canWriteOff);

          return (
            <div key={line.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{line.itemName}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {line.itemSku}
                    {line.variantSku ? ` · ${line.variantSku}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t("colVariance")}:</span>
                  <VarianceBadge variance={variance} />
                </div>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {t("colClaimed")}: <span className="tabular-nums text-foreground">{line.qty}</span>
                </span>
                <span>
                  {t("colReceived")}:{" "}
                  <span className="tabular-nums text-foreground">{line.receivedQty ?? "—"}</span>
                </span>
              </div>

              {variance !== 0 && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">{t("resolutionStatusLabel")}:</span>
                    {latest ? (
                      <Badge
                        variant={isSettled(latest.type) ? "secondary" : "outline"}
                        className={isSettled(latest.type) ? "" : "border-amber-500/40 text-amber-700"}
                      >
                        {t(`resolutionType.${latest.type}`)}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-500/40 text-amber-700">
                        {t("statusUnresolved")}
                      </Badge>
                    )}
                  </div>

                  {actionable && (
                    <div className="flex flex-wrap gap-2">
                      {availableTypes.map((type) => (
                        <Button
                          key={type}
                          variant="outline"
                          className="h-10"
                          disabled={isPending}
                          onClick={() => openDialog(line.id, type)}
                        >
                          {t(`resolutionType.${type}`)}
                        </Button>
                      ))}
                    </div>
                  )}

                  {line.resolutions.length > 0 && (
                    <div className="space-y-1.5 rounded-md border bg-muted/30 p-2">
                      <p className="text-xs font-medium text-muted-foreground">{t("historyTitle")}</p>
                      {line.resolutions.map((res) => (
                        <div key={res.id} className="text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">{t(`resolutionType.${res.type}`)}</Badge>
                            <span className="tabular-nums text-muted-foreground">{res.qty}</span>
                            <span className="text-muted-foreground">
                              {res.createdByLabel} · {formatDateTime(res.createdAt, locale)}
                            </span>
                          </div>
                          {res.note && <p className="mt-0.5 text-muted-foreground italic">{res.note}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>

      <AlertDialog open={dialog !== null} onOpenChange={(open) => !isPending && !open && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog ? t(`resolutionDialogTitle.${dialog.type}`) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog ? t(`resolutionDialogDescription.${dialog.type}`) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="resolution-note" className="text-xs text-muted-foreground">
              {t("noteLabel")} ({noteRequired ? tCommon("required") : tCommon("optional")})
            </Label>
            <Textarea
              id="resolution-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={isPending}
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!canConfirm}
              onClick={(e) => {
                /* Keep the dialog open so the pending label is visible; confirm() closes it. */
                e.preventDefault();
                confirm();
              }}
            >
              {isPending ? t("submitting") : t("resolutionConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

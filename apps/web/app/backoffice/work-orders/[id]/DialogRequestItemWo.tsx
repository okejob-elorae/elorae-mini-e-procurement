"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { WoShortage } from "@/lib/item-requests/shortage";

export type RequestItemLineDraft = {
  itemId: string;
  itemName: string;
  uomCode: string;
  suggested: number;
  qty: number;
  included: boolean;
};

function toDraft(rows: WoShortage[]): RequestItemLineDraft[] {
  return rows.map((s) => ({
    itemId: s.itemId,
    itemName: s.itemName,
    uomCode: s.uomCode,
    suggested: s.shortage,
    qty: s.shortage,
    included: true,
  }));
}

/**
 * Confirm/edit dialog before Create / Update Item Request from a short DRAFT WO.
 * Prefills uncovered shortages; user can untick a line or change qty, then confirm.
 */
export function DialogRequestItemWo({
  open,
  onOpenChange,
  mode,
  lines,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "update";
  lines: WoShortage[];
  busy: boolean;
  onConfirm: (lines: Array<{ itemId: string; qty: number }>) => void;
}) {
  const t = useTranslations("itemRequests");
  const [draft, setDraft] = useState<RequestItemLineDraft[]>([]);

  useEffect(() => {
    if (open) setDraft(toDraft(lines));
  }, [open, lines]);

  const selected = draft.filter((d) => d.included && d.qty > 0);
  const canSubmit = selected.length > 0 && !busy;

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-lg sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t(mode === "update" ? "woRequestDialogUpdateTitle" : "woRequestDialogCreateTitle")}
          </DialogTitle>
          <DialogDescription>{t("woRequestDialogBody")}</DialogDescription>
        </DialogHeader>
        {draft.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("woRequestDialogEmpty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <span className="sr-only">{t("woRequestDialogInclude")}</span>
                </TableHead>
                <TableHead>{t("colItem")}</TableHead>
                <TableHead className="text-right">{t("woRequestDialogSuggested")}</TableHead>
                <TableHead className="text-right w-28">{t("colQty")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.map((row) => (
                <TableRow key={row.itemId}>
                  <TableCell>
                    <Checkbox
                      checked={row.included}
                      disabled={busy}
                      onCheckedChange={(c) =>
                        setDraft((prev) =>
                          prev.map((d) => (d.itemId === row.itemId ? { ...d, included: !!c } : d)),
                        )
                      }
                      aria-label={t("woRequestDialogInclude")}
                    />
                  </TableCell>
                  <TableCell className="whitespace-normal">{row.itemName}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {row.suggested.toLocaleString()} {row.uomCode}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min={0}
                      max={row.suggested}
                      step="any"
                      disabled={busy || !row.included}
                      value={row.qty === 0 ? "" : row.qty}
                      onChange={(e) => {
                        const v = e.target.value;
                        const n = v === "" ? 0 : Number(v);
                        setDraft((prev) =>
                          prev.map((d) =>
                            d.itemId === row.itemId
                              ? {
                                  ...d,
                                  qty:
                                    Number.isFinite(n) && n >= 0
                                      ? Math.min(n, row.suggested)
                                      : d.qty,
                                }
                              : d,
                          ),
                        );
                      }}
                      className="w-24 text-right ml-auto"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("woRequestDialogCancel")}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              onConfirm(selected.map((d) => ({ itemId: d.itemId, qty: d.qty })))
            }
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t(mode === "update" ? "woRequestDialogConfirmUpdate" : "woRequestDialogConfirmCreate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

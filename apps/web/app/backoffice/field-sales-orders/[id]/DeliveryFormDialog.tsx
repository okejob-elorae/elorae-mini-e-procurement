"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deliverableQty } from "@/lib/field-sales/delivery/plan";
import {
  recordDeliveryAction,
  type DeliveryActionResult,
} from "@/app/actions/field-sales-deliveries";

export type DeliverableLine = {
  id: string;
  productName: string;
  variantLabel: string | null;
  variantSku: string;
  outstanding: number;
  onHand: number;
};

type DeliveryFailure = Extract<DeliveryActionResult, { ok: false }>;

type ShortLine = { requested: number; onHand: number };

type Props = {
  orderId: string;
  lines: DeliverableLine[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Message path for a failed delivery action. Shared with DeliveriesCard so the
 * close-remainder flow reports the same codes with the same wording.
 */
export function deliveryErrorKey(reason: DeliveryFailure["reason"]): string {
  return `delivery.err.${reason}`;
}

function seedQtyInputs(lines: DeliverableLine[]): Record<string, string> {
  const entries = lines
    .filter((line) => line.outstanding > 0)
    .map((line) => [line.id, String(deliverableQty(line.outstanding, line.onHand))]);
  return Object.fromEntries(entries);
}

export function DeliveryFormDialog({ orderId, lines, open, onOpenChange }: Props) {
  const t = useTranslations("fieldSalesOrders");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>({});
  const [shortLines, setShortLines] = useState<Record<string, ShortLine>>({});
  const [note, setNote] = useState("");
  /**
   * One key per dialog session, minted on open and rotated on a successful submit. It stays stable
   * across a retry after a short-stock or network failure, so re-pressing Kirim replays the same
   * delivery server-side instead of moving stock a second time. Empty until the open effect runs,
   * which is why submit is gated on it.
   */
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const rows = lines.filter((line) => line.outstanding > 0);

  useEffect(() => {
    if (!open) return;
    setQtyInputs(seedQtyInputs(lines));
    setShortLines({});
    setNote("");
    setIdempotencyKey(crypto.randomUUID());
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per open; re-running on every parent render would wipe typed quantities */
  }, [open]);

  function setQty(lineId: string, value: string): void {
    setQtyInputs((prev) => ({ ...prev, [lineId]: value }));
    setShortLines((prev) => {
      if (!prev[lineId]) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  }

  /* Typing above the deliverable cap snaps back to it rather than silently failing at submit. */
  function handleQtyChange(line: DeliverableLine, raw: string): void {
    if (raw.trim() === "") {
      setQty(line.id, "");
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const cap = deliverableQty(line.outstanding, line.onHand);
    setQty(line.id, String(Math.min(cap, Math.floor(parsed))));
  }

  const payload = rows
    .map((line) => ({ orderLineId: line.id, qty: Number(qtyInputs[line.id] ?? "0") }))
    .filter((line) => Number.isInteger(line.qty) && line.qty > 0);

  const canSubmit = !isPending && payload.length > 0 && idempotencyKey !== "";

  /**
   * A short line is snapped down to what the server just said is on hand, and the order is
   * refreshed so the helper text stops contradicting the error. setQtyInputs is written
   * directly rather than through setQty, which would clear the inline error we just set.
   */
  function handleFailure(result: DeliveryFailure): void {
    if (result.reason === "INSUFFICIENT_STOCK" && result.shortLines?.length) {
      const next: Record<string, ShortLine> = {};
      const clamped: Record<string, string> = {};
      for (const short of result.shortLines) {
        next[short.orderLineId] = { requested: short.requested, onHand: short.onHand };
        clamped[short.orderLineId] = String(Math.max(0, Math.floor(short.onHand)));
      }
      setShortLines(next);
      setQtyInputs((prev) => ({ ...prev, ...clamped }));
      router.refresh();
    }
    toast.error(t(deliveryErrorKey(result.reason)));
  }

  function submit(): void {
    if (!canSubmit) return;
    const trimmedNote = note.trim();
    startTransition(async () => {
      try {
        const result = await recordDeliveryAction({
          orderId,
          lines: payload,
          note: trimmedNote === "" ? undefined : trimmedNote,
          idempotencyKey,
        });
        if (result.ok) {
          toast.success(t("delivery.successCreated"));
          /* Rotate before closing so a reopen can never replay the delivery that just succeeded. */
          setIdempotencyKey(crypto.randomUUID());
          onOpenChange(false);
          router.refresh();
          return;
        }
        handleFailure(result);
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("delivery.create")}</DialogTitle>
          <DialogDescription>{t("delivery.createDescription")}</DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t("delivery.noOutstanding")}</p>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {rows.map((line) => {
              const cap = deliverableQty(line.outstanding, line.onHand);
              const variantText = line.variantLabel ?? line.variantSku;
              const short = shortLines[line.id];
              const shortText = short
                ? t("delivery.shortStock", { onHand: short.onHand, requested: short.requested })
                : null;
              return (
                <div key={line.id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{line.productName}</p>
                      {variantText && (
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {variantText}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0">
                      <Label htmlFor={`delivery-qty-${line.id}`} className="sr-only">
                        {t("delivery.qty")}
                      </Label>
                      <Input
                        id={`delivery-qty-${line.id}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={cap}
                        step={1}
                        disabled={isPending || cap === 0}
                        value={qtyInputs[line.id] ?? ""}
                        onChange={(e) => handleQtyChange(line, e.target.value)}
                        className="h-10 w-20 text-right tabular-nums"
                      />
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>
                      {t("delivery.outstanding")}:{" "}
                      <span className="font-medium text-foreground tabular-nums">
                        {line.outstanding}
                      </span>
                    </span>
                    <span>
                      {t("delivery.onHand")}:{" "}
                      <span className="font-medium text-foreground tabular-nums">{line.onHand}</span>
                    </span>
                    <span>
                      {t("delivery.deliverable")}:{" "}
                      <span className="font-medium text-foreground tabular-nums">{cap}</span>
                    </span>
                  </div>
                  {cap === 0 && (
                    <p className="mt-1 text-xs text-amber-600">{t("delivery.noStockForLine")}</p>
                  )}
                  {shortText && <p className="mt-1 text-xs text-destructive">{shortText}</p>}
                </div>
              );
            })}
          </div>
        )}

        {rows.length > 0 && (
          <div className="space-y-1">
            <Label htmlFor="delivery-note" className="text-xs text-muted-foreground">
              {t("delivery.note")}
            </Label>
            <Textarea
              id="delivery-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("delivery.notePlaceholder")}
              disabled={isPending}
              rows={2}
            />
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            className="h-10"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            {tCommon("cancel")}
          </Button>
          <Button className="h-10" disabled={!canSubmit} onClick={submit}>
            {isPending ? t("delivery.submitting") : t("delivery.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

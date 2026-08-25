"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import type { FieldReturnLineDetail } from "@/lib/field-sales/retur/queries";
import { setLinePriceAction } from "@/app/actions/field-returns";
import { fieldReturnErrorKey } from "./ReceiveForm";

type Props = {
  line: FieldReturnLineDetail;
};

/** Same 2dp Rupiah formatting as the value display beside this control — money is always id-ID grouped. */
function formatMoney2(n: number): string {
  return `Rp ${n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A non-negative number with at most 2 decimals — mirrors the writer's own money precision.
 * Accepts both the dot and the Indonesian comma decimal separator; the writer only ever sees
 * the parsed number, never the raw string, so this is purely an input-friendliness normalisation.
 */
function parseMoneyInput(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Lets an admin resolve a price `approveFieldReturn`'s auto-resolve could not pick on its own.
 * The parent only renders this while the retur is still priceable (not APPROVED/CANCELLED) and
 * the viewer holds `field_returns:manage` — this component never re-checks either, matching
 * ResolutionControls' split of responsibility.
 *
 * `priceState` drives the shape: AUTO needs no control at all (just the delivery it will take
 * at approval); AMBIGUOUS must show a picker (never a free-text price, since genuine delivery
 * candidates already exist and picking wrong ones is the whole security concern the writer
 * guards against); UNPRICEABLE has no candidates to pick from at all, so only manual entry with
 * a required note makes sense; SET shows the chosen provenance read-only behind a "change"
 * button, which then offers whichever of picker/manual fits today's candidates, with an escape
 * back to read-only.
 */
export function LinePriceControls({ line }: Props) {
  const t = useTranslations("fieldReturnReceiving");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [useManual, setUseManual] = useState(false);
  const [selectedDeliveryLineId, setSelectedDeliveryLineId] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [manualNote, setManualNote] = useState("");

  const candidates = line.priceCandidates ?? [];
  const isAuto = line.priceState === "AUTO";
  const isAmbiguous = line.priceState === "AMBIGUOUS";
  const isUnpriceable = line.priceState === "UNPRICEABLE";
  const isSet = line.priceState === "SET";

  function openEdit(startManual: boolean): void {
    setUseManual(startManual || candidates.length === 0);
    setSelectedDeliveryLineId("");
    setManualPrice(line.unitPrice !== null ? String(line.unitPrice) : "");
    setManualNote(line.priceNote ?? "");
    setEditing(true);
  }

  function closeEdit(): void {
    setEditing(false);
  }

  function submitPick(deliveryLineId: string): void {
    if (!deliveryLineId) return;
    startTransition(async () => {
      try {
        const result = await setLinePriceAction({ lineId: line.id, deliveryLineId });
        if (result.ok) {
          toast.success(t("pricing.successSet"));
          setEditing(false);
          router.refresh();
          return;
        }
        toast.error(t(fieldReturnErrorKey(result.code)));
      } catch {
        toast.error(t(fieldReturnErrorKey("ERROR")));
      }
    });
  }

  const parsedManualPrice = parseMoneyInput(manualPrice);
  const manualNoteTrimmed = manualNote.trim();
  const canSubmitManual = !isPending && parsedManualPrice !== null && manualNoteTrimmed !== "";

  function submitManual(): void {
    if (!canSubmitManual || parsedManualPrice === null) return;
    startTransition(async () => {
      try {
        const result = await setLinePriceAction({
          lineId: line.id,
          manualUnitPrice: parsedManualPrice,
          note: manualNoteTrimmed,
        });
        if (result.ok) {
          toast.success(t("pricing.successSet"));
          setEditing(false);
          router.refresh();
          return;
        }
        toast.error(t(fieldReturnErrorKey(result.code)));
      } catch {
        toast.error(t(fieldReturnErrorKey("ERROR")));
      }
    });
  }

  if (isAuto) {
    const c = candidates[0];
    return (
      <div className="rounded-md border bg-muted/30 p-2 text-xs space-y-0.5">
        <p className="font-medium text-muted-foreground">{t("pricing.autoTitle")}</p>
        {c && <p className="text-muted-foreground">{t("pricing.autoBody", { docNo: c.docNo, price: formatMoney2(c.unitPrice) })}</p>}
      </div>
    );
  }

  if (isSet && !editing) {
    return (
      <div className="space-y-2">
        <div className="rounded-md border bg-muted/30 p-2 text-xs space-y-0.5">
          <p className="font-medium text-muted-foreground">
            {line.priceSource === "DELIVERY" ? t("pricing.provenanceDeliveryTitle") : t("pricing.provenanceManualTitle")}
          </p>
          {line.priceSource === "DELIVERY" && (
            <p className="text-muted-foreground font-mono">{line.priceDeliveryDocNo ?? "—"}</p>
          )}
          {line.priceSource === "MANUAL" && line.priceNote && (
            <p className="text-muted-foreground italic">{line.priceNote}</p>
          )}
        </div>
        <Button variant="outline" size="sm" className="h-10" onClick={() => openEdit(line.priceSource !== "DELIVERY")}>
          {t("pricing.changeButton")}
        </Button>
      </div>
    );
  }

  const showPicker = isAmbiguous || (isSet && editing && !useManual && candidates.length > 0);
  const showManual = isUnpriceable || (isSet && editing && (useManual || candidates.length === 0));

  return (
    <div className="space-y-3 rounded-md border p-3">
      {isAmbiguous && <p className="text-xs text-muted-foreground">{t("pricing.pickerHint")}</p>}
      {isUnpriceable && <p className="text-xs text-muted-foreground">{t("pricing.unpriceableBody")}</p>}

      {showPicker && (
        <div className="space-y-1.5">
          <Label htmlFor={`price-pick-${line.id}`} className="text-xs text-muted-foreground">
            {t("pricing.pickerLabel")}
          </Label>
          <Select value={selectedDeliveryLineId} onValueChange={setSelectedDeliveryLineId} disabled={isPending}>
            <SelectTrigger id={`price-pick-${line.id}`} className="h-10 w-full">
              <SelectValue placeholder={t("pricing.pickerPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((c) => (
                <SelectItem key={c.deliveryLineId} value={c.deliveryLineId}>
                  {`${c.docNo} · ${formatDateOnlyJakarta(c.deliveredAt)} · ${c.qty} pcs · ${formatMoney2(c.unitPrice)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-10"
              disabled={isPending || selectedDeliveryLineId === ""}
              onClick={() => submitPick(selectedDeliveryLineId)}
            >
              {isPending ? t("submitting") : t("pricing.confirmPick")}
            </Button>
            {isSet && candidates.length > 0 && (
              <Button variant="ghost" className="h-10" disabled={isPending} onClick={() => setUseManual(true)}>
                {t("pricing.switchToManual")}
              </Button>
            )}
            {isSet && (
              <Button variant="ghost" className="h-10" disabled={isPending} onClick={closeEdit}>
                {tCommon("cancel")}
              </Button>
            )}
          </div>
        </div>
      )}

      {showManual && (
        <div className="space-y-1.5">
          <Label htmlFor={`price-manual-${line.id}`} className="text-xs text-muted-foreground">
            {t("pricing.manualLabel")}
          </Label>
          <Input
            id={`price-manual-${line.id}`}
            value={manualPrice}
            onChange={(e) => setManualPrice(e.target.value)}
            placeholder={t("pricing.manualPlaceholder")}
            disabled={isPending}
            inputMode="decimal"
            className="h-10"
          />
          <Label htmlFor={`price-note-${line.id}`} className="text-xs text-muted-foreground">
            {t("noteLabel")} ({tCommon("required")})
          </Label>
          <Textarea
            id={`price-note-${line.id}`}
            value={manualNote}
            onChange={(e) => setManualNote(e.target.value)}
            disabled={isPending}
            rows={2}
            placeholder={t("pricing.manualNotePlaceholder")}
          />
          <div className="flex flex-wrap gap-2">
            <Button className="h-10" disabled={!canSubmitManual} onClick={submitManual}>
              {isPending ? t("submitting") : t("pricing.confirmManual")}
            </Button>
            {isSet && candidates.length > 0 && (
              <Button variant="ghost" className="h-10" disabled={isPending} onClick={() => setUseManual(false)}>
                {t("pricing.switchToPicker")}
              </Button>
            )}
            {isSet && (
              <Button variant="ghost" className="h-10" disabled={isPending} onClick={closeEdit}>
                {tCommon("cancel")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, Minus, Plus, Search, Sparkles, X } from "lucide-react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { KonsiSuggestion } from "@/lib/field-sales/queries";

export type StagedAddition = {
  itemId: string;
  variantSku: string;
  sku: string;
  name: string;
  variantLabel: string | null;
  qty: number;
};

type Props = {
  suggestions: KonsiSuggestion[];
  shortLineCount: number;
  staged: StagedAddition[];
  onStagedChange: (staged: StagedAddition[]) => void;
};

/** Cap mounted qty steppers so a large never-sent catalog cannot freeze the detail page. */
const PAGE_SIZE = 50;

const PANEL_ID = "konsi-suggestions-panel";
const PICKER_AVAILABILITY_ID = "konsi-suggestion-picker-availability";

/**
 * CardHeader puts its action slot in a second grid column, which squeezes the title on a phone.
 * Below sm the toggle drops to its own row under the title — same treatment as DeliveriesCard.
 */
const ACTION_SLOT_CLASS = [
  "max-sm:col-start-1 max-sm:row-start-2 max-sm:row-span-1",
  "max-sm:justify-self-start",
].join(" ");

function keyOf(itemId: string, variantSku: string): string {
  return `${itemId}::${variantSku}`;
}

export function KonsiSuggestionsCard({ suggestions, shortLineCount, staged, onStagedChange }: Props) {
  const t = useTranslations("fieldSalesOrders");
  const [open, setOpen] = useState(() => shortLineCount > 0);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pickerKey, setPickerKey] = useState("");
  const [pickerQty, setPickerQty] = useState("1");
  const [pickerResetKey, setPickerResetKey] = useState(0);
  /* Free-text draft per row, keyed the same way as staged entries. Only holds a value while the
   * field is mid-edit (e.g. momentarily empty) — commitQty clears the entry once a valid qty is
   * committed, so display otherwise always falls back to the staged qty. */
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});

  const stagedByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of staged) map.set(keyOf(s.itemId, s.variantSku), s.qty);
    return map;
  }, [staged]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (q === "") return suggestions;
    return suggestions.filter(
      (s) => s.sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
    );
  }, [suggestions, filter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  const eligiblePickerSuggestions = useMemo(
    () => suggestions.filter((s) => Math.floor(s.available) >= 1),
    [suggestions],
  );
  const pickerSuggestion = useMemo(
    () => eligiblePickerSuggestions.find((s) => keyOf(s.itemId, s.variantSku) === pickerKey),
    [eligiblePickerSuggestions, pickerKey],
  );
  const pickerOptions = useMemo(
    () =>
      eligiblePickerSuggestions.map((s) => ({
        value: keyOf(s.itemId, s.variantSku),
        label: [
          s.sku,
          s.name,
          s.variantSku || "—",
          s.variantLabel ? `(${s.variantLabel})` : "",
          t("konsiSuggestions.pickerAvailable", { available: Math.floor(s.available) }),
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    [eligiblePickerSuggestions, t],
  );
  const parsedPickerQty = Number(pickerQty);
  const pickerMaxQty = pickerSuggestion ? Math.floor(pickerSuggestion.available) : 0;
  const canStagePicker =
    pickerSuggestion !== undefined &&
    Number.isInteger(parsedPickerQty) &&
    parsedPickerQty > 0 &&
    parsedPickerQty <= pickerMaxQty;

  /* Nothing to suggest and no reason to look — don't render a card whose toggle opens onto an empty state. */
  if (suggestions.length === 0 && shortLineCount === 0) return null;

  function clearDraft(key: string): void {
    setQtyDrafts((prev) => {
      if (!(key in prev)) return prev;
      const rest = { ...prev };
      delete rest[key];
      return rest;
    });
  }

  /* Upserts in place so a qty edit never reorders the staged list (map when the row already
   * exists; push only for a genuinely new row). */
  function commitQty(s: KonsiSuggestion, nextQty: number): void {
    /* Floor AROUND the clamp, not inside it: `available` is Decimal(10,2) and can be fractional,
     * so flooring first would let `Math.min` hand back the fractional ceiling itself (available
     * 2.5, nextQty 3 -> 2.5) and stage a qty the writer rejects as non-integer. */
    const clamped = Math.floor(Math.max(0, Math.min(s.available, nextQty)));
    const key = keyOf(s.itemId, s.variantSku);
    const idx = staged.findIndex((a) => keyOf(a.itemId, a.variantSku) === key);
    let next: StagedAddition[];
    if (clamped <= 0) {
      next = idx === -1 ? staged : staged.filter((_, i) => i !== idx);
    } else if (idx === -1) {
      next = [
        ...staged,
        { itemId: s.itemId, variantSku: s.variantSku, sku: s.sku, name: s.name, variantLabel: s.variantLabel, qty: clamped },
      ];
    } else {
      next = staged.map((a, i) => (i === idx ? { ...a, qty: clamped } : a));
    }
    onStagedChange(next);
    clearDraft(key);
  }

  /* Empty input stays empty (not force-clamped to 0) so backspace-to-retype doesn't
   * momentarily unstage the row and doesn't fight multi-digit entry. Only a parseable,
   * non-negative value commits; anything else is held as a draft so what was typed stays
   * visible, and blur resolves the draft. */
  function handleQtyInputChange(s: KonsiSuggestion, raw: string): void {
    const key = keyOf(s.itemId, s.variantSku);
    const parsed = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(parsed) || parsed < 0) {
      setQtyDrafts((prev) => ({ ...prev, [key]: raw }));
      return;
    }
    commitQty(s, parsed);
  }

  /* Any draft still standing at blur is either empty or negative — commitQty clamps both to 0,
   * clears the draft, and lets the display fall back to the staged qty. */
  function handleQtyBlur(s: KonsiSuggestion): void {
    const key = keyOf(s.itemId, s.variantSku);
    const draft = qtyDrafts[key];
    if (draft === undefined) return;
    const parsed = Number(draft);
    commitQty(s, Number.isFinite(parsed) ? parsed : 0);
  }

  function removeStaged(itemId: string, variantSku: string): void {
    onStagedChange(staged.filter((a) => !(a.itemId === itemId && a.variantSku === variantSku)));
  }

  function selectPickerSuggestion(key: string): void {
    setPickerKey(key);
    const selected = eligiblePickerSuggestions.find((s) => keyOf(s.itemId, s.variantSku) === key);
    const stagedQty = selected ? stagedByKey.get(keyOf(selected.itemId, selected.variantSku)) : undefined;
    setPickerQty(String(stagedQty ?? 1));
  }

  function stagePickerSuggestion(): void {
    if (!pickerSuggestion || !canStagePicker) return;
    commitQty(pickerSuggestion, parsedPickerQty);
    setPickerKey("");
    setPickerQty("1");
    setPickerResetKey((current) => current + 1);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-5 w-5" />
          {t("konsiSuggestions.title")}
          {staged.length > 0 && <Badge variant="secondary">{staged.length}</Badge>}
        </CardTitle>
        <CardAction className={ACTION_SLOT_CLASS}>
          <Button
            type="button"
            variant="outline"
            className="h-10"
            aria-expanded={open}
            aria-controls={PANEL_ID}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {open ? t("konsiSuggestions.toggleLabelExpanded") : t("konsiSuggestions.toggleLabelCollapsed")}
          </Button>
        </CardAction>
      </CardHeader>
      {/* Collapsed with nothing to warn about leaves no body — an empty slot would still take the card's row gap. */}
      <CardContent className={shortLineCount > 0 || open ? "space-y-4" : "hidden"}>
        {shortLineCount > 0 && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm font-medium text-amber-700 dark:text-amber-500">
            {t("konsiSuggestions.shortLinesHeading", { count: shortLineCount })}
          </p>
        )}

        {open && (
          <div id={PANEL_ID} className="space-y-4">
            {eligiblePickerSuggestions.length > 0 && (
              <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{t("konsiSuggestions.pickerHeading")}</p>
                  <p className="text-xs text-muted-foreground">{t("konsiSuggestions.pickerDescription")}</p>
                </div>
                {/* Phone: product on its own row, then qty + stage side by side. sm and up: one row. */}
                <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_auto]">
                  <div className="col-span-2 min-w-0 space-y-1.5 sm:col-span-1">
                    <Label htmlFor="konsi-suggestion-picker" className="text-xs text-muted-foreground">
                      {t("konsiSuggestions.pickerProductLabel")}
                    </Label>
                    <SearchableCombobox
                      key={pickerResetKey}
                      id="konsi-suggestion-picker"
                      options={pickerOptions}
                      value={pickerKey}
                      onValueChange={selectPickerSuggestion}
                      placeholder={t("konsiSuggestions.pickerPlaceholder")}
                      searchPlaceholder={t("konsiSuggestions.pickerSearchPlaceholder")}
                      emptyMessage={t("konsiSuggestions.pickerNoMatch")}
                      triggerClassName="h-10 w-full"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="konsi-suggestion-picker-qty" className="text-xs text-muted-foreground">
                      {t("konsiSuggestions.colQty")}
                    </Label>
                    <Input
                      id="konsi-suggestion-picker-qty"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={pickerMaxQty || undefined}
                      step={1}
                      disabled={!pickerSuggestion}
                      aria-describedby={pickerSuggestion ? PICKER_AVAILABILITY_ID : undefined}
                      value={pickerQty}
                      onChange={(e) => setPickerQty(e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      className="h-10 text-right tabular-nums"
                    />
                  </div>
                  <Button
                    type="button"
                    className="h-10 w-full sm:w-auto"
                    disabled={!canStagePicker}
                    onClick={stagePickerSuggestion}
                  >
                    <Plus className="h-4 w-4" />
                    {t("konsiSuggestions.pickerStage")}
                  </Button>
                </div>
                {/* Region stays mounted so the availability hint is announced when it appears. */}
                <p id={PICKER_AVAILABILITY_ID} aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
                  {pickerSuggestion
                    ? t("konsiSuggestions.pickerSelectedAvailability", { available: pickerMaxQty })
                    : ""}
                </p>
              </div>
            )}

            <div className="relative max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(1);
                }}
                placeholder={t("konsiSuggestions.filterPlaceholder")}
                aria-label={t("konsiSuggestions.filterPlaceholder")}
                className="h-10 pl-9"
              />
            </div>

            {suggestions.length === 0 ? (
              <div className="py-10 text-center">
                <Sparkles className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{t("konsiSuggestions.empty")}</p>
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">{t("konsiSuggestions.noMatch")}</p>
            ) : (
              <div className="space-y-2">
                <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow>
                        <TableHead>{t("konsiSuggestions.colSku")}</TableHead>
                        <TableHead>{t("konsiSuggestions.colName")}</TableHead>
                        <TableHead>{t("colVariant")}</TableHead>
                        <TableHead className="text-right">{t("konsiSuggestions.colAvailable")}</TableHead>
                        <TableHead className="text-right">{t("konsiSuggestions.colQty")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageRows.map((s) => {
                        const key = keyOf(s.itemId, s.variantSku);
                        const qty = stagedByKey.get(key) ?? 0;
                        const draft = qtyDrafts[key];
                        const displayValue = draft !== undefined ? draft : String(qty);
                        /* `available` is qtyOnHand - reservedQty and CAN go negative (oversell). */
                        const noStock = s.available <= 0;
                        return (
                          <TableRow key={key}>
                            <TableCell className="font-mono text-sm whitespace-nowrap">{s.sku}</TableCell>
                            <TableCell className="max-w-56 truncate" title={s.name}>
                              {s.name}
                            </TableCell>
                            {/* The variant SKU, not just its label: `variantLabel` is null whenever the
                              * inventory row has no matching entry in the item's variants JSON, and the
                              * article SKU is identical across variants — without this column two real
                              * variants of one item render byte-identically. */}
                            <TableCell className="whitespace-nowrap font-mono text-sm">
                              {s.variantSku || "—"}
                              {s.variantLabel && (
                                <span className="ml-1 font-sans text-xs text-muted-foreground">({s.variantLabel})</span>
                              )}
                            </TableCell>
                            <TableCell
                              className={`text-right tabular-nums${noStock ? " text-muted-foreground" : ""}`}
                            >
                              {s.available}
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  className="h-10 w-10 shrink-0"
                                  disabled={noStock || qty <= 0}
                                  aria-label={t("konsiSuggestions.decreaseLabel")}
                                  onClick={() => commitQty(s, qty - 1)}
                                >
                                  <Minus className="h-4 w-4" />
                                </Button>
                                {/* onWheel blurs because a focused number input eats wheel events —
                                  * without it, scrolling this list silently retypes the quantity. */}
                                <Input
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  max={s.available}
                                  step={1}
                                  disabled={noStock}
                                  value={displayValue}
                                  onChange={(e) => handleQtyInputChange(s, e.target.value)}
                                  onBlur={() => handleQtyBlur(s)}
                                  onWheel={(e) => e.currentTarget.blur()}
                                  className="h-10 w-16 text-center tabular-nums px-1"
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  className="h-10 w-10 shrink-0"
                                  disabled={noStock || qty >= s.available}
                                  aria-label={t("konsiSuggestions.addLabel")}
                                  onClick={() => commitQty(s, qty + 1)}
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {pageCount > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span className="min-w-0">
                      {t("konsiSuggestions.pageStatus", {
                        page: safePage,
                        pageCount,
                        total: filtered.length,
                      })}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10"
                        disabled={safePage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        {t("konsiSuggestions.prevPage")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10"
                        disabled={safePage >= pageCount}
                        onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                      >
                        {t("konsiSuggestions.nextPage")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {staged.length > 0 && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{t("konsiSuggestions.stagedHeading")}</p>
                  <Badge variant="secondary">{staged.length}</Badge>
                </div>
                <ul className="max-h-56 divide-y overflow-y-auto pr-1">
                  {staged.map((a) => (
                    <li
                      key={keyOf(a.itemId, a.variantSku)}
                      className="flex items-center justify-between gap-2 py-1.5 text-sm first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0 truncate">
                        {a.name}
                        {/* Variant SKU first, label only as secondary text — same reason as the
                          * candidates table: the label can be null and the SKU column can't. */}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {a.sku} · {a.variantSku || "—"}
                        </span>
                        {a.variantLabel && (
                          <span className="ml-1 text-xs text-muted-foreground">({a.variantLabel})</span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="w-10 text-right tabular-nums font-medium">{a.qty}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10"
                          aria-label={t("konsiSuggestions.removeLabel")}
                          onClick={() => removeStaged(a.itemId, a.variantSku)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

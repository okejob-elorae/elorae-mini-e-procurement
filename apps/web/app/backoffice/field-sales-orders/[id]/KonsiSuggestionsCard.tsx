"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, Minus, Plus, Sparkles, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

function keyOf(itemId: string, variantSku: string): string {
  return `${itemId}::${variantSku}`;
}

export function KonsiSuggestionsCard({ suggestions, shortLineCount, staged, onStagedChange }: Props) {
  const t = useTranslations("fieldSalesOrders");
  const [open, setOpen] = useState(() => shortLineCount > 0);
  const [filter, setFilter] = useState("");

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

  function setQty(s: KonsiSuggestion, nextQty: number): void {
    const clamped = Math.max(0, Math.min(s.available, Math.floor(nextQty)));
    const key = keyOf(s.itemId, s.variantSku);
    const rest = staged.filter((a) => keyOf(a.itemId, a.variantSku) !== key);
    if (clamped > 0) {
      rest.push({
        itemId: s.itemId,
        variantSku: s.variantSku,
        sku: s.sku,
        name: s.name,
        variantLabel: s.variantLabel,
        qty: clamped,
      });
    }
    onStagedChange(rest);
  }

  function removeStaged(itemId: string, variantSku: string): void {
    onStagedChange(staged.filter((a) => !(a.itemId === itemId && a.variantSku === variantSku)));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-5 w-5" />
          {t("konsiSuggestions.title")}
          {staged.length > 0 && <Badge variant="secondary">{staged.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {shortLineCount > 0 && (
          <p className="text-sm font-medium text-amber-700">
            {t("konsiSuggestions.shortLinesHeading", { count: shortLineCount })}
          </p>
        )}

        <Button type="button" variant="outline" className="h-10" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {t("konsiSuggestions.toggleLabel")}
        </Button>

        {open && (
          <div className="space-y-4">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("konsiSuggestions.filterPlaceholder")}
              className="h-10 max-w-sm"
            />

            {suggestions.length === 0 ? (
              <div className="py-8 text-center">
                <Sparkles className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{t("konsiSuggestions.empty")}</p>
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">{t("konsiSuggestions.empty")}</p>
            ) : (
              <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("konsiSuggestions.colSku")}</TableHead>
                      <TableHead>{t("konsiSuggestions.colName")}</TableHead>
                      <TableHead className="text-right">{t("konsiSuggestions.colAvailable")}</TableHead>
                      <TableHead className="text-right">{t("konsiSuggestions.colQty")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((s) => {
                      const key = keyOf(s.itemId, s.variantSku);
                      const qty = stagedByKey.get(key) ?? 0;
                      const noStock = s.available === 0;
                      return (
                        <TableRow key={key}>
                          <TableCell className="font-mono text-sm whitespace-nowrap">{s.sku}</TableCell>
                          <TableCell className="max-w-56 truncate">
                            {s.name}
                            {s.variantLabel && (
                              <span className="ml-1 text-xs text-muted-foreground">({s.variantLabel})</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{s.available}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-10 w-10 shrink-0"
                                disabled={noStock || qty <= 0}
                                aria-label={t("konsiSuggestions.removeLabel")}
                                onClick={() => setQty(s, qty - 1)}
                              >
                                <Minus className="h-4 w-4" />
                              </Button>
                              <Input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={s.available}
                                step={1}
                                disabled={noStock}
                                value={String(qty)}
                                onChange={(e) => {
                                  const n = Number(e.target.value);
                                  if (Number.isFinite(n)) setQty(s, n);
                                }}
                                className="h-10 w-16 text-center tabular-nums px-1"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-10 w-10 shrink-0"
                                disabled={noStock || qty >= s.available}
                                aria-label={t("konsiSuggestions.addLabel")}
                                onClick={() => setQty(s, qty + 1)}
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
            )}

            {staged.length > 0 && (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">{t("konsiSuggestions.stagedHeading")}</p>
                <ul className="space-y-2">
                  {staged.map((a) => (
                    <li key={keyOf(a.itemId, a.variantSku)} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0 truncate">
                        {a.name}
                        {a.variantLabel && (
                          <span className="ml-1 text-xs text-muted-foreground">({a.variantLabel})</span>
                        )}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">{a.sku}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums font-medium">{a.qty}</span>
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

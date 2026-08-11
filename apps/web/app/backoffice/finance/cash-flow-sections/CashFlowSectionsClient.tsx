"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Split, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SearchableCombobox,
  type SearchableComboboxOption,
} from "@/components/ui/searchable-combobox";
import {
  setCashFlowSectionAction,
  clearCashFlowSectionAction,
} from "@/app/actions/cash-flow-sections";
import { CASH_FLOW_SECTIONS, type CashFlowSection } from "@/lib/finance/reports/cash-flow-classify";
import type { AccountSectionRow } from "@/lib/finance/reports/cash-flow-queries";
import type { AccountType } from "@/lib/constants/enums";

type Props = {
  rows: AccountSectionRow[];
  canManage: boolean;
};

export function CashFlowSectionsClient({ rows, canManage }: Props) {
  const t = useTranslations("financeCashFlowSections");
  const tAccountType = useTranslations("finance.coa.type");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  /**
   * Per-account-type option lists so the picker signals which sections are
   * valid before the operator submits, instead of only after a rejection toast
   * — the same shape `AccountMappingClient` builds its `optionsByRole` with.
   *
   * Only KAS is ever disabled, and only off ASET, because every cash reader
   * downstream is oriented debit-minus-credit; `setCashFlowSectionAction`
   * enforces the same rule with `KAS_REQUIRES_ASET`. The option stays in the
   * list rather than being filtered out, so an override set before this
   * restriction existed still resolves its trigger label — `SearchableCombobox`
   * matches the label by `value` and never consults `disabled`.
   */
  const optionsByType = useMemo(() => {
    const map = new Map<AccountType, SearchableComboboxOption[]>();
    for (const row of rows) {
      if (map.has(row.type)) continue;
      map.set(
        row.type,
        CASH_FLOW_SECTIONS.map((section) => ({
          value: section,
          label: t(`section.${section}` as never),
          disabled: section === "KAS" && row.type !== "ASET",
        })),
      );
    }
    return map;
  }, [rows, t]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) => row.code.toLowerCase().includes(q) || row.name.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const unclassifiedCount = useMemo(
    () => rows.filter((row) => row.override === null && row.derived === null).length,
    [rows],
  );

  function handleSelect(row: AccountSectionRow, section: string) {
    if (row.override === section) return;
    setSavingId(row.accountId);
    startTransition(async () => {
      const result = await setCashFlowSectionAction(row.accountId, section as CashFlowSection);
      setSavingId(null);
      if (result.ok) {
        toast.success(t("savedToast"));
        router.refresh();
      } else {
        toast.error(t(`error.${result.code}` as never));
      }
    });
  }

  function handleClear(row: AccountSectionRow) {
    setSavingId(row.accountId);
    startTransition(async () => {
      const result = await clearCashFlowSectionAction(row.accountId);
      setSavingId(null);
      if (result.ok) {
        toast.success(t("clearedToast"));
        router.refresh();
      } else {
        toast.error(t(`error.${result.code}` as never));
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      {unclassifiedCount > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          {t("unclassifiedBanner", { count: unclassifiedCount })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Split className="h-5 w-5" />
            {t("cardTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="max-w-sm"
          />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">{t("col.code")}</TableHead>
                  <TableHead>{t("col.name")}</TableHead>
                  <TableHead className="w-32">{t("col.type")}</TableHead>
                  <TableHead className="w-80">{t("col.section")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      {t("empty")}
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((row) => {
                    const rowPending = isPending && savingId === row.accountId;
                    const effective = row.override ?? row.derived;
                    return (
                      <TableRow
                        key={row.accountId}
                        className={!row.isActive ? "opacity-50" : undefined}
                      >
                        <TableCell className="align-top font-mono text-xs">{row.code}</TableCell>
                        <TableCell className="align-top">{row.name}</TableCell>
                        <TableCell className="align-top text-sm text-muted-foreground">
                          {tAccountType(row.type as never)}
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex items-center gap-1">
                            <SearchableCombobox
                              options={optionsByType.get(row.type) ?? []}
                              value={row.override ?? ""}
                              onValueChange={(v) => handleSelect(row, v)}
                              placeholder={
                                row.derived
                                  ? t("derivedPlaceholder", {
                                      section: t(`section.${row.derived}` as never),
                                    })
                                  : t("notSet")
                              }
                              searchPlaceholder={t("searchSection")}
                              emptyMessage={t("noSections")}
                              disabled={!canManage || rowPending}
                              triggerClassName="flex-1 min-w-0"
                            />
                            {canManage && row.override ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 text-muted-foreground"
                                onClick={() => handleClear(row)}
                                disabled={rowPending}
                                aria-label={t("clear")}
                                title={t("clear")}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            ) : (
                              <span className="w-8 shrink-0" aria-hidden />
                            )}
                          </div>
                          {effective === null && (
                            <div className="mt-2">
                              <Badge variant="outline" className="text-muted-foreground">
                                {t("unclassifiedBadge")}
                              </Badge>
                            </div>
                          )}
                          {row.override === null && row.derived !== null && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t("derivedHint", {
                                section: t(`section.${row.derived}` as never),
                              })}
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

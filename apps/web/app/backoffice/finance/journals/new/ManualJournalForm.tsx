"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import { createManualJournalAction } from "@/app/actions/journals";
import type { AccountType } from "@/lib/constants/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";

type AccountOption = { id: string; code: string; name: string; type: AccountType };

type Props = {
  accounts: AccountOption[];
};

type Line = {
  id: string;
  chartAccountId: string;
  debit: string;
  credit: string;
  memo: string;
};

function emptyLine(): Line {
  return { id: `ln-${Date.now()}-${Math.random().toString(36).slice(2)}`, chartAccountId: "", debit: "", credit: "", memo: "" };
}

function todayDateOnly(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

const ERROR_KEYS = new Set(["UNBALANCED", "TOO_FEW_LINES", "BAD_LINE", "NON_POSTABLE_ACCOUNT", "FORBIDDEN"]);

export function ManualJournalForm({ accounts }: Props) {
  const t = useTranslations("financeJournals");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [date, setDate] = useState(todayDateOnly());
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);

  const accountOptions = useMemo(
    () => accounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
    [accounts],
  );

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function setDebit(id: string, value: string) {
    updateLine(id, { debit: value, credit: value ? "" : lines.find((l) => l.id === id)?.credit ?? "" });
  }

  function setCredit(id: string, value: string) {
    updateLine(id, { credit: value, debit: value ? "" : lines.find((l) => l.id === id)?.debit ?? "" });
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(id: string) {
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((l) => l.id !== id)));
  }

  const sumDebit = lines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0);
  const sumCredit = lines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0);
  const diff = sumDebit - sumCredit;
  const balanced = Math.abs(diff) < 0.01;

  const qualifyingLines = lines.filter(
    (l) => l.chartAccountId && ((parseFloat(l.debit) || 0) > 0 || (parseFloat(l.credit) || 0) > 0),
  );
  const canSubmit = balanced && qualifyingLines.length >= 2 && description.trim().length > 0 && sumDebit > 0;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || !canSubmit) return;

    startTransition(async () => {
      try {
        const result = await createManualJournalAction({
          date,
          description: description.trim(),
          lines: qualifyingLines.map((l) => ({
            chartAccountId: l.chartAccountId,
            debit: parseFloat(l.debit) || 0,
            credit: parseFloat(l.credit) || 0,
            memo: l.memo.trim() || undefined,
          })),
        });

        if (result.ok) {
          toast.success(t("createSuccess"));
          router.push(`/backoffice/finance/journals/${result.journalId}`);
          return;
        }

        const key = ERROR_KEYS.has(result.code) ? result.code : "UNKNOWN";
        toast.error(t(`error.${key}` as never));
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/backoffice/finance/journals">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("back")}
          </Link>
        </Button>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t("newJournal")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="journal-date">{t("form.date")}</Label>
                <Input
                  id="journal-date"
                  type="date"
                  required
                  disabled={pending}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="journal-description">{t("form.description")}</Label>
              <Textarea
                id="journal-description"
                rows={2}
                maxLength={500}
                required
                disabled={pending}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("form.descriptionPlaceholder")}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("form.linesTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lines.map((line, idx) => (
              <div key={line.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Label className="text-xs">{t("form.account")}</Label>
                    <SearchableCombobox
                      options={accountOptions}
                      value={line.chartAccountId}
                      onValueChange={(value) => updateLine(line.id, { chartAccountId: value })}
                      placeholder={t("form.selectAccount")}
                      searchPlaceholder={t("form.searchAccount")}
                      emptyMessage={t("form.noAccounts")}
                      disabled={pending}
                      triggerClassName="w-full"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-6 shrink-0"
                    disabled={pending || lines.length <= 2}
                    onClick={() => removeLine(line.id)}
                    aria-label={t("form.removeLine")}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("form.debit")}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      inputMode="decimal"
                      disabled={pending}
                      value={line.debit}
                      onChange={(e) => setDebit(line.id, e.target.value)}
                      placeholder="0"
                      className="text-right"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("form.credit")}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      inputMode="decimal"
                      disabled={pending}
                      value={line.credit}
                      onChange={(e) => setCredit(line.id, e.target.value)}
                      placeholder="0"
                      className="text-right"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("form.memo")}</Label>
                  <Input
                    disabled={pending}
                    value={line.memo}
                    onChange={(e) => updateLine(line.id, { memo: e.target.value })}
                    placeholder={t("form.memoPlaceholder", { n: idx + 1 })}
                  />
                </div>
              </div>
            ))}

            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={addLine}>
              <Plus className="mr-2 h-4 w-4" />
              {t("form.addLine")}
            </Button>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 pt-2">
              <SummaryTile label={t("form.totalDebit")} value={formatRupiah(sumDebit)} />
              <SummaryTile label={t("form.totalCredit")} value={formatRupiah(sumCredit)} />
              <SummaryTile
                label={t("form.difference")}
                value={formatRupiah(Math.abs(diff))}
                tone={balanced ? "ok" : "warn"}
              />
              <div
                className={
                  balanced
                    ? "flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-400"
                    : "flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400"
                }
              >
                {balanced ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
                <span>{balanced ? t("form.balanced") : t("form.unbalanced")}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Button type="submit" disabled={pending || !canSubmit} className="w-full sm:w-auto">
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {pending ? t("form.submitting") : t("form.submit")}
        </Button>
      </form>
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <Card className="gap-1 p-3">
      <p className="text-xs text-muted-foreground truncate">{label}</p>
      <p
        className={
          tone === "warn"
            ? "text-lg font-semibold tabular-nums truncate text-amber-600 dark:text-amber-400"
            : tone === "ok"
              ? "text-lg font-semibold tabular-nums truncate text-green-700 dark:text-green-400"
              : "text-lg font-semibold tabular-nums truncate"
        }
      >
        {value}
      </p>
    </Card>
  );
}

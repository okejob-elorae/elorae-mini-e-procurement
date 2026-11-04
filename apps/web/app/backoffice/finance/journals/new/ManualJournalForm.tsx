"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import { createManualJournalAction, updateManualJournalDraftAction } from "@/app/actions/journals";
import type { AccountType } from "@/lib/constants/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { LABEL_KANAL_JURNAL, SEMUA_KANAL_JURNAL } from "@/lib/finance/journals/kanal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { alasanBelumBisaPosting, keadaanSaldo } from "./alasan-posting";

type AccountOption = { id: string; code: string; name: string; type: AccountType };

/** Draf yang diubah pembuatnya (`/backoffice/finance/journals/[id]/ubah`). */
export type DrafJurnal = {
  id: string;
  date: string;
  description: string;
  lines: Array<{ chartAccountId: string; debit: number; credit: number; memo: string | null; channel: string | null }>;
};

type Props = {
  accounts: AccountOption[];
  draft?: DrafJurnal;
};

type Line = {
  id: string;
  chartAccountId: string;
  debit: string;
  credit: string;
  memo: string;
  channel: string;
};

const TANPA_KANAL = "__tanpa__";

function emptyLine(): Line {
  return { id: `ln-${Date.now()}-${Math.random().toString(36).slice(2)}`, chartAccountId: "", debit: "", credit: "", memo: "", channel: "" };
}

/** Hari ini menurut WIB, bukan zona peramban. */
function todayDateOnly(): string {
  return formatDateOnlyJakarta(new Date());
}

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

const ERROR_KEYS = new Set(["UNBALANCED", "TOO_FEW_LINES", "BAD_LINE", "NON_POSTABLE_ACCOUNT", "PERIOD_CLOSED", "FORBIDDEN"]);

export function ManualJournalForm({ accounts, draft }: Props) {
  const t = useTranslations("financeJournals");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Satu kunci per isian formulir: kiriman ulang sesudah jawaban hilang mengembalikan draf yang sama.
  const [idempotencyKey] = useState(() => newLocalId());

  const [date, setDate] = useState(draft?.date ?? todayDateOnly());
  const [description, setDescription] = useState(draft?.description ?? "");
  const [lines, setLines] = useState<Line[]>(() =>
    draft?.lines.length
      ? draft.lines.map((l) => ({
          ...emptyLine(),
          chartAccountId: l.chartAccountId,
          debit: l.debit > 0 ? String(l.debit) : "",
          credit: l.credit > 0 ? String(l.credit) : "",
          memo: l.memo ?? "",
          channel: l.channel ?? "",
        }))
      : [emptyLine(), emptyLine()],
  );

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
  const saldo = keadaanSaldo(sumDebit, sumCredit);
  const balanced = saldo === "seimbang";

  const qualifyingLines = lines.filter(
    (l) => l.chartAccountId && ((parseFloat(l.debit) || 0) > 0 || (parseFloat(l.credit) || 0) > 0),
  );
  const alasan = alasanBelumBisaPosting({ description, lines });
  const canSubmit = alasan === null && sumDebit > 0;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || !canSubmit) return;

    startTransition(async () => {
      try {
        const isi = {
          date,
          description: description.trim(),
          lines: qualifyingLines.map((l) => ({
            chartAccountId: l.chartAccountId,
            debit: parseFloat(l.debit) || 0,
            credit: parseFloat(l.credit) || 0,
            memo: l.memo.trim() || undefined,
            channel: l.channel || null,
          })),
        };
        const result = draft ? await updateManualJournalDraftAction({ ...isi, id: draft.id }) : await createManualJournalAction({ ...isi, idempotencyKey });

        if (result.ok) {
          toast.success(draft ? t("persetujuan.drafTersimpan") : t("persetujuan.diajukan"));
          router.push(`/backoffice/finance/journals/${result.journalId}`);
          router.refresh();
          return;
        }

        if (t.has(`persetujuan.err.${result.code}`)) toast.error(t(`persetujuan.err.${result.code}` as never));
        else toast.error(t(`error.${ERROR_KEYS.has(result.code) ? result.code : "UNKNOWN"}` as never));
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={draft ? `/backoffice/finance/journals/${draft.id}` : "/backoffice/finance/journals"}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("back")}
          </Link>
        </Button>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-1">
              <CardTitle>{draft ? t("persetujuan.ubahDraf") : t("newJournal")}</CardTitle>
              <TombolBantuan judul={draft ? t("persetujuan.ubahDraf") : t("newJournal")} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="journal-date">{t("form.date")}</Label>
                <TanggalInput
                  id="journal-date"
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
                maxLength={191}
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
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_200px]">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("form.memo")}</Label>
                    <Input
                      disabled={pending}
                      value={line.memo}
                      maxLength={191}
                      onChange={(e) => updateLine(line.id, { memo: e.target.value })}
                      placeholder={t("form.memoPlaceholder", { n: idx + 1 })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("persetujuan.kanal")}</Label>
                    <Select
                      value={line.channel || TANPA_KANAL}
                      onValueChange={(v) => updateLine(line.id, { channel: v === TANPA_KANAL ? "" : v })}
                      disabled={pending}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={TANPA_KANAL}>{t("persetujuan.tanpaKanal")}</SelectItem>
                        {SEMUA_KANAL_JURNAL.map((k) => (
                          <SelectItem key={k} value={k}>
                            {LABEL_KANAL_JURNAL[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
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
                tone={saldo === "kosong" ? undefined : balanced ? "ok" : "warn"}
              />
              {saldo === "kosong" ? (
                <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
                  <span>{t("form.noAmount")}</span>
                </div>
              ) : (
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
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-2">
          <Button type="submit" disabled={pending || !canSubmit} className="w-full sm:w-auto">
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {pending ? t("persetujuan.mengirim") : draft ? t("persetujuan.simpanDraf") : t("persetujuan.ajukan")}
          </Button>
          {alasan && !pending && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {alasan.kunci === "lineAccount"
                ? t("form.reason.lineAccount", { n: alasan.n })
                : t(`form.reason.${alasan.kunci}`)}
            </p>
          )}
        </div>
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

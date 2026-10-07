"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FolderTree, Link2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { setAccountMappingAction, clearAccountMappingAction } from "@/app/actions/account-mapping";
import { POSTING_ROLES, type PostingRole } from "@/lib/constants/journal-roles";
import type { AccountMappingRow } from "@/lib/finance/journals/mapping";
import type { AccountType } from "@/lib/constants/enums";
import { POSTING_ROLE_ACCOUNT_TYPES } from "@/lib/finance/journals/role-account-types";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";
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
import { PERAN_CADANGAN, PERAN_OPSIONAL, PERAN_WAJIB } from "../_kesiapan/kesiapan";

type Account = { id: string; code: string; name: string; type: AccountType };

type Props = {
  mappings: AccountMappingRow[];
  accounts: Account[];
  canManage: boolean;
  /** Tautan ke Bagan Akun hanya untuk yang boleh membukanya. */
  canViewCoa: boolean;
};

export function AccountMappingClient({ mappings, accounts, canManage, canViewCoa }: Props) {
  const t = useTranslations("financeAccountMapping");
  const tAccountType = useTranslations("finance.coa.type");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [savingRole, setSavingRole] = useState<PostingRole | null>(null);
  // Mengganti akun yang SUDAH terpetakan mengubah tujuan semua jurnal otomatis berikutnya → minta konfirmasi.
  const [gantiAkun, setGantiAkun] = useState<{ role: PostingRole; chartAccountId: string } | null>(null);

  const byRole = useMemo(() => {
    const map = new Map<PostingRole, AccountMappingRow>();
    for (const m of mappings) map.set(m.role, m);
    return map;
  }, [mappings]);

  /**
   * Per-role option lists so the picker signals which accounts are valid
   * before the operator submits, instead of only after a rejection toast.
   * Every account for the role stays in the list — type-invalid accounts
   * are disabled outright, including one currently mapped to the role. A
   * mismatched current mapping still resolves its trigger label, because
   * `SearchableCombobox` looks up the label by matching `value` and never
   * consults `disabled` (see `components/ui/searchable-combobox.tsx`), so
   * the bad mapping stays visible (and flagged by the destructive badge
   * below) without being re-selectable.
   *
   * `accounts` is sorted numeric-aware ONCE (matching
   * `getPostableAccounts`, `apps/web/lib/finance/coa/queries.ts`), then each
   * role derives its option list by filtering that same sorted array into
   * type-valid accounts followed by type-invalid ones. `Array.prototype.filter`
   * is stable, so the numeric code order is preserved within each group
   * without re-sorting per role. Type-valid accounts always come first and
   * every label carries its account type.
   */
  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    [accounts],
  );

  const optionsByRole = useMemo(() => {
    const map = new Map<PostingRole, SearchableComboboxOption[]>();
    for (const role of POSTING_ROLES) {
      const validTypes = POSTING_ROLE_ACCOUNT_TYPES[role];
      const partitioned = [
        ...sortedAccounts.filter((a) => validTypes.includes(a.type)),
        ...sortedAccounts.filter((a) => !validTypes.includes(a.type)),
      ];
      map.set(
        role,
        partitioned.map((a) => ({
          value: a.id,
          label: `${a.code} — ${a.name} (${tAccountType(a.type as never)})`,
          disabled: !validTypes.includes(a.type),
        })),
      );
    }
    return map;
  }, [sortedAccounts, tAccountType]);

  const jumlahTerpetakan = POSTING_ROLES.filter((r) => byRole.get(r)?.chartAccountId).length;
  const jumlahWajibTerpetakan = PERAN_WAJIB.filter((r) => {
    const m = byRole.get(r);
    return m?.chartAccountId && m.typeValid;
  }).length;

  /** Akun lama dibaca dari pemetaannya — bisa sudah nonaktif sehingga tidak ada di daftar pilihan. */
  function akunLama(role: PostingRole): string {
    const m = byRole.get(role);
    return m?.accountCode ? `${m.accountCode} — ${m.accountName ?? ""}` : labelAkun(m?.chartAccountId);
  }

  function labelAkun(chartAccountId: string | null | undefined): string {
    const a = accounts.find((x) => x.id === chartAccountId);
    return a ? `${a.code} — ${a.name}` : "—";
  }

  function handleSelect(role: PostingRole, chartAccountId: string) {
    const lama = byRole.get(role)?.chartAccountId;
    if (lama === chartAccountId) return;
    if (lama) {
      setGantiAkun({ role, chartAccountId });
      return;
    }
    simpan(role, chartAccountId);
  }

  function simpan(role: PostingRole, chartAccountId: string) {
    setSavingRole(role);
    startTransition(async () => {
      const result = await setAccountMappingAction(role, chartAccountId);
      setSavingRole(null);
      if (result.ok) {
        toast.success(t("savedToast"));
        router.refresh();
      } else {
        toast.error(t(`error.${result.code}` as never));
      }
    });
  }

  function handleClear(role: PostingRole) {
    setSavingRole(role);
    startTransition(async () => {
      const result = await clearAccountMappingAction(role);
      setSavingRole(null);
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
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <TombolBantuan judul={t("title")} />
          </div>
          <p className="text-sm text-muted-foreground">
            {t("summary", {
              mapped: jumlahTerpetakan,
              total: POSTING_ROLES.length,
              required: jumlahWajibTerpetakan,
              requiredTotal: PERAN_WAJIB.length,
            })}
          </p>
        </div>
        {canViewCoa && (
          <Button variant="outline" asChild>
            <Link href="/backoffice/finance/coa">
              <FolderTree className="mr-2 h-4 w-4" />
              {t("openCoa")}
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            {t("cardTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-48">{t("col.role")}</TableHead>
                  <TableHead>{t("col.description")}</TableHead>
                  <TableHead className="w-80 min-w-72">{t("col.account")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {POSTING_ROLES.map((role) => {
                  const mapping = byRole.get(role);
                  const value = mapping?.chartAccountId ?? "";
                  const rowPending = isPending && savingRole === role;
                  const adaAkunCocok = (optionsByRole.get(role) ?? []).some((o) => !o.disabled);
                  return (
                    <TableRow key={role}>
                      <TableCell className="align-top font-medium whitespace-normal">
                        {t(`role.${role}` as never)}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {!value && (
                            <Badge variant="outline" className="text-muted-foreground">
                              {t("notSet")}
                            </Badge>
                          )}
                          {role === PERAN_CADANGAN && <Badge variant="secondary">{t("badgeFallback")}</Badge>}
                          {PERAN_OPSIONAL.includes(role) && (
                            <Badge variant="outline" className="text-muted-foreground">
                              {t("badgeOptional")}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground whitespace-normal min-w-64">
                        {t(`desc.${role}` as never)}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex items-center gap-1">
                          <SearchableCombobox
                            options={optionsByRole.get(role) ?? []}
                            value={value}
                            onValueChange={(v) => handleSelect(role, v)}
                            placeholder={t("selectAccount")}
                            searchPlaceholder={t("searchAccount")}
                            emptyMessage={t("noAccounts")}
                            disabled={!canManage || rowPending}
                            triggerClassName="flex-1 min-w-0"
                          />
                          {canManage && value ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-muted-foreground"
                              onClick={() => handleClear(role)}
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
                        {!value && !adaAkunCocok && (
                          <p className="mt-2 text-sm text-muted-foreground">
                            {t("noValidAccount", {
                              expected: POSTING_ROLE_ACCOUNT_TYPES[role]
                                .map((type) => tAccountType(type as never))
                                .join(" / "),
                            })}{" "}
                            {canViewCoa && (
                              <Link href="/backoffice/finance/coa" className="underline underline-offset-4">
                                {t("createInCoa")}
                              </Link>
                            )}
                          </p>
                        )}
                        {mapping && mapping.typeValid === false && (
                          <div className="mt-2 space-y-1">
                            <Badge variant="destructive">{t("typeMismatchBadge")}</Badge>
                            <p className="text-sm text-destructive">
                              {t("typeMismatchHint", {
                                code: mapping.accountCode ?? "",
                                type: mapping.accountType
                                  ? tAccountType(mapping.accountType as never)
                                  : "",
                                expected: POSTING_ROLE_ACCOUNT_TYPES[role]
                                  .map((type) => tAccountType(type as never))
                                  .join(" / "),
                              })}
                            </p>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={gantiAkun !== null} onOpenChange={(open) => !open && setGantiAkun(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("replaceTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {gantiAkun
                ? t("replaceBody", {
                    role: t(`role.${gantiAkun.role}` as never),
                    from: akunLama(gantiAkun.role),
                    to: labelAkun(gantiAkun.chartAccountId),
                  })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("replaceCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const pilihan = gantiAkun;
                setGantiAkun(null);
                if (pilihan) simpan(pilihan.role, pilihan.chartAccountId);
              }}
            >
              {t("replaceConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

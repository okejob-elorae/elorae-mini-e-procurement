"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link2, X } from "lucide-react";
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

type Account = { id: string; code: string; name: string; type: AccountType };

type Props = {
  mappings: AccountMappingRow[];
  accounts: Account[];
  canManage: boolean;
};

export function AccountMappingClient({ mappings, accounts, canManage }: Props) {
  const t = useTranslations("financeAccountMapping");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [savingRole, setSavingRole] = useState<PostingRole | null>(null);

  const byRole = useMemo(() => {
    const map = new Map<PostingRole, AccountMappingRow>();
    for (const m of mappings) map.set(m.role, m);
    return map;
  }, [mappings]);

  /**
   * Per-role option lists so the picker signals which accounts are valid
   * before the operator submits, instead of only after a rejection toast.
   * Every account for the role stays in the list — an already-mismatched
   * mapping (see the destructive badge below) must still resolve to a
   * label — but type-invalid accounts are disabled (non-selectable) unless
   * they are the account currently mapped to that role, so a bad mapping
   * stays visible and replaceable instead of vanishing from the trigger.
   * Type-valid accounts always sort first and every label carries its
   * account type.
   */
  const optionsByRole = useMemo(() => {
    const map = new Map<PostingRole, SearchableComboboxOption[]>();
    for (const role of POSTING_ROLES) {
      const validTypes = POSTING_ROLE_ACCOUNT_TYPES[role];
      const currentAccountId = byRole.get(role)?.chartAccountId ?? null;
      const sorted = [...accounts].sort((a, b) => {
        const aValid = validTypes.includes(a.type);
        const bValid = validTypes.includes(b.type);
        if (aValid !== bValid) return aValid ? -1 : 1;
        return a.code.localeCompare(b.code);
      });
      map.set(
        role,
        sorted.map((a) => ({
          value: a.id,
          label: `${a.code} — ${a.name} (${a.type})`,
          disabled: !validTypes.includes(a.type) && a.id !== currentAccountId,
        })),
      );
    }
    return map;
  }, [accounts, byRole]);

  function handleSelect(role: PostingRole, chartAccountId: string) {
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
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
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
                  <TableHead className="w-56">{t("col.role")}</TableHead>
                  <TableHead>{t("col.description")}</TableHead>
                  <TableHead className="w-80">{t("col.account")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {POSTING_ROLES.map((role) => {
                  const mapping = byRole.get(role);
                  const value = mapping?.chartAccountId ?? "";
                  const rowPending = isPending && savingRole === role;
                  return (
                    <TableRow key={role}>
                      <TableCell className="align-top font-medium">
                        {t(`role.${role}` as never)}
                        {!value && (
                          <div className="mt-1">
                            <Badge variant="outline" className="text-muted-foreground">
                              {t("notSet")}
                            </Badge>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
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
                        {mapping && mapping.typeValid === false && (
                          <div className="mt-2 space-y-1">
                            <Badge variant="destructive">{t("typeMismatchBadge")}</Badge>
                            <p className="text-sm text-destructive">
                              {t("typeMismatchHint", {
                                code: mapping.accountCode ?? "",
                                type: mapping.accountType ?? "",
                                expected: POSTING_ROLE_ACCOUNT_TYPES[role].join(" / "),
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
    </div>
  );
}

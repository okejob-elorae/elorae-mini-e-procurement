"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { setAccountMappingAction } from "@/app/actions/account-mapping";
import { POSTING_ROLES, type PostingRole } from "@/lib/constants/journal-roles";
import type { AccountMappingRow } from "@/lib/finance/journals/mapping";
import type { AccountType } from "@/lib/constants/enums";

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

  const options = useMemo(
    () => accounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
    [accounts],
  );

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
                        <SearchableCombobox
                          options={options}
                          value={value}
                          onValueChange={(v) => handleSelect(role, v)}
                          placeholder={t("selectAccount")}
                          searchPlaceholder={t("searchAccount")}
                          emptyMessage={t("noAccounts")}
                          disabled={!canManage || rowPending}
                          triggerClassName="w-full"
                        />
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

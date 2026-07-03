"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus, Loader2, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getOpnames } from "@/app/actions/stock-opname";

type OpnameRow = Awaited<ReturnType<typeof getOpnames>>[number];

export function StockOpnameListClient() {
  const t = useTranslations("stockOpname");
  const [rows, setRows] = useState<OpnameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("__all__");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await getOpnames(
          statusFilter === "__all__" ? undefined : { status: statusFilter as OpnameRow["status"] },
        );
        if (!cancelled) setRows(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Link href="/backoffice/inventory/stock-opname/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            {t("new")}
          </Button>
        </Link>
      </div>

      <Select value={statusFilter} onValueChange={setStatusFilter}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder={t("status")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All</SelectItem>
          {(["CREATED", "COUNTING", "SUBMITTED", "APPROVED", "CANCELLED"] as const).map((s) => (
            <SelectItem key={s} value={s}>
              {t(`statuses.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            {t("title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">No sessions yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("docNumber")}</TableHead>
                  <TableHead>{t("scope")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead>{t("rows")}</TableHead>
                  <TableHead>{t("created")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={String(row.id)}>
                    <TableCell>
                      <Link
                        href={`/backoffice/inventory/stock-opname/${row.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {String(row.docNumber)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{t(`scopes.${row.scope as string}`)}</Badge>
                    </TableCell>
                    <TableCell>{t(`statuses.${row.status as string}`)}</TableCell>
                    <TableCell>{Number((row as { rowCount?: number }).rowCount ?? 0)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {row.createdAt ? new Date(String(row.createdAt)).toLocaleString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

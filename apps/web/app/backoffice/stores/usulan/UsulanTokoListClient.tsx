"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, MapPin, Search, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pager } from "@/components/Pager";
import { dinamis } from "@/lib/i18n/dinamis";

type Status = "PENDING" | "APPROVED" | "REJECTED";

type Baris = {
  id: string;
  name: string;
  address: string;
  status: Status;
  termsType: "PUTUS" | "KONSI" | null;
  areaCode: string | null;
  pengusul: string | null;
  adaLokasi: boolean;
  tanggal: string;
};

const SARINGAN = ["PENDING", "APPROVED", "REJECTED", "SEMUA"] as const;

export function lencanaStatus(status: Status): "default" | "secondary" | "destructive" | "outline" {
  if (status === "APPROVED") return "default";
  if (status === "REJECTED") return "destructive";
  return "secondary";
}

export function UsulanTokoListClient({
  status,
  cari,
  page,
  pageSize,
  total,
  baris,
}: {
  status: Status | "SEMUA";
  cari: string;
  page: number;
  pageSize: number;
  total: number;
  baris: Baris[];
}) {
  const t = useTranslations("storeProposals");
  const td = dinamis(t);
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();
  const [cariInput, setCariInput] = useState(cari);

  useEffect(() => {
    const tunda = setTimeout(() => {
      if (cariInput !== cari) dorong({ q: cariInput || undefined, page: undefined });
    }, 300);
    return () => clearTimeout(tunda);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cariInput]);

  function dorong(ubah: Record<string, string | undefined>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(ubah)) {
      if (v === undefined || v === "") params.delete(k);
      else params.set(k, v);
    }
    startTransition(() => router.push(`/backoffice/stores/usulan?${params.toString()}`));
  }

  const kosong = cari ? t("emptyFiltered") : status === "PENDING" ? t("emptyPending") : t("empty");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href="/backoffice/stores">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {t("backToStores")}
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={cariInput}
            onChange={(e) => setCariInput(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => dorong({ status: v === "PENDING" ? undefined : v, page: undefined })}>
          <SelectTrigger className="w-full sm:w-48" aria-label={t("filterStatus")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SARINGAN.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "SEMUA" ? t("statusAll") : td(`status_${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            {t("cardTitle")}
            <span className="ml-2 text-sm font-normal text-muted-foreground">({t("count", { count: total })})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {baris.length === 0 ? (
            <div className="py-12 text-center">
              <Store className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground">{kosong}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colName")}</TableHead>
                    <TableHead>{t("colArea")}</TableHead>
                    <TableHead>{t("colType")}</TableHead>
                    <TableHead>{t("colProposer")}</TableHead>
                    <TableHead>{t("colDate")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("colLocation")}</TableHead>
                    <TableHead>{t("colStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow
                      key={b.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => startTransition(() => router.push(`/backoffice/stores/usulan/${b.id}`))}
                    >
                      <TableCell className="whitespace-normal">
                        <Link
                          href={`/backoffice/stores/usulan/${b.id}`}
                          className="font-medium hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {b.name}
                        </Link>
                        <p className="line-clamp-1 max-w-[320px] text-xs text-muted-foreground" title={b.address}>
                          {b.address}
                        </p>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{b.areaCode ?? "—"}</TableCell>
                      <TableCell>{b.termsType ? td(`type_${b.termsType}`) : <span className="text-muted-foreground">{t("typeUnknown")}</span>}</TableCell>
                      <TableCell>{b.pengusul ?? <span className="text-muted-foreground">{t("unknownUser")}</span>}</TableCell>
                      <TableCell className="tabular-nums">{b.tanggal}</TableCell>
                      <TableCell className="hidden 2xl:table-cell">
                        {b.adaLokasi ? (
                          <span className="inline-flex items-center gap-1 text-sm">
                            <MapPin className="h-3.5 w-3.5" />
                            {t("hasLocation")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{t("noLocation")}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={lencanaStatus(b.status)}>{td(`status_${b.status}`)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Pager
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={(p) => dorong({ page: String(p) })}
        onPageSizeChange={(size) => dorong({ pageSize: String(size), page: undefined })}
      />
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ScrollText } from "lucide-react";
import type { AccountType } from "@/lib/constants/enums";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Akun = { id: string; code: string; name: string; type: AccountType; aktif: boolean };

export function BukuBesarIndeksClient({ akun }: { akun: Akun[] }) {
  const t = useTranslations("financeJournals.ledgerIndeks");
  const tCoa = useTranslations("finance.coa");
  const [cari, setCari] = useState("");

  const tersaring = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return q ? akun.filter((a) => `${a.code} ${a.name}`.toLowerCase().includes(q)) : akun;
  }, [akun, cari]);

  return (
    <div className="space-y-6">
      <PageHeader title={t("judul")} meta={t("jumlahAkun", { jumlah: akun.length })} />

      <Card className="p-4">
        <div className="max-w-md">
          <label htmlFor="cari-akun" className="text-xs text-muted-foreground mb-1 block">
            {t("cari")}
          </label>
          <Input id="cari-akun" value={cari} placeholder={t("cariPlaceholder")} onChange={(e) => setCari(e.target.value)} />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            {t("daftar")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tersaring.length === 0 ? (
            <div className="text-center py-12">
              <ScrollText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">{akun.length === 0 ? t("kosong") : t("kosongTersaring")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolomKode")}</TableHead>
                    <TableHead>{t("kolomNama")}</TableHead>
                    <TableHead>{t("kolomJenis")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tersaring.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{a.code}</TableCell>
                      <TableCell className="whitespace-normal">
                        <Link href={`/backoffice/finance/journals/ledger/${a.id}`} className="underline underline-offset-4">
                          {a.name}
                        </Link>
                        {!a.aktif ? (
                          <Badge variant="secondary" className="ml-2">
                            {t("nonaktif")}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{tCoa(`type.${a.type}` as never)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

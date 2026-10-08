"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CircleCheck, CircleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDisplayDateTime } from "@/lib/date-only";
import { journalSourceLabel } from "../journal-source-label";
import { langkahPostingUlang, perluPemetaanAkun, sebabTerkini } from "./sebab";
import type { BarisJurnalTertunda } from "./muat";

type Props = {
  rows: BarisJurnalTertunda[];
};

/**
 * Tab "Tertunda" halaman Jurnal: dokumen yang jurnal otomatisnya gagal, sebabnya,
 * dan tempat memperbaikinya. Tujuan baris "Jurnal gagal diposting" di Beranda.
 */
export function DaftarJurnalTertunda({ rows }: Props) {
  const t = useTranslations("financeJournals");
  const tPeran = useTranslations("financeAccountMapping");
  const locale = useLocale();

  function namaPeran(peran: string | null): string | null {
    if (!peran) return null;
    const kunci = `role.${peran}`;
    return /^[A-Z_]+$/.test(peran) && tPeran.has(kunci) ? tPeran(kunci) : null;
  }

  function teksSebab(r: BarisJurnalTertunda): string {
    const kunci = sebabTerkini(r.sebab, r.peranKiniTerpetakan);
    if (kunci === "UNMAPPED_ROLE_SUDAH") {
      // Sebab tersimpan sudah basi: perannya kini terpetakan, jurnalnya tinggal diposting ulang.
      return t("tertunda.sebabTerkini.UNMAPPED_ROLE_SUDAH", { peran: namaPeran(r.peran) ?? r.peran ?? "" });
    }
    if (kunci === "UNMAPPED_ROLE") {
      const peran = namaPeran(r.peran);
      return peran ? t("tertunda.sebab.UNMAPPED_ROLE", { peran }) : t("tertunda.sebab.UNMAPPED_ROLE_TANPA_PERAN");
    }
    return t(`tertunda.sebab.${kunci}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CircleAlert className="h-5 w-5" />
          {t("tertunda.listTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-center py-12">
            <CircleCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">{t("tertunda.empty")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("tertunda.colDocument")}</TableHead>
                  <TableHead>{t("tertunda.colReason")}</TableHead>
                  <TableHead>{t("tertunda.colRecorded")}</TableHead>
                  <TableHead>{t("tertunda.colAction")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-normal min-w-[200px]">
                      {r.jenis ? (
                        <div className="space-y-1">
                          <Badge variant="outline">{journalSourceLabel(t, r.jenis)}</Badge>
                          <div className="text-sm">
                            {r.hrefDokumen ? (
                              <Link href={r.hrefDokumen} className="font-medium underline underline-offset-4">
                                {r.nomor ?? t("tertunda.openDocument")}
                              </Link>
                            ) : (
                              <span className="font-medium">{r.nomor ?? "—"}</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">{t("tertunda.unknownDocument")}</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal min-w-[240px] max-w-[420px] text-sm">
                      <p>{teksSebab(r)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{t(`tertunda.langkah.${langkahPostingUlang(r.jenis)}`)}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDisplayDateTime(r.dicatatPada, locale)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        {perluPemetaanAkun(r.sebab) && r.peranKiniTerpetakan !== true && (
                          <Button variant="outline" size="sm" asChild>
                            <Link href="/backoffice/finance/account-mapping">{t("tertunda.actionMapping")}</Link>
                          </Button>
                        )}
                        {r.hrefPostingUlang && (
                          <Button variant="outline" size="sm" asChild>
                            <Link href={r.hrefPostingUlang}>{t("tertunda.actionRetry")}</Link>
                          </Button>
                        )}
                        {r.otomatis && (
                          <span className="text-xs text-muted-foreground">{t("tertunda.automatic")}</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

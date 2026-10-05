"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ListOrdered, SearchX, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dinamis } from "@/lib/i18n/dinamis";
import type { RingkasBarangDicari } from "@/lib/spg/kantor-queries";

export type PeriodeHari = 7 | 30 | 90;

type BarisDicari = {
  id: string;
  /** Sudah diformat di server. */
  waktu: string;
  toko: string;
  oleh: string;
  keterangan: string;
  qty: number;
};

const PERIODE: PeriodeHari[] = [7, 30, 90];

export function BarangDicariClient({
  hari,
  ringkas,
  baris,
  terpotong,
}: {
  hari: PeriodeHari;
  ringkas: RingkasBarangDicari[];
  baris: BarisDicari[];
  terpotong: boolean;
}) {
  const t = useTranslations("spgLostSales");
  const td = dinamis(t);
  const router = useRouter();
  const [pindah, mulai] = useTransition();

  return (
    <div className="space-y-6">
      <PageHeader title={t("pageTitle")} />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">{t("periodLabel")}</span>
        <Tabs
          value={String(hari)}
          onValueChange={(v) => mulai(() => router.push(`/backoffice/spg-lost-sales?hari=${v}`))}
        >
          <TabsList>
            {PERIODE.map((p) => (
              <TabsTrigger key={p} value={String(p)} disabled={pindah}>
                {td(`period.${p}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {terpotong ? <span className="text-sm text-amber-700 dark:text-amber-400">{t("capNote")}</span> : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            {t("summaryTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ringkas.length === 0 ? (
            <EmptyState icon={SearchX} title={t("emptyTitle")} description={t("emptyBody")} />
          ) : (
            <div className="max-h-[28rem] overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>{t("colDescription")}</TableHead>
                    <TableHead className="text-right">{t("colQty")}</TableHead>
                    <TableHead className="text-right">{t("colTimes")}</TableHead>
                    <TableHead className="text-right">{t("colStores")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ringkas.map((r) => (
                    <TableRow key={r.keterangan.toLowerCase()}>
                      <TableCell className="min-w-[14rem] whitespace-normal font-medium">{r.keterangan}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{r.qty}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {t("timesValue", { count: r.kali })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {t("storesValue", { count: r.toko })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {baris.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListOrdered className="h-5 w-5" />
              {t("detailTitle")}
              <span className="ml-2 text-sm font-normal text-muted-foreground">({t("count", { count: baris.length })})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[36rem] overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>{t("colTime")}</TableHead>
                    <TableHead>{t("colStore")}</TableHead>
                    <TableHead>{t("colDescription")}</TableHead>
                    <TableHead className="text-right">{t("colQtyShort")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("colBy")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{b.waktu}</TableCell>
                      <TableCell className="min-w-[9rem] whitespace-normal">{b.toko}</TableCell>
                      <TableCell className="min-w-[14rem] whitespace-normal">
                        {b.keterangan}
                        {/* Di bawah 2xl pencatatnya menumpang di sini, bukan kolom sendiri. */}
                        <span className="block text-xs text-muted-foreground 2xl:hidden">{b.oleh}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{b.qty}</TableCell>
                      <TableCell className="hidden text-muted-foreground 2xl:table-cell">{b.oleh}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

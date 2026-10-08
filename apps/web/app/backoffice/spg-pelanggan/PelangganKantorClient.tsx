"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, BellRing, Store, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { TautanTerkaitSpg } from "./TautanTerkaitSpg";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDisplayDate } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import type { PelangganKantor, RingkasPelangganToko } from "@/lib/spg/pelanggan-kantor";
import { STATUS_TITIP } from "@/lib/spg/titip";
import type { RingkasTitipToko } from "@/lib/spg/titip-kantor";
import { cn } from "@/lib/utils";
import { nadaStatusTitip } from "@/app/pwa/spg/titip/tampilan";

type PerToko = { toko: { id: string; name: string; code: string } | null; baris: PelangganKantor[]; total: number };

/**
 * Pelanggan & titip pesan SPG di kantor. Nomor HP pembeli selalu disamarkan —
 * yang menghubungi pembeli adalah SPG tokonya, dari HP-nya.
 */
export function PelangganKantorClient({
  tab,
  ringkas,
  titip,
  perToko,
}: {
  tab: "pelanggan" | "titip";
  ringkas: RingkasPelangganToko[];
  titip: RingkasTitipToko[];
  perToko: PerToko | null;
}) {
  const t = useTranslations("spgPelanggan.kantor");
  const tt = useTranslations("spgTitip");
  const ttd = dinamis(tt);
  const locale = useLocale();
  const router = useRouter();
  const tgl = (iso: string | null) => (iso ? formatDisplayDate(iso, locale) : "—");

  const totalPelanggan = ringkas.reduce((n, r) => n + r.jumlahPelanggan, 0);
  const totalTerbuka = titip.reduce((n, r) => n + r.terbuka, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judulMenu")}
        meta={tab === "pelanggan" ? t("ringkasPelanggan", { toko: ringkas.length, n: totalPelanggan }) : t("ringkasTitip", { toko: titip.length, n: totalTerbuka })}
        actions={<TautanTerkaitSpg kecuali="titip" />}
      />

      <Tabs value={tab} onValueChange={(v) => router.replace(v === "titip" ? "/backoffice/spg-pelanggan?tab=titip" : "/backoffice/spg-pelanggan")}>
        <TabsList>
          <TabsTrigger value="pelanggan">{t("tabPelanggan")}</TabsTrigger>
          <TabsTrigger value="titip">{t("tabTitip")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "pelanggan" && perToko?.toko ? (
        <Card>
          <CardHeader>
            <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit">
              <Link href="/backoffice/spg-pelanggan" replace>
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {t("semuaToko")}
              </Link>
            </Button>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {t("pelangganToko", { toko: perToko.toko.name })}
            </CardTitle>
          </CardHeader>
          <CardContent className={perToko.baris.length === 0 ? undefined : "px-0"}>
            {perToko.baris.length === 0 ? (
              <EmptyState icon={Users} title={t("kosongTokoJudul")} description={t("kosongTokoIsi")} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("kolom.nama")}</TableHead>
                      <TableHead>{t("kolom.hp")}</TableHead>
                      <TableHead>{t("kolom.dicatat")}</TableHead>
                      <TableHead className="text-right">{t("kolom.nota")}</TableHead>
                      <TableHead>{t("kolom.belanjaTerakhir")}</TableHead>
                      <TableHead className="text-right">{t("kolom.totalBelanja")}</TableHead>
                      <TableHead className="text-right">{t("kolom.titipTerbuka")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {perToko.baris.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="min-w-[10rem] whitespace-normal font-medium">{p.nama}</TableCell>
                        <TableCell className="tabular-nums">{p.hpSamar}</TableCell>
                        <TableCell>{tgl(p.dicatat)}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.jumlahNota}</TableCell>
                        <TableCell>{tgl(p.belanjaTerakhir)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatIDR(p.totalBelanja)}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.titipTerbuka}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {perToko.total > perToko.baris.length ? (
              <p className="px-6 pt-3 text-xs text-muted-foreground">{t("terpotong", { tampil: perToko.baris.length, total: perToko.total })}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : tab === "pelanggan" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Store className="h-5 w-5" />
              {t("perTokoJudul")}
            </CardTitle>
          </CardHeader>
          <CardContent className={ringkas.length === 0 ? undefined : "px-0"}>
            {ringkas.length === 0 ? (
              <EmptyState icon={Users} title={t("kosongJudul")} description={t("kosongIsi")} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("kolom.toko")}</TableHead>
                      <TableHead className="text-right">{t("kolom.pelanggan")}</TableHead>
                      <TableHead className="text-right">{t("kolom.nota")}</TableHead>
                      <TableHead>{t("kolom.belanjaTerakhir")}</TableHead>
                      <TableHead className="text-right">{t("kolom.totalBelanja")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ringkas.map((r) => (
                      <TableRow key={r.storeId}>
                        <TableCell className="min-w-[12rem] whitespace-normal">
                          <Link
                            href={`/backoffice/spg-pelanggan?toko=${r.storeId}`}
                            className="font-medium underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
                          >
                            {r.toko}
                          </Link>
                          {r.kode ? <span className="block text-xs text-muted-foreground">{r.kode}</span> : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.jumlahPelanggan}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.jumlahNota}</TableCell>
                        <TableCell>{tgl(r.belanjaTerakhir)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatIDR(r.totalBelanja)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellRing className="h-5 w-5" />
              {t("titipJudul")}
            </CardTitle>
          </CardHeader>
          <CardContent className={titip.length === 0 ? undefined : "px-0"}>
            {titip.length === 0 ? (
              <EmptyState icon={BellRing} title={t("titipKosongJudul")} description={t("titipKosongIsi")} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("kolom.toko")}</TableHead>
                      {STATUS_TITIP.map((s) => (
                        <TableHead key={s} className="text-right">
                          {ttd(`status.${s}`)}
                        </TableHead>
                      ))}
                      <TableHead>{t("kolom.menungguTertua")}</TableHead>
                      <TableHead>{t("kolom.palingSering")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {titip.map((r) => (
                      <TableRow key={r.storeId} className={cn(r.perStatus.TERSEDIA > 0 && "bg-amber-500/[0.05]")}>
                        <TableCell className="min-w-[12rem] whitespace-normal">
                          <span className="font-medium">{r.toko}</span>
                          {r.kode ? <span className="block text-xs text-muted-foreground">{r.kode}</span> : null}
                        </TableCell>
                        {STATUS_TITIP.map((s) => (
                          <TableCell key={s} className="text-right tabular-nums">
                            {r.perStatus[s] > 0 ? (
                              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", nadaStatusTitip(s))}>{r.perStatus[s]}</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                        ))}
                        <TableCell>{tgl(r.menungguTertua)}</TableCell>
                        <TableCell className="min-w-[12rem] whitespace-normal">
                          {r.palingSering ? (
                            <>
                              <span>{r.palingSering.label}</span>
                              <span className="block text-xs text-muted-foreground">
                                {r.palingSering.katalog ? t("palingSeringKatalog", { n: r.palingSering.jumlah }) : t("palingSeringBebas", { n: r.palingSering.jumlah })}
                              </span>
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

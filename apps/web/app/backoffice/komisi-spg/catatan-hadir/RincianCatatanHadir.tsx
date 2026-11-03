"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Scale, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dinamis } from "@/lib/i18n/dinamis";
import type { RincianCatatanHadir as DataRincian } from "@/lib/spg/absen-catatan-hadir-queries";
import { cn } from "@/lib/utils";

/**
 * Bandingan pemeriksa catatan check-in toko (B14, P61/P61a): setiap hari masa kerja SPG — isi
 * catatan di samping sel jadwal, check-in sistem pertama di tokonya (dengan tanda di luar radius,
 * P70), dan izin yang disetujui. Baris yang catatannya menyimpang dari jadwal atau check-in sistem
 * ditandai; hanya membaca — keputusan tetap tombol Periksa / Kembalikan di daftar.
 */
export function RincianCatatanHadir({ data, tutupHref }: { data: DataRincian; tutupHref: string }) {
  const t = useTranslations("komisiSpg.catatanHadir");
  const td = dinamis(t);
  const beda = data.hari.filter((h) => h.beda).length;
  const luar = data.hari.filter((h) => h.checkin?.luarRadius).length;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" aria-hidden />
              {t("banding.judul", { nama: data.nama, bulan: data.label })}
            </CardTitle>
            <CardDescription>
              {t("banding.isi", { toko: data.namaToko })}
              {data.statusJadwal ? ` ${t("banding.statusJadwal", { status: td(`banding.jadwalStatus.${data.statusJadwal}`) })}` : ` ${t("banding.tanpaJadwal")}`}
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" asChild aria-label={t("tutup")}>
            <Link href={tutupHref}>
              <X className="h-4 w-4" />
            </Link>
          </Button>
        </div>
        {beda > 0 || luar > 0 ? (
          <p className="text-sm text-amber-800 dark:text-amber-300">
            {beda > 0 ? t("banding.beda", { n: beda }) : null}
            {beda > 0 && luar > 0 ? " " : null}
            {luar > 0 ? t("banding.luarRadius", { n: luar }) : null}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="px-0">
        {data.hari.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">{t("banding.tanpaMasa")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("banding.kolom.hari")}</TableHead>
                  <TableHead>{t("banding.kolom.catatan")}</TableHead>
                  <TableHead>{t("banding.kolom.jadwal")}</TableHead>
                  <TableHead>{t("banding.kolom.checkin")}</TableHead>
                  <TableHead>{t("banding.kolom.izin")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.hari.map((h) => (
                  <TableRow key={h.day} className={cn(h.beda && "bg-amber-500/10")}>
                    <TableCell className="whitespace-nowrap">{h.label}</TableCell>
                    <TableCell className="min-w-[10rem] whitespace-normal">
                      {h.catatan ? (
                        <>
                          {h.catatan.kind === "KERJA" ? t("kerja") : t("libur")} · {h.catatan.present ? t("hadirYa") : t("hadirTidak")}
                          {h.catatan.note ? <span className="block text-xs text-muted-foreground">{h.catatan.note}</span> : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {h.jadwal ? (h.jadwal.kind === "KERJA" ? `${t("kerja")}${h.jadwal.kode ? ` (${h.jadwal.kode})` : ""}` : t("libur")) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {h.checkin ? (
                        <span className="inline-flex flex-wrap items-center gap-1">
                          {h.checkin.jam}
                          {h.checkin.jumlah > 1 ? <span className="text-xs text-muted-foreground">{t("banding.kali", { n: h.checkin.jumlah })}</span> : null}
                          {h.checkin.luarRadius ? <Badge variant="outline">{t("banding.luar")}</Badge> : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t("banding.tanpaCheckin")}</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{h.izin ? td(`banding.izin.${h.izin}`) : <span className="text-muted-foreground">—</span>}</TableCell>
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

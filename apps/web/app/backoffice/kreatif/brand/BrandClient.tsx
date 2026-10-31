"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Search, Tag, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LencanaBrand } from "@/components/kreatif/LencanaBrand";
import { angkaTitik } from "@/lib/creative/angka-konten";
import { alamatBrand, SARING_BRAND, type ParamBrand, type SaringBrand } from "@/lib/creative/brand-param";
import type { HasilDirektoriBrand, HasilKolBrand } from "@/lib/creative/brand-queries";
import { formatDisplayDate } from "@/lib/date-only";
import { cn } from "@/lib/utils";

const RUTE_KOL = (id: string) => `/backoffice/kreatif/kol/${id}?tab=brand`;

/**
 * Kreatif → Brand. Tanpa `?brand=`: direktori brand yang pernah ditandai KOL
 * (jumlah KOL, jumlah posting, posting terakhir). Dengan `?brand=`: KOL-KOL
 * yang menandai brand itu, masing-masing menaut ke tab Brand profilnya.
 * Penjelasannya di Bantuan.
 */
export function BrandClient({ param, direktori, rincian }: { param: ParamBrand; direktori?: HasilDirektoriBrand; rincian?: HasilKolBrand }) {
  const t = useTranslations("kreatifRuang");
  const router = useRouter();
  const [memuat, startMuat] = useTransition();
  const pergi = (ubah: Partial<ParamBrand>) => {
    const baru = { ...param, ...ubah };
    if (ubah.halaman === undefined) baru.halaman = 1;
    startMuat(() => router.replace(alamatBrand(baru), { scroll: false }));
  };

  if (rincian) {
    const b = rincian.brand;
    return (
      <div className="space-y-6">
        <Link href={alamatBrand({ cari: param.cari, saring: param.saring })} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {t("brand.direktori.kembali")}
        </Link>
        <PageHeader
          title={
            <span className="inline-flex flex-wrap items-center gap-2">
              @{b.brandHandle}
              <LencanaBrand label={b.label} />
            </span>
          }
          meta={[b.nama, t("brand.direktori.metaBrand", { kol: angkaTitik(rincian.total), posting: angkaTitik(b.posting) })].filter(Boolean).join(" · ")}
        />
        <div className={cn("transition-opacity", memuat && "opacity-60")} aria-busy={memuat}>
          <Card className="py-0">
            <CardContent className={cn("px-0", rincian.baris.length === 0 && "p-0")}>
              {rincian.baris.length === 0 ? (
                <EmptyState icon={Users} title={t("brand.direktori.kolKosong")} />
              ) : (
                <TabelKol rincian={rincian} />
              )}
              {rincian.total > rincian.perHalaman ? (
                <div className="border-t px-4 pb-4">
                  <Pagination
                    page={rincian.halaman}
                    totalPages={Math.max(1, Math.ceil(rincian.total / rincian.perHalaman))}
                    onPageChange={(halaman) => pergi({ halaman })}
                    totalCount={rincian.total}
                    pageSize={rincian.perHalaman}
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return <Direktori param={param} data={direktori!} pergi={pergi} memuat={memuat} />;
}

function Direktori({
  param,
  data,
  pergi,
  memuat,
}: {
  param: ParamBrand;
  data: HasilDirektoriBrand;
  pergi: (ubah: Partial<ParamBrand>) => void;
  memuat: boolean;
}) {
  const t = useTranslations("kreatifRuang");
  const locale = useLocale();
  const router = useRouter();
  const [cari, setCari] = useState(param.cari);
  const jeda = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (jeda.current) clearTimeout(jeda.current);
    },
    [],
  );
  const ketik = (v: string) => {
    setCari(v);
    if (jeda.current) clearTimeout(jeda.current);
    jeda.current = setTimeout(() => {
      if (v.trim() !== param.cari) pergi({ cari: v.trim() });
    }, 400);
  };
  const disaring = Boolean(param.cari || param.saring !== "semua");
  const buka = (brand: string) => router.push(alamatBrand({ brand, cari: param.cari, saring: param.saring }));

  return (
    <div className="space-y-6">
      <PageHeader title={t("halaman.brand")} meta={t("brand.direktori.meta", { n: angkaTitik(data.total) })} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative w-full lg:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={cari} onChange={(e) => ketik(e.target.value)} placeholder={t("brand.direktori.cari")} aria-label={t("brand.direktori.cari")} className="pl-9" />
        </div>
        <Select value={param.saring} onValueChange={(v) => pergi({ saring: v as SaringBrand })}>
          <SelectTrigger className="w-full lg:w-[200px]" aria-label={t("brand.direktori.saring.label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SARING_BRAND.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`brand.direktori.saring.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className={cn("transition-opacity", memuat && "opacity-60")} aria-busy={memuat}>
        <Card className="py-0">
          <CardContent className={cn("px-0", data.baris.length === 0 && "p-0")}>
            {data.baris.length === 0 ? (
              <EmptyState
                icon={Tag}
                title={disaring ? t("brand.direktori.kosongSaring") : t("brand.direktori.kosong")}
                description={disaring ? undefined : t("brand.direktori.kosongIsi")}
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">{t("brand.kolom.brand")}</TableHead>
                      <TableHead className="text-right">{t("brand.kolom.jumlahKol")}</TableHead>
                      <TableHead className="text-right">{t("brand.kolom.jumlahPosting")}</TableHead>
                      <TableHead className="pr-4">{t("brand.kolom.terakhir")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="baris-berurutan">
                    {data.baris.map((b) => (
                      <TableRow
                        key={b.brandHandle}
                        className="cursor-pointer"
                        tabIndex={0}
                        aria-label={t("brand.direktori.bukaBrand", { brand: b.brandHandle })}
                        onClick={() => buka(b.brandHandle)}
                        onKeyDown={(e) => {
                          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                            e.preventDefault();
                            buka(b.brandHandle);
                          }
                        }}
                      >
                        <TableCell className="whitespace-normal pl-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Link
                              href={alamatBrand({ brand: b.brandHandle, cari: param.cari, saring: param.saring })}
                              className="font-medium hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              @{b.brandHandle}
                            </Link>
                            <LencanaBrand label={b.label} />
                          </div>
                          {b.nama ? <p className="text-xs text-muted-foreground">{b.nama}</p> : null}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{angkaTitik(b.kol)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{angkaTitik(b.posting)}</TableCell>
                        <TableCell className="pr-4 text-sm tabular-nums">{b.terakhir ? formatDisplayDate(b.terakhir, locale) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {data.total > data.perHalaman ? (
              <div className="border-t px-4 pb-4">
                <Pagination
                  page={data.halaman}
                  totalPages={Math.max(1, Math.ceil(data.total / data.perHalaman))}
                  onPageChange={(halaman) => pergi({ halaman })}
                  totalCount={data.total}
                  pageSize={data.perHalaman}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TabelKol({ rincian }: { rincian: HasilKolBrand }) {
  const t = useTranslations("kreatifRuang");
  const locale = useLocale();
  const router = useRouter();
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">{t("brand.kolom.kol")}</TableHead>
            <TableHead className="text-right">{t("brand.kolom.jumlahPosting")}</TableHead>
            <TableHead className="text-right">{t("brand.kolom.berbayar")}</TableHead>
            <TableHead className="text-right">{t("brand.kolom.kolaborasi")}</TableHead>
            <TableHead className="text-right">{t("brand.kolom.tag")}</TableHead>
            <TableHead className="text-right">{t("brand.kolom.views")}</TableHead>
            <TableHead className="pr-4">{t("brand.kolom.terakhir")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="baris-berurutan">
          {rincian.baris.map((k) => (
            <TableRow
              key={k.kolId}
              className="cursor-pointer"
              tabIndex={0}
              aria-label={t("brand.direktori.bukaKol", { nama: k.nama })}
              onClick={() => router.push(RUTE_KOL(k.kolId))}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  router.push(RUTE_KOL(k.kolId));
                }
              }}
            >
              <TableCell className="whitespace-normal pl-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link href={RUTE_KOL(k.kolId)} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                    {k.nama}
                  </Link>
                  {k.diblokir ? (
                    <Badge variant="destructive" className="h-5 px-1.5 text-[11px]">
                      {t("brand.direktori.diblokir")}
                    </Badge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="text-right text-sm font-medium tabular-nums">{angkaTitik(k.posting)}</TableCell>
              <TableCell className="text-right text-sm tabular-nums">{angkaTitik(k.berbayar)}</TableCell>
              <TableCell className="text-right text-sm tabular-nums">{angkaTitik(k.kolaborasi)}</TableCell>
              <TableCell className="text-right text-sm tabular-nums">{angkaTitik(k.tag)}</TableCell>
              <TableCell className="text-right text-sm tabular-nums">{angkaTitik(k.views)}</TableCell>
              <TableCell className="pr-4 text-sm tabular-nums">{k.terakhir ? formatDisplayDate(k.terakhir, locale) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

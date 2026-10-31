"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClock, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KEADAAN_INDEN, rentangKirim, rentangTanggal, type KeadaanInden } from "@/lib/field-sales/inden";
import type { BarisDaftarInden } from "@/lib/field-sales/inden-queries";
import { cn } from "@/lib/utils";
import { LencanaKeadaan } from "./LencanaKeadaan";

export function IndenPageClient({
  baris,
  keadaan,
  q,
  canManage,
}: {
  baris: BarisDaftarInden[];
  keadaan: KeadaanInden | "ALL";
  q: string;
  canManage: boolean;
}) {
  const t = useTranslations("inden");
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();
  const [cari, setCari] = useState(q);

  function pushParam(key: string, value: string | undefined) {
    const params = new URLSearchParams(sp.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    const qs = params.toString();
    startTransition(() => router.push(`/backoffice/inden${qs ? `?${qs}` : ""}`));
  }

  useEffect(() => {
    const h = setTimeout(() => {
      if (cari !== q) pushParam("q", cari.trim() || undefined);
    }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cari]);

  const adaSaringan = keadaan !== "ALL" || q !== "";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/backoffice/inden/baru">
                <Plus className="mr-2 h-4 w-4" />
                {t("buat")}
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input placeholder={t("cari")} value={cari} onChange={(e) => setCari(e.target.value)} className="pl-9" aria-label={t("cari")} />
        </div>
        <Select value={keadaan} onValueChange={(v) => pushParam("keadaan", v === "ALL" ? undefined : v)}>
          <SelectTrigger className="w-full sm:w-[200px]" aria-label={t("saringKeadaan")}>
            <SelectValue placeholder={t("semuaKeadaan")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("semuaKeadaan")}</SelectItem>
            {KEADAAN_INDEN.map((k) => (
              <SelectItem key={k} value={k}>
                {t(`keadaan.${k}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" aria-hidden />
            {t("daftarJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {baris.length === 0 ? (
            adaSaringan ? (
              <EmptyState icon={CalendarClock} title={t("kosongSaringJudul")} description={t("kosongSaringIsi")} />
            ) : (
              <EmptyState
                icon={CalendarClock}
                title={t("kosongJudul")}
                description={t("kosongIsi")}
                action={
                  canManage ? (
                    <Button asChild variant="outline">
                      <Link href="/backoffice/inden/baru">{t("buat")}</Link>
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolom.nama")}</TableHead>
                    <TableHead>{t("kolom.keadaan")}</TableHead>
                    <TableHead>{t("kolom.periode")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("kolom.kirim")}</TableHead>
                    <TableHead className="text-right">{t("kolom.barang")}</TableHead>
                    <TableHead className="text-right">{t("kolom.dipesanRencana")}</TableHead>
                    <TableHead className="text-right">{t("kolom.pesanan")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => {
                    const kirim = rentangKirim(b.shipFrom, b.shipTo, locale);
                    const lebih = b.rencana !== null && b.dipesan > b.rencana;
                    return (
                      <TableRow
                        key={b.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => startTransition(() => router.push(`/backoffice/inden/${b.id}`))}
                      >
                        <TableCell className="min-w-[10rem] max-w-[16rem] whitespace-normal font-medium">
                          <Link href={`/backoffice/inden/${b.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                            {b.name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <LencanaKeadaan keadaan={b.keadaan} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {rentangTanggal(b.opensAt, b.closesAt, locale)}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-sm 2xl:table-cell">
                          {kirim ? t(`kirim.${kirim.jenis}`, { teks: kirim.teks }) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{b.jumlahBarang}</TableCell>
                        <TableCell className={cn("text-right tabular-nums", lebih && "text-amber-700 dark:text-amber-400")}>
                          {b.dipesan.toLocaleString("id-ID")}
                          <span className="text-muted-foreground"> / {b.rencana === null ? "—" : b.rencana.toLocaleString("id-ID")}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.jumlahPesanan}
                          {b.menungguPersetujuan > 0 && (
                            <div className="text-xs text-muted-foreground">{t("menungguN", { n: b.menungguPersetujuan })}</div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

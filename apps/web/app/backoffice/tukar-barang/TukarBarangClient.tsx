"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dinamis } from "@/lib/i18n/dinamis";
import { STATUS_TUKAR, type StatusTukar } from "@/lib/salesman/tukar-barang";
import type { DaftarTukarKantor } from "@/lib/salesman/tukar-queries";
import { cn } from "@/lib/utils";
import { nadaStatusTukar } from "@/app/pwa/tukar/tampilan";

const SEMUA = "__semua__";

export function TukarBarangClient({
  status,
  salesmanId,
  cari,
  salesman,
  data,
}: {
  status: StatusTukar | null;
  salesmanId: string | null;
  cari: string | null;
  salesman: { id: string; nama: string }[];
  data: DaftarTukarKantor;
}) {
  const t = useTranslations("tukarBarang");
  const td = dinamis(t);
  const router = useRouter();
  const [teks, setTeks] = useState(cari ?? "");

  const pindah = (ubah: { status?: string | null; salesman?: string | null; q?: string | null }) => {
    const q = new URLSearchParams();
    const s = ubah.status !== undefined ? ubah.status : status;
    const m = ubah.salesman !== undefined ? ubah.salesman : salesmanId;
    const c = ubah.q !== undefined ? ubah.q : cari;
    if (s) q.set("status", s);
    if (m) q.set("salesman", m);
    if (c) q.set("q", c);
    const qs = q.toString();
    router.push(qs ? `/backoffice/tukar-barang?${qs}` : "/backoffice/tukar-barang");
  };

  const disaring = status !== null || salesmanId !== null || cari !== null;
  const menunggu = data.perStatus.DIAJUKAN + data.perStatus.DISETUJUI;

  return (
    <div className="space-y-6">
      <PageHeader title={t("judul")} meta={t("ringkasMeta", { n: data.total, menunggu })} />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <form
          className="flex w-full gap-2 sm:w-80"
          onSubmit={(e) => {
            e.preventDefault();
            pindah({ q: teks.trim() || null });
          }}
        >
          <Input
            type="search"
            value={teks}
            onChange={(e) => setTeks(e.target.value)}
            placeholder={t("cari")}
            aria-label={t("cari")}
          />
          <Button type="submit" variant="outline" size="icon" aria-label={t("cari")}>
            <Search className="h-4 w-4" />
          </Button>
        </form>
        <Select value={status ?? SEMUA} onValueChange={(v) => pindah({ status: v === SEMUA ? null : v })}>
          <SelectTrigger className="w-full sm:w-44" aria-label={t("saringStatus")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("semuaStatus")}</SelectItem>
            {STATUS_TUKAR.map((s) => (
              <SelectItem key={s} value={s}>
                {td(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={salesmanId ?? SEMUA} onValueChange={(v) => pindah({ salesman: v === SEMUA ? null : v })}>
          <SelectTrigger className="w-full sm:w-56" aria-label={t("saringSalesman")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("semuaSalesman")}</SelectItem>
            {salesman.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.nama}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {STATUS_TUKAR.map((s) => (
          <Button
            key={s}
            variant="outline"
            aria-pressed={status === s}
            onClick={() => pindah({ status: status === s ? null : s })}
            className={cn(
              "h-auto flex-col items-start gap-0.5 whitespace-normal px-4 py-3 text-left",
              status === s && "border-primary ring-1 ring-primary",
            )}
          >
            <span className="text-xs font-normal text-muted-foreground">{td(`status.${s}`)}</span>
            <span className="text-lg font-semibold tabular-nums">{data.perStatus[s]}</span>
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5" />
            {t("daftarJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent className={data.baris.length === 0 ? undefined : "px-0"}>
          {data.baris.length === 0 ? (
            <EmptyState
              icon={ArrowLeftRight}
              title={disaring ? t("kosongSaringJudul") : t("kosongJudul")}
              description={disaring ? t("kosongSaringIsi") : t("kosongIsi")}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolom.nomor")}</TableHead>
                    <TableHead>{t("kolom.toko")}</TableHead>
                    <TableHead>{t("kolom.salesman")}</TableHead>
                    <TableHead className="text-right">{t("kolom.masuk")}</TableHead>
                    <TableHead className="text-right">{t("kolom.keluar")}</TableHead>
                    <TableHead>{t("kolom.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.baris.map((b) => (
                    <TableRow key={b.id} className={cn(b.status === "DIAJUKAN" && "bg-amber-500/[0.05]")}>
                      <TableCell>
                        <Link
                          href={`/backoffice/tukar-barang/${b.id}`}
                          className="font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {b.docNo}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{b.dibuat}</span>
                      </TableCell>
                      <TableCell className="min-w-[12rem] whitespace-normal">
                        <span className="block font-medium">{b.toko}</span>
                        <span className="block text-xs text-muted-foreground">{b.tokoKode}</span>
                      </TableCell>
                      <TableCell className="min-w-[9rem] whitespace-normal">{b.salesman}</TableCell>
                      <TableCell className="text-right tabular-nums">{t("pcs", { n: b.pcsMasuk })}</TableCell>
                      <TableCell className="text-right tabular-nums">{t("pcs", { n: b.pcsKeluar })}</TableCell>
                      <TableCell className="min-w-[9rem] whitespace-normal">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", nadaStatusTukar(b.status))}>
                          {td(`status.${b.status}`)}
                        </span>
                        {b.catatanKeputusan && (b.status === "DITOLAK" || b.status === "DIBATALKAN") ? (
                          <span className="mt-1 block text-xs text-destructive">{b.catatanKeputusan}</span>
                        ) : null}
                      </TableCell>
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

"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, ClipboardCheck, Store, TrendingDown, TrendingUp } from "lucide-react";
import type { LaporanChecklist } from "@/lib/salesman/checklist-queries";
import { dinamis } from "@/lib/i18n/dinamis";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";

type Pilihan = { id: string; label: string };
const SEMUA = "SEMUA";

/** Ambang warna skor — hanya tampilan; laporan tetap mengurutkan dari angka mentah. */
export function varianSkor(persen: number | null): "default" | "secondary" | "destructive" | "outline" {
  if (persen === null) return "outline";
  if (persen >= 80) return "default";
  if (persen >= 60) return "secondary";
  return "destructive";
}

export function LaporanChecklistClient({
  data,
  saring,
  pilihan,
}: {
  data: LaporanChecklist;
  saring: { dari: string; sampai: string; area: string | null; salesman: string | null; template: string | null };
  pilihan: { area: Pilihan[]; salesman: Pilihan[]; template: Pilihan[] };
}) {
  const t = useTranslations("checklistToko.laporan");
  const tt = useTranslations("tanggalInput");
  const tj = dinamis(useTranslations("checklistToko"));
  const router = useRouter();
  const [, mulai] = useTransition();

  const dorong = (ubah: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const semua = { dari: saring.dari, sampai: saring.sampai, area: saring.area, salesman: saring.salesman, template: saring.template, ...ubah };
    for (const [k, v] of Object.entries(semua)) if (v) p.set(k, v);
    mulai(() => router.push(`/backoffice/checklist-toko/laporan?${p.toString()}`));
  };

  const pilih = (kunci: string, nilai: string | null, daftar: Pilihan[], labelSemua: string, id: string) => (
    <div className="w-full space-y-1 sm:w-52">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {t(`saring.${kunci}`)}
      </Label>
      <Select value={nilai ?? SEMUA} onValueChange={(v) => dorong({ [kunci]: v === SEMUA ? null : v })}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SEMUA}>{labelSemua}</SelectItem>
          {daftar.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              {d.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/backoffice/checklist-toko">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t("kembali")}
          </Link>
        </Button>
      </div>

      <PageHeader
        title={t("judul")}
        description={t("deskripsi")}
        meta={t("ringkas", { hasil: data.jumlahHasil, toko: new Set(data.baris.map((b) => b.storeId)).size, rata: data.rataRata ?? "—" })}
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full space-y-1 sm:w-64">
            <Label htmlFor="lap-periode" className="text-xs text-muted-foreground">
              {tt("periode")}
            </Label>
            <RentangTanggalInput
              id="lap-periode" required
              dari={saring.dari}
              sampai={saring.sampai}
              onChange={({ dari, sampai }) => dorong({ dari, sampai })}
            />
          </div>
          {pilih("area", saring.area, pilihan.area, t("saring.semuaArea"), "lap-area")}
          {pilih("salesman", saring.salesman, pilihan.salesman, t("saring.semuaSalesman"), "lap-salesman")}
          {pilih("template", saring.template, pilihan.template, t("saring.semuaTemplate"), "lap-template")}
          <Button variant="outline" onClick={() => mulai(() => router.push("/backoffice/checklist-toko/laporan"))}>
            {t("saring.reset")}
          </Button>
        </div>
      </Card>

      {data.terpotong ? (
        <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t("terpotong")}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Store className="h-4 w-4" aria-hidden />
            {t("perTokoJudul")}
          </CardTitle>
          <CardDescription>{t("perTokoIsi")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.baris.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title={t("kosongJudul")} description={t("kosongIsi")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolToko")}</TableHead>
                    <TableHead>{t("kolArea")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("kolTemplate")}</TableHead>
                    <TableHead>{t("kolSkor")}</TableHead>
                    <TableHead>{t("kolTren")}</TableHead>
                    <TableHead className="text-right">{t("kolJumlah")}</TableHead>
                    <TableHead>{t("kolSalesman")}</TableHead>
                    <TableHead>{t("kolTanggal")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.baris.map((b) => {
                    const n = b.tren.length;
                    const naik = n >= 2 && b.tren[n - 1] !== null && b.tren[n - 2] !== null ? (b.tren[n - 1] as number) - (b.tren[n - 2] as number) : 0;
                    return (
                      <TableRow
                        key={`${b.storeId}-${b.templateId}`}
                        className="cursor-pointer"
                        onClick={() => mulai(() => router.push(`/backoffice/checklist-toko/laporan/${b.terakhir.id}`))}
                      >
                        <TableCell className="whitespace-normal">
                          <Link href={`/backoffice/checklist-toko/laporan/${b.terakhir.id}`} className="font-medium hover:underline">
                            {b.tokoNama}
                          </Link>
                          <span className="block text-xs text-muted-foreground">{b.tokoKode}</span>
                        </TableCell>
                        <TableCell>{b.area ?? "—"}</TableCell>
                        <TableCell className="hidden whitespace-normal 2xl:table-cell">{b.templateNama}</TableCell>
                        <TableCell>
                          <Badge variant={varianSkor(b.terakhir.persen)} className="tabular-nums">
                            {b.terakhir.persen === null ? "—" : `${b.terakhir.persen}%`}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1.5 tabular-nums text-sm">
                            {b.tren.map((p, i) => (
                              <span key={i} className={i === n - 1 ? "font-semibold" : "text-muted-foreground"}>
                                {p ?? "—"}
                                {i < n - 1 ? <span className="ml-1.5 text-muted-foreground">·</span> : null}
                              </span>
                            ))}
                            {naik > 0 ? (
                              <TrendingUp className="h-4 w-4 text-emerald-600" aria-label={t("trenNaik")} />
                            ) : naik < 0 ? (
                              <TrendingDown className="h-4 w-4 text-destructive" aria-label={t("trenTurun")} />
                            ) : null}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{b.jumlah}</TableCell>
                        <TableCell className="whitespace-normal">{b.terakhir.salesman}</TableCell>
                        <TableCell>{b.terakhir.tanggal}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            {t("lemahJudul")}
          </CardTitle>
          <CardDescription>{t("lemahIsi")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.lemah.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">{t("lemahKosong")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolPertanyaan")}</TableHead>
                    <TableHead>{t("kolJenis")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("kolTemplate")}</TableHead>
                    <TableHead>{t("kolCapaian")}</TableHead>
                    <TableHead className="text-right">{t("kolDinilai")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lemah.slice(0, 15).map((q) => (
                    <TableRow key={`${q.templateNama}-${q.id}`}>
                      <TableCell className="whitespace-normal">{q.teks}</TableCell>
                      <TableCell>{tj(`jenis.${q.jenis}`)}</TableCell>
                      <TableCell className="hidden whitespace-normal 2xl:table-cell">{q.templateNama}</TableCell>
                      <TableCell>
                        <Badge variant={varianSkor(q.persen)} className="tabular-nums">
                          {q.persen}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{q.jumlah}</TableCell>
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

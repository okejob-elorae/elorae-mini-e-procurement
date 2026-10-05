"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, Loader2, Receipt } from "lucide-react";
import { eksporBiayaExcelAction, type LabelEksporBiaya } from "@/app/actions/expense-claims";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dinamis, type TerjemahDinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import { KATEGORI_BIAYA, STATUS_BIAYA, type Jumlahan, type StatusBiaya } from "@/lib/salesman/biaya";
import type { BarisBiayaKantor } from "@/lib/salesman/biaya-queries";
import { cn } from "@/lib/utils";
import { IkonKategori, nadaStatus } from "@/app/pwa/biaya/tampilan";
import { TombolKeputusan } from "./TombolKeputusan";
import { unduhExcel } from "./unduh";

const SEMUA = "__semua__";

/** Label Excel dari bahasa layar — server tidak punya penerjemah sendiri. */
export function labelEksporBiaya(td: TerjemahDinamis): LabelEksporBiaya {
  const kolom = [
    "tanggal",
    "salesman",
    "kategori",
    "nilai",
    "catatan",
    "toko",
    "status",
    "diajukan",
    "diputuskanOleh",
    "diputuskanPada",
    "alasan",
    "dibayarOleh",
    "dibayarPada",
    "foto",
  ] as const;
  return {
    judul: td("judul"),
    kolom: Object.fromEntries(kolom.map((k) => [k, td(`kolom.${k}`)])) as LabelEksporBiaya["kolom"],
    ringkasan: td("excel.ringkasan"),
    total: td("excel.total"),
    ada: td("excel.ada"),
    kategori: Object.fromEntries(KATEGORI_BIAYA.map((k) => [k, td(`kategori.${k}`)])),
    status: Object.fromEntries(STATUS_BIAYA.map((s) => [s, td(`status.${s}`)])),
  };
}

export function BiayaPerjalananClient({
  bulan,
  status,
  salesmanId,
  pilihanBulan,
  salesman,
  data,
  bolehSetujui,
  bolehBayar,
}: {
  bulan: string;
  status: StatusBiaya | null;
  salesmanId: string | null;
  pilihanBulan: { kunci: string; label: string }[];
  salesman: { id: string; nama: string }[];
  data: { baris: BarisBiayaKantor[]; perStatus: Record<StatusBiaya, Jumlahan>; total: Jumlahan };
  bolehSetujui: boolean;
  bolehBayar: boolean;
}) {
  const t = useTranslations("biayaPerjalanan");
  const td = dinamis(t);
  const router = useRouter();
  const [mengekspor, setMengekspor] = useState(false);

  const pindah = (ubah: { bulan?: string; status?: string | null; salesman?: string | null }) => {
    const q = new URLSearchParams();
    q.set("bulan", ubah.bulan ?? bulan);
    const s = ubah.status !== undefined ? ubah.status : status;
    const m = ubah.salesman !== undefined ? ubah.salesman : salesmanId;
    if (s) q.set("status", s);
    if (m) q.set("salesman", m);
    router.push(`/backoffice/biaya-perjalanan?${q.toString()}`);
  };

  const ekspor = async () => {
    setMengekspor(true);
    try {
      const r = await eksporBiayaExcelAction({ bulan, status, salesmanId, label: labelEksporBiaya(td) });
      if (!r.ok) {
        toast.error(td(`err.${r.kode}`));
        return;
      }
      unduhExcel(r.base64, r.filename);
      toast.success(t("eksporMulai"));
    } catch {
      toast.error(t("err.GAGAL"));
    } finally {
      setMengekspor(false);
    }
  };

  const menunggu = data.perStatus.DIAJUKAN.jumlah;
  const disaring = status !== null || salesmanId !== null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={t("ringkasMeta", { n: data.total.jumlah, nilai: formatIDR(data.total.nilai), menunggu })}
        actions={
          <Button variant="outline" onClick={() => void ekspor()} disabled={mengekspor}>
            {mengekspor ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            {t("ekspor")}
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Select value={bulan} onValueChange={(v) => pindah({ bulan: v })}>
          <SelectTrigger className="w-full sm:w-48" aria-label={t("saringBulan")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pilihanBulan.map((b) => (
              <SelectItem key={b.kunci} value={b.kunci}>
                {b.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status ?? SEMUA} onValueChange={(v) => pindah({ status: v === SEMUA ? null : v })}>
          <SelectTrigger className="w-full sm:w-44" aria-label={t("saringStatus")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("semuaStatus")}</SelectItem>
            {STATUS_BIAYA.map((s) => (
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATUS_BIAYA.map((s) => (
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
            <span className="text-lg font-semibold tabular-nums">{formatIDR(data.perStatus[s].nilai)}</span>
            <span className="text-xs font-normal text-muted-foreground">{t("jumlahKlaim", { n: data.perStatus[s].jumlah })}</span>
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            {t("daftarJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent className={data.baris.length === 0 ? undefined : "px-0"}>
          {data.baris.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title={disaring ? t("kosongSaringJudul") : t("kosongJudul")}
              description={disaring ? t("kosongSaringIsi") : t("kosongIsi")}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolom.tanggal")}</TableHead>
                    <TableHead>{t("kolom.salesman")}</TableHead>
                    <TableHead>{t("kolom.kategori")}</TableHead>
                    <TableHead className="text-right">{t("kolom.nilai")}</TableHead>
                    <TableHead>{t("kolom.status")}</TableHead>
                    <TableHead>{t("kolom.foto")}</TableHead>
                    <TableHead className="sticky right-0 bg-card text-right">
                      <span className="sr-only">{t("kolom.aksi")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.baris.map((b) => {
                    const ringkas = `${td(`kategori.${b.kategori}`)} · ${formatIDR(b.nilai)} · ${b.salesman}`;
                    return (
                      <TableRow key={b.id} className={cn(b.status === "DIAJUKAN" && "bg-amber-500/[0.05]")}>
                        <TableCell>
                          <Link
                            href={`/backoffice/biaya-perjalanan/${b.id}`}
                            className="font-medium text-primary underline-offset-2 hover:underline"
                          >
                            {b.tanggal}
                          </Link>
                        </TableCell>
                        <TableCell className="min-w-[9rem] whitespace-normal">{b.salesman}</TableCell>
                        <TableCell className="min-w-[12rem] max-w-[18rem] whitespace-normal">
                          <span className="flex items-center gap-1.5 font-medium">
                            <IkonKategori kategori={b.kategori} className="h-4 w-4 text-muted-foreground" />
                            {td(`kategori.${b.kategori}`)}
                          </span>
                          {b.catatan ? <span className="block text-xs text-muted-foreground">{b.catatan}</span> : null}
                          {b.toko ? <span className="block text-xs text-muted-foreground">{t("diToko", { toko: b.toko })}</span> : null}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{formatIDR(b.nilai)}</TableCell>
                        <TableCell className="min-w-[9rem] whitespace-normal">
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", nadaStatus(b.status))}>
                            {td(`status.${b.status}`)}
                          </span>
                          {b.alasanTolak ? <span className="mt-1 block text-xs text-destructive">{b.alasanTolak}</span> : null}
                          {b.status === "DIBAYAR" && b.dibayarPada ? (
                            <span className="mt-1 block text-xs text-muted-foreground">{b.dibayarPada}</span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {b.fotoUrl ? (
                            <a href={b.fotoUrl} target="_blank" rel="noopener noreferrer" aria-label={t("lihatStruk")}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={b.fotoUrl} alt="" loading="lazy" className="h-10 w-10 rounded-md border object-cover" />
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="sticky right-0 bg-card text-right">
                          <TombolKeputusan
                            id={b.id}
                            status={b.status}
                            ringkas={ringkas}
                            bolehSetujui={bolehSetujui}
                            bolehBayar={bolehBayar}
                          />
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

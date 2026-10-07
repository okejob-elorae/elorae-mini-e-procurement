"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CheckCheck, Download, Loader2, Search, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { eksporTagihanAction } from "@/app/actions/kreatif-bayar";
import { labelTanggal } from "@/lib/tanggal-isian";
import { jumlahUang, rupiahTeks } from "@/lib/creative/angka-konten";
import { CHIP_BAYAR, nadaBayar } from "@/lib/creative/bayar-aturan";
import type { BarisBayar, HasilDaftarBayar } from "@/lib/creative/bayar-queries";
import { nadaTahap } from "@/lib/creative/kolaborasi-tampil";
import { alamatBayar, type ParamBayar } from "@/lib/creative/laporan-param";
import { cn } from "@/lib/utils";
import { TandaiDibayarDialog } from "./TandaiDibayarDialog";

type Props = {
  param: ParamBayar;
  data: HasilDaftarBayar;
  campaign: { id: string; name: string }[];
  hariIni: string;
  bolehMengelola: boolean;
};

const SEMUA_CAMPAIGN = "__semua__";

/** Unduh teks sebagai berkas (CSV ber-BOM sudah disusun di server). */
function unduh(isi: string, namaBerkas: string, jenis: string) {
  const url = URL.createObjectURL(new Blob([isi], { type: jenis }));
  const a = document.createElement("a");
  a.href = url;
  a.download = namaBerkas;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Pembayaran KOL. Seluruh saringan ada di alamat (`router.replace`, tombol
 * Kembali tidak berjalan mundur melewati setiap chip). Pilihan baris disimpan
 * di sini dan BERTAHAN lintas halaman, chip, dan pencarian — dialog "Tandai
 * dibayar" menghitung total dari SEMUA yang dipilih (perbaikan bug KOL
 * Manager yang hanya menjumlah satu halaman).
 */
export function PembayaranClient({ param, data, campaign, hariIni, bolehMengelola }: Props) {
  const t = useTranslations("kreatifRuang");
  const locale = useLocale();
  const router = useRouter();
  const [berpindah, mulaiPindah] = useTransition();
  const [mengekspor, mulaiEkspor] = useTransition();
  const [dipilih, setDipilih] = useState<Map<string, BarisBayar>>(() => new Map());
  const [dialog, setDialog] = useState(false);
  // Kunci baru setiap dialog dibuka: isiannya selalu mulai dari "Lunas, hari ini".
  const [dialogKe, setDialogKe] = useState(0);
  const [cari, setCari] = useState(param.cari);
  const cariTerakhir = useRef(param.cari);

  const pergi = (ubah: Partial<ParamBayar>) =>
    mulaiPindah(() => router.replace(alamatBayar({ ...param, ...ubah }), { scroll: false }));

  // Pencarian ditunda sebentar supaya setiap ketukan tidak memuat ulang daftar.
  useEffect(() => {
    if (cari === cariTerakhir.current) return;
    const h = window.setTimeout(() => {
      cariTerakhir.current = cari;
      mulaiPindah(() => router.replace(alamatBayar({ ...param, cari, halaman: 1 }), { scroll: false }));
    }, 350);
    return () => window.clearTimeout(h);
  }, [cari, param, router]);

  const halamanIni = data.baris;
  const semuaHalamanDipilih = halamanIni.length > 0 && halamanIni.every((b) => dipilih.has(b.id));
  const daftarDipilih = useMemo(() => [...dipilih.values()], [dipilih]);
  const feeDipilih = jumlahUang(daftarDipilih.map((b) => b.fee));

  const ubahPilih = (b: BarisBayar, ya: boolean) =>
    setDipilih((lama) => {
      const baru = new Map(lama);
      if (ya) baru.set(b.id, b);
      else baru.delete(b.id);
      return baru;
    });

  const ubahPilihHalaman = (ya: boolean) =>
    setDipilih((lama) => {
      const baru = new Map(lama);
      for (const b of halamanIni) {
        if (ya) baru.set(b.id, b);
        else baru.delete(b.id);
      }
      return baru;
    });

  const ekspor = () =>
    mulaiEkspor(async () => {
      const r = await eksporTagihanAction({ chip: param.chip, cari: param.cari, campaignId: param.campaign });
      if (!r.ok) {
        toast.error(t("pembayaran.eksporGagal"));
        return;
      }
      unduh(r.isi, r.namaBerkas, "text/csv;charset=utf-8");
      toast.success(t("pembayaran.eksporOk"));
    });

  const sesudahSimpan = () => {
    setDialog(false);
    setDipilih(new Map());
    router.refresh();
  };

  const opsiCampaign = [
    { value: SEMUA_CAMPAIGN, label: t("pembayaran.campaignSemua") },
    ...campaign.map((c) => ({ value: c.id, label: c.name })),
  ];
  const adaSaringan = Boolean(param.cari || param.campaign);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("halaman.pembayaran")}
        meta={t("pembayaran.meta", { n: data.jumlahPerChip.SEMUA })}
        actions={
          <Button variant="outline" onClick={ekspor} disabled={mengekspor}>
            {mengekspor ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            {t("pembayaran.ekspor")}
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="gap-1 py-4">
          <CardContent className="px-4">
            <p className="text-sm text-muted-foreground">{t("pembayaran.kartu.totalFee")}</p>
            <p className="text-2xl font-semibold tabular-nums">{rupiahTeks(data.ringkas.totalFee)}</p>
            <p className="text-xs text-muted-foreground">{t("pembayaran.kartu.totalFeeSub", { n: data.ringkas.jumlah })}</p>
          </CardContent>
        </Card>
        <Card className="gap-1 py-4">
          <CardContent className="px-4">
            <p className="text-sm text-muted-foreground">{t("pembayaran.kartu.dibayar")}</p>
            <p className="text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{rupiahTeks(data.ringkas.dibayar)}</p>
          </CardContent>
        </Card>
        <Card className="gap-1 py-4">
          <CardContent className="px-4">
            <p className="text-sm text-muted-foreground">{t("pembayaran.kartu.sisa")}</p>
            <p className={cn("text-2xl font-semibold tabular-nums", data.ringkas.sisa > 0 && "text-red-700 dark:text-red-400")}>
              {rupiahTeks(data.ringkas.sisa)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        {/* Tombol, bukan Tabs: daftar Tabs bertinggi tetap dan baris yang terlipat di HP menimpa isian di bawahnya. */}
        <div role="group" aria-label={t("pembayaran.chip.label")} className="flex flex-wrap gap-1.5">
          {CHIP_BAYAR.map((c) => (
            <Button
              key={c}
              type="button"
              size="sm"
              variant={param.chip === c ? "secondary" : "outline"}
              aria-pressed={param.chip === c}
              className={cn("tabular-nums", param.chip === c && "ring-1 ring-foreground/30")}
              onClick={() => pergi({ chip: c, halaman: 1 })}
            >
              {t("pembayaran.chip.jumlah", { label: t(`pembayaran.chip.${c}`), n: data.jumlahPerChip[c] })}
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder={t("pembayaran.cari")}
              aria-label={t("pembayaran.cari")}
              className="pl-9"
            />
          </div>
          <SearchableCombobox
            options={opsiCampaign}
            value={param.campaign ?? SEMUA_CAMPAIGN}
            onValueChange={(v) => pergi({ campaign: v && v !== SEMUA_CAMPAIGN ? v : null, halaman: 1 })}
            placeholder={t("pembayaran.campaignSemua")}
            searchPlaceholder={t("pembayaran.campaignCari")}
            emptyMessage={t("pembayaran.campaignKosong")}
            className="w-full sm:w-64"
          />
        </div>
      </div>

      {bolehMengelola && dipilih.size > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium tabular-nums">{t("pembayaran.dipilih", { n: dipilih.size, fee: rupiahTeks(feeDipilih) })}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDipilih(new Map())}>
              <X className="h-4 w-4" aria-hidden />
              {t("pembayaran.kosongkanPilihan")}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setDialogKe((k) => k + 1);
                setDialog(true);
              }}
            >
              <CheckCheck className="h-4 w-4" aria-hidden />
              {t("pembayaran.tandai")}
            </Button>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" aria-hidden />
            {t("pembayaran.judulDaftar")}
          </CardTitle>
        </CardHeader>
        <CardContent className={cn(berpindah && "opacity-60 transition-opacity")}>
          {halamanIni.length === 0 ? (
            adaSaringan ? (
              <EmptyState
                icon={Search}
                title={t("pembayaran.kosong.cariJudul")}
                description={t("pembayaran.kosong.cariIsi")}
                action={
                  <Button
                    variant="outline"
                    onClick={() => {
                      cariTerakhir.current = "";
                      setCari("");
                      pergi({ cari: "", campaign: null, halaman: 1 });
                    }}
                  >
                    {t("pembayaran.kosong.hapusSaringan")}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Wallet}
                title={param.chip === "BELUM" ? t("pembayaran.kosong.belumJudul") : t("pembayaran.kosong.judul")}
                description={param.chip === "BELUM" || param.chip === "SEMUA" ? t("pembayaran.kosong.belumIsi") : undefined}
                action={
                  param.chip !== "SEMUA" && data.jumlahPerChip.SEMUA > 0 ? (
                    <Button variant="outline" onClick={() => pergi({ chip: "SEMUA", halaman: 1 })}>
                      {t("pembayaran.kosong.lihatSemua", { n: data.jumlahPerChip.SEMUA })}
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {bolehMengelola ? (
                        <TableHead className="w-10">
                          <Checkbox
                            checked={semuaHalamanDipilih}
                            onCheckedChange={(v) => ubahPilihHalaman(v === true)}
                            aria-label={t("pembayaran.pilihHalaman")}
                          />
                        </TableHead>
                      ) : null}
                      <TableHead className="min-w-[160px]">{t("pembayaran.kolom.kol")}</TableHead>
                      <TableHead className="hidden xl:table-cell">{t("pembayaran.kolom.campaign")}</TableHead>
                      <TableHead>{t("pembayaran.kolom.tahap")}</TableHead>
                      <TableHead className="text-right">{t("pembayaran.kolom.fee")}</TableHead>
                      <TableHead className="text-right">{t("pembayaran.kolom.sisa")}</TableHead>
                      <TableHead>{t("pembayaran.kolom.status")}</TableHead>
                      <TableHead>{t("pembayaran.kolom.jatuhTempo")}</TableHead>
                      <TableHead className="text-right">
                        <span className="sr-only">{t("pembayaran.kolom.aksi")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="baris-berurutan">
                    {halamanIni.map((b) => (
                      <TableRow key={b.id} data-state={dipilih.has(b.id) ? "selected" : undefined}>
                        {bolehMengelola ? (
                          <TableCell>
                            <Checkbox
                              checked={dipilih.has(b.id)}
                              onCheckedChange={(v) => ubahPilih(b, v === true)}
                              aria-label={t("pembayaran.pilihBaris", { nama: b.handle ? `@${b.handle}` : b.kolNama })}
                            />
                          </TableCell>
                        ) : null}
                        <TableCell className="whitespace-normal">
                          <p className="font-medium">{b.handle ? `@${b.handle}` : b.kolNama}</p>
                          <p className="text-xs text-muted-foreground">
                            {b.handle ? b.kolNama : b.docNo}
                            <span className="xl:hidden">{b.campaignNama ? ` · ${b.campaignNama}` : ""}</span>
                          </p>
                        </TableCell>
                        <TableCell className="hidden whitespace-normal xl:table-cell">{b.campaignNama ?? "—"}</TableCell>
                        <TableCell>
                          <StatusPill tone={nadaTahap(b.tahap)}>{t(`tahap.${b.tahap}`)}</StatusPill>
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{rupiahTeks(b.fee)}</TableCell>
                        <TableCell className={cn("text-right tabular-nums", b.sisa > 0 ? "font-medium text-red-700 dark:text-red-400" : "text-muted-foreground")}>
                          {b.sisa > 0 ? rupiahTeks(b.sisa) : "—"}
                        </TableCell>
                        <TableCell>
                          <StatusPill
                            tone={nadaBayar(b.payStatus)}
                            detail={b.paidAt ? <span className="text-xs text-muted-foreground">{labelTanggal(b.paidAt, locale)}</span> : undefined}
                          >
                            {t(`bayar.${b.payStatus}`)}
                          </StatusPill>
                        </TableCell>
                        <TableCell>
                          {b.jatuhTempo ? (
                            <div className={cn("text-sm tabular-nums", b.jatuhTempo.lewat && "font-medium text-red-700 dark:text-red-400")}>
                              <p>{labelTanggal(b.jatuhTempo.tanggal, locale)}</p>
                              {b.jatuhTempo.lewat ? (
                                <p className="text-xs">{t("pembayaran.lewatHari", { n: b.jatuhTempo.lewatHari })}</p>
                              ) : b.jatuhTempo.tanggal === hariIni ? (
                                <p className="text-xs text-muted-foreground">{t("pembayaran.jatuhHariIni")}</p>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">{b.payStatus === "LUNAS" ? "—" : t("pembayaran.belumTayang")}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/backoffice/kreatif/kolaborasi/${b.id}`} aria-label={t("pembayaran.bukaAria", { docNo: b.docNo })}>
                              {t("pembayaran.buka")}
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Pagination
                page={param.halaman}
                totalPages={Math.max(1, Math.ceil(data.total / data.perHalaman))}
                onPageChange={(halaman) => pergi({ halaman })}
                totalCount={data.total}
                pageSize={data.perHalaman}
              />
            </>
          )}
        </CardContent>
      </Card>

      {bolehMengelola ? (
        <TandaiDibayarDialog key={dialogKe} open={dialog} onOpenChange={setDialog} dipilih={daftarDipilih} hariIni={hariIni} onSelesai={sesudahSimpan} />
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Banknote, Download, ImageIcon, Loader2, Search, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { DialogBayarTermin } from "@/components/kreatif/DialogBayarTermin";
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
import { eksporTerminAction } from "@/app/actions/kreatif-termin";
import { labelTanggal } from "@/lib/tanggal-isian";
import { jumlahUang, rupiahTeks } from "@/lib/creative/angka-konten";
import type { BarisTermin, HasilDaftarTermin } from "@/lib/creative/termin-queries";
import { alamatTermin, CHIP_TERMIN, type ParamTermin } from "@/lib/creative/termin-param";
import { cn } from "@/lib/utils";

type Props = {
  param: ParamTermin;
  data: HasilDaftarTermin;
  campaign: { id: string; name: string }[];
  kolaborasiDocNo: string | null;
  hariIni: string;
  bolehMengelola: boolean;
};

const SEMUA_CAMPAIGN = "__semua__";
const nama = (b: BarisTermin) => (b.handle ? `@${b.handle}` : b.kolNama);

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
 * Pembayaran KOL per TERMIN. Saringan di alamat (`router.replace`). Pilihan
 * baris bertahan lintas halaman, chip, dan pencarian; "Bayar yang dipilih"
 * menjumlah SEMUA yang dipilih, bukan satu halaman (perbaikan bug KOL
 * Manager).
 */
export function PembayaranClient({ param, data, campaign, kolaborasiDocNo, hariIni, bolehMengelola }: Props) {
  const t = useTranslations("kreatifRuang");
  const locale = useLocale();
  const router = useRouter();
  const [berpindah, mulaiPindah] = useTransition();
  const [mengekspor, mulaiEkspor] = useTransition();
  const [dipilih, setDipilih] = useState<Map<string, BarisTermin>>(() => new Map());
  const [dialog, setDialog] = useState<readonly BarisTermin[] | null>(null);
  const [dialogKe, setDialogKe] = useState(0);
  const [cari, setCari] = useState(param.cari);
  const cariTerakhir = useRef(param.cari);

  const pergi = (ubah: Partial<ParamTermin>) => mulaiPindah(() => router.replace(alamatTermin({ ...param, ...ubah }), { scroll: false }));

  useEffect(() => {
    if (cari === cariTerakhir.current) return;
    const h = window.setTimeout(() => {
      cariTerakhir.current = cari;
      mulaiPindah(() => router.replace(alamatTermin({ ...param, cari, halaman: 1 }), { scroll: false }));
    }, 350);
    return () => window.clearTimeout(h);
  }, [cari, param, router]);

  const bisaDipilih = (b: BarisTermin) => bolehMengelola && b.status === "BELUM";
  const halamanIni = data.baris;
  const pilihanHalaman = halamanIni.filter(bisaDipilih);
  const semuaHalamanDipilih = pilihanHalaman.length > 0 && pilihanHalaman.every((b) => dipilih.has(b.id));
  const daftarDipilih = useMemo(() => [...dipilih.values()], [dipilih]);
  const netoDipilih = jumlahUang(daftarDipilih.map((b) => b.neto));

  const ubahPilih = (b: BarisTermin, ya: boolean) =>
    setDipilih((lama) => {
      const baru = new Map(lama);
      if (ya) baru.set(b.id, b);
      else baru.delete(b.id);
      return baru;
    });

  const ubahPilihHalaman = (ya: boolean) =>
    setDipilih((lama) => {
      const baru = new Map(lama);
      for (const b of pilihanHalaman) {
        if (ya) baru.set(b.id, b);
        else baru.delete(b.id);
      }
      return baru;
    });

  const bukaDialog = (termin: readonly BarisTermin[]) => {
    setDialogKe((k) => k + 1);
    setDialog(termin);
  };

  const ekspor = () =>
    mulaiEkspor(async () => {
      const r = await eksporTerminAction({ chip: param.chip, cari: param.cari, campaignId: param.campaign, kolaborasiId: param.kolaborasi });
      if (!r.ok) {
        toast.error(t("pembayaran.eksporGagal"));
        return;
      }
      unduh(r.isi, r.namaBerkas, "text/csv;charset=utf-8");
      toast.success(t("pembayaran.eksporOk"));
    });

  const sesudahBayar = () => {
    setDialog(null);
    setDipilih(new Map());
    router.refresh();
  };

  const opsiCampaign = [{ value: SEMUA_CAMPAIGN, label: t("pembayaran.campaignSemua") }, ...campaign.map((c) => ({ value: c.id, label: c.name }))];
  const adaSaringan = Boolean(param.cari || param.campaign || param.kolaborasi);

  const teksPemicu = (b: BarisTermin) =>
    b.pemicu === "TANGGAL" ? t("termin.pemicuTanggal") : t(`termin.pemicu.${b.pemicu}`, { n: b.hariSesudah });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("halaman.pembayaran")}
        meta={t("termin.meta", { n: data.jumlahPerChip.SEMUA })}
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
            <p className="text-sm text-muted-foreground">{t("termin.kartu.bruto")}</p>
            <p className="text-2xl font-semibold tabular-nums">{rupiahTeks(data.ringkas.bruto)}</p>
            <p className="text-xs text-muted-foreground">{t("termin.kartu.brutoSub", { n: data.ringkas.jumlah })}</p>
          </CardContent>
        </Card>
        <Card className="gap-1 py-4">
          <CardContent className="px-4">
            <p className="text-sm text-muted-foreground">{t("termin.kartu.pph")}</p>
            <p className="text-2xl font-semibold tabular-nums">{rupiahTeks(data.ringkas.pph)}</p>
            <p className="text-xs text-muted-foreground">{t("termin.kartu.pphSub")}</p>
          </CardContent>
        </Card>
        <Card className="gap-1 py-4">
          <CardContent className="px-4">
            <p className="text-sm text-muted-foreground">{t("termin.kartu.neto")}</p>
            <p className="text-2xl font-semibold tabular-nums">{rupiahTeks(data.ringkas.neto)}</p>
            <p className={cn("text-xs", data.ringkas.belumNeto > 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground")}>
              {t("termin.kartu.netoSub", { jumlah: rupiahTeks(data.ringkas.belumNeto), n: data.ringkas.belumJumlah })}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        <div role="group" aria-label={t("pembayaran.chip.label")} className="flex flex-wrap gap-1.5">
          {CHIP_TERMIN.map((c) => (
            <Button
              key={c}
              type="button"
              size="sm"
              variant={param.chip === c ? "secondary" : "outline"}
              aria-pressed={param.chip === c}
              className={cn("tabular-nums", param.chip === c && "ring-1 ring-foreground/30")}
              onClick={() => pergi({ chip: c, halaman: 1 })}
            >
              {t("pembayaran.chip.jumlah", { label: t(`termin.chip.${c}`), n: data.jumlahPerChip[c] })}
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={cari} onChange={(e) => setCari(e.target.value)} placeholder={t("pembayaran.cari")} aria-label={t("pembayaran.cari")} className="pl-9" />
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
          {param.kolaborasi ? (
            <Button variant="outline" size="sm" onClick={() => pergi({ kolaborasi: null, halaman: 1 })}>
              {t("termin.saringKolaborasi", { docNo: kolaborasiDocNo ?? "—" })}
              <X className="h-4 w-4" aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>

      {bolehMengelola && dipilih.size > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium tabular-nums">{t("termin.dipilih", { n: dipilih.size, neto: rupiahTeks(netoDipilih) })}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDipilih(new Map())}>
              <X className="h-4 w-4" aria-hidden />
              {t("pembayaran.kosongkanPilihan")}
            </Button>
            <Button size="sm" onClick={() => bukaDialog(daftarDipilih)}>
              <Banknote className="h-4 w-4" aria-hidden />
              {t("termin.bayarDipilih")}
            </Button>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" aria-hidden />
            {t("termin.judulDaftar")}
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
                      pergi({ cari: "", campaign: null, kolaborasi: null, halaman: 1 });
                    }}
                  >
                    {t("pembayaran.kosong.hapusSaringan")}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Wallet}
                title={param.chip === "BELUM" || param.chip === "JATUH_TEMPO" ? t("termin.kosong.belumJudul") : t("pembayaran.kosong.judul")}
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
                            disabled={pilihanHalaman.length === 0}
                            onCheckedChange={(v) => ubahPilihHalaman(v === true)}
                            aria-label={t("pembayaran.pilihHalaman")}
                          />
                        </TableHead>
                      ) : null}
                      <TableHead className="min-w-[150px]">{t("pembayaran.kolom.kol")}</TableHead>
                      <TableHead className="min-w-[130px]">{t("termin.kolom.termin")}</TableHead>
                      <TableHead>{t("pembayaran.kolom.jatuhTempo")}</TableHead>
                      <TableHead className="hidden text-right lg:table-cell">{t("termin.kolom.bruto")}</TableHead>
                      <TableHead className="hidden text-right lg:table-cell">{t("termin.kolom.pph")}</TableHead>
                      <TableHead className="text-right">{t("termin.kolom.neto")}</TableHead>
                      <TableHead>{t("pembayaran.kolom.status")}</TableHead>
                      <TableHead className="text-right">
                        <span className="sr-only">{t("pembayaran.kolom.aksi")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="baris-berurutan">
                    {halamanIni.map((b) => {
                      const kurangData = b.jenisPajak !== "TIDAK_DIPOTONG" && !b.dataPajakLengkap;
                      return (
                        <TableRow key={b.id} data-state={dipilih.has(b.id) ? "selected" : undefined}>
                          {bolehMengelola ? (
                            <TableCell>
                              {bisaDipilih(b) ? (
                                <Checkbox
                                  checked={dipilih.has(b.id)}
                                  onCheckedChange={(v) => ubahPilih(b, v === true)}
                                  aria-label={t("termin.pilihBaris", { nama: nama(b), label: b.label })}
                                />
                              ) : null}
                            </TableCell>
                          ) : null}
                          <TableCell className="whitespace-normal">
                            <p className="flex items-center gap-1.5 font-medium">
                              {nama(b)}
                              {kurangData && b.status === "BELUM" ? (
                                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-label={t("termin.dataBelumLengkap")} />
                              ) : null}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {b.docNo}
                              {b.campaignNama ? ` · ${b.campaignNama}` : ""}
                            </p>
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            <p>
                              {b.label}
                              {b.jumlahTermin > 1 ? <span className="text-muted-foreground"> · {b.urutan}/{b.jumlahTermin}</span> : null}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {teksPemicu(b)}
                              {b.grossUp ? ` · ${t("termin.grossUp")}` : ""}
                            </p>
                          </TableCell>
                          <TableCell>
                            {b.status === "DIBAYAR" ? (
                              <span className="text-sm text-muted-foreground">—</span>
                            ) : b.jatuhTempo ? (
                              <div className={cn("text-sm tabular-nums", b.jatuhTempo.lewat && "font-medium text-red-700 dark:text-red-400")}>
                                <p>{labelTanggal(b.jatuhTempo.tanggal, locale)}</p>
                                {b.jatuhTempo.lewat ? (
                                  <p className="text-xs">{t("pembayaran.lewatHari", { n: b.jatuhTempo.lewatHari })}</p>
                                ) : b.jatuhTempo.tanggal === hariIni ? (
                                  <p className="text-xs text-muted-foreground">{t("pembayaran.jatuhHariIni")}</p>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">{t(`termin.menunggu.${b.pemicu}`)}</span>
                            )}
                          </TableCell>
                          <TableCell className="hidden text-right tabular-nums lg:table-cell">{rupiahTeks(b.bruto)}</TableCell>
                          <TableCell className="hidden text-right tabular-nums lg:table-cell">{b.warisan ? "—" : rupiahTeks(b.pph)}</TableCell>
                          <TableCell className="text-right">
                            <p className="font-medium tabular-nums">{rupiahTeks(b.neto)}</p>
                            <p className="text-xs text-muted-foreground tabular-nums lg:hidden">
                              {t("termin.brutoPph", { bruto: rupiahTeks(b.bruto), pph: rupiahTeks(b.pph) })}
                            </p>
                          </TableCell>
                          <TableCell>
                            <StatusPill
                              tone={b.status === "DIBAYAR" ? "settled" : b.jatuhTempo?.lewat ? "attention" : "waiting"}
                              detail={b.dibayarAt ? <span className="text-xs text-muted-foreground">{labelTanggal(b.dibayarAt, locale)}</span> : undefined}
                            >
                              {t(`termin.status.${b.status}`)}
                            </StatusPill>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {b.status === "BELUM" && bolehMengelola ? (
                                <Button size="sm" onClick={() => bukaDialog([b])}>
                                  {t("termin.bayar")}
                                </Button>
                              ) : null}
                              {b.buktiTransferUrl ? (
                                <Button asChild variant="ghost" size="icon" aria-label={t("termin.lihatBukti")}>
                                  <a href={b.buktiTransferUrl} target="_blank" rel="noopener noreferrer">
                                    <ImageIcon className="h-4 w-4" aria-hidden />
                                  </a>
                                </Button>
                              ) : null}
                              <Button asChild variant="ghost" size="sm">
                                <Link href={`/backoffice/kreatif/kolaborasi/${b.kolaborasiId}?tab=pembayaran`} aria-label={t("pembayaran.bukaAria", { docNo: b.docNo })}>
                                  {t("pembayaran.buka")}
                                </Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <Pagination
                page={data.halaman}
                totalPages={Math.max(1, Math.ceil(data.total / data.perHalaman))}
                onPageChange={(halaman) => pergi({ halaman })}
                totalCount={data.total}
                pageSize={data.perHalaman}
              />
            </>
          )}
        </CardContent>
      </Card>

      {bolehMengelola && dialog ? (
        <DialogBayarTermin key={dialogKe} open onOpenChange={(v) => !v && setDialog(null)} termin={dialog} hariIni={hariIni} onSelesai={sesudahBayar} />
      ) : null}
    </div>
  );
}

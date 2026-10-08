"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CheckCheck, ChevronDown, FileUp, Landmark, Loader2, Scale, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format/rupiah";
import { formatDisplayDateTime } from "@/lib/date-only";
import { labelTanggal } from "@/lib/tanggal-isian";
import { cn } from "@/lib/utils";
import type { BarisMutasiTampil, HalamanMutasi, ImporMutasiTampil, KandidatJurnal, LaporanRekonsiliasi, RekeningRekonsiliasi } from "@/lib/finance/bank/queries";
import type { AkunPilihan } from "@/lib/finance/kas/voucher-queries";
import type { KategoriTampil } from "@/lib/finance/kas/kategori-writer";
import {
  abaikanMutasiAction,
  buatVoucherDariMutasiAction,
  bukaAbaikanAction,
  cocokkanManualAction,
  cocokkanOtomatisAction,
  hapusImporMutasiAction,
  imporMutasiAction,
  kandidatJurnalAction,
  lepasCocokAction,
} from "@/app/actions/finance-kas";
import { TAUTAN_DOKUMEN } from "@/app/backoffice/purchase-orders/tautan-dokumen";
import { pesanGalatKas } from "../kas/_bersama/pesan-kas";

export type SaringanRekonsiliasi = {
  akun: string;
  tab: "mutasi" | "laporan" | "impor";
  status: "UNMATCHED" | "MATCHED" | "IGNORED" | "SEMUA";
  dari: string;
  sampai: string;
  halaman: number;
  tanggal: string;
};

type Props = {
  saringan: SaringanRekonsiliasi;
  rekening: RekeningRekonsiliasi[];
  mutasi: HalamanMutasi | null;
  laporan: LaporanRekonsiliasi | null;
  impor: ImporMutasiTampil[];
  gagal: boolean;
  hariIni: string;
  akunPilihan: AkunPilihan[];
  kategori: KategoriTampil[];
  bolehKelola: boolean;
};

const ALAMAT = "/backoffice/finance/rekonsiliasi-bank";

export function RekonsiliasiBankClient({ saringan, rekening, mutasi, laporan, impor, gagal, hariIni, akunPilihan, kategori, bolehKelola }: Props) {
  const t = useTranslations("financeBank");
  const tk = useTranslations("financeKas");
  const locale = useLocale();
  const router = useRouter();
  const [pindah, mulaiPindah] = useTransition();
  const [pending, mulai] = useTransition();
  const [imporBuka, setImporBuka] = useState(false);
  const berkasRef = useRef<HTMLInputElement>(null);
  const [manual, setManual] = useState<{ baris: BarisMutasiTampil; kandidat: KandidatJurnal[] | null } | null>(null);
  const [abaikan, setAbaikan] = useState<BarisMutasiTampil | null>(null);
  const [alasan, setAlasan] = useState("");
  const [catat, setCatat] = useState<BarisMutasiTampil | null>(null);
  const [pilihAkun, setPilihAkun] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [hapusImpor, setHapusImpor] = useState<ImporMutasiTampil | null>(null);
  const pesan = (r: { kode: string; peran?: string; baris?: number }) => pesanGalatKas(tk as unknown as Parameters<typeof pesanGalatKas>[0], r);

  const pergi = (ubah: Partial<SaringanRekonsiliasi>) => {
    const s = { ...saringan, halaman: 1, ...ubah };
    const q = new URLSearchParams();
    if (s.akun) q.set("akun", s.akun);
    if (s.tab !== "mutasi") q.set("tab", s.tab);
    if (s.tab === "mutasi" && s.status !== "UNMATCHED") q.set("status", s.status);
    if (s.tab === "mutasi" && s.dari) q.set("dari", s.dari);
    if (s.tab === "mutasi" && s.sampai) q.set("sampai", s.sampai);
    if (s.tab === "mutasi" && s.halaman > 1) q.set("halaman", String(s.halaman));
    if (s.tab === "laporan" && s.tanggal !== hariIni) q.set("tanggal", s.tanggal);
    const qs = q.toString();
    mulaiPindah(() => router.replace(qs ? `${ALAMAT}?${qs}` : ALAMAT, { scroll: false }));
  };

  const jalankan = (fn: () => Promise<{ ok: boolean; kode?: string; peran?: string } & Record<string, unknown>>, sukses: (r: Record<string, unknown>) => string, sesudah?: () => void) =>
    mulai(async () => {
      try {
        const r = await fn();
        if (!r.ok) return void toast.error(pesan({ kode: String(r.kode ?? "GAGAL"), peran: r.peran as string | undefined }));
        toast.success(sukses(r));
        sesudah?.();
        router.refresh();
      } catch {
        toast.error(pesan({ kode: "GAGAL" }));
      }
    });

  const kirimImpor = () => {
    const f = berkasRef.current?.files?.[0];
    if (!f) return void toast.error(pesan({ kode: "BERKAS_WAJIB" }));
    const fd = new FormData();
    fd.set("akunId", saringan.akun);
    fd.set("berkas", f);
    jalankan(
      () => imporMutasiAction(fd) as never,
      (r) => t("imporBerhasil", { baru: Number(r.baru ?? 0), sudahAda: Number(r.sudahAda ?? 0), cocok: Number(r.dicocokkan ?? 0) }),
      () => setImporBuka(false),
    );
  };

  const bukaManual = async (b: BarisMutasiTampil) => {
    setManual({ baris: b, kandidat: null });
    const r = await kandidatJurnalAction({ mutasiId: b.id });
    setManual({ baris: b, kandidat: r.ok ? r.kandidat : [] });
  };

  const opsiAkun = (masuk: boolean) => [
    ...kategori.filter((k) => k.jenis === (masuk ? "IN" : "OUT")).map((k) => ({ value: `k:${k.id}`, label: `${k.nama} — ${k.akunKode} ${k.akunNama}` })),
    ...akunPilihan.map((a) => ({ value: `a:${a.id}`, label: `${a.kode} · ${a.nama}` })),
  ];

  const akunAktif = rekening.find((r) => r.id === saringan.akun);
  const tabKelas = (aktif: boolean) => cn("inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors", aktif ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={akunAktif ? t("meta", { akun: `${akunAktif.nama} (${akunAktif.kode})`, belum: akunAktif.belumCocok }) : undefined}
        actions={
          bolehKelola && saringan.akun ? (
            <>
              <Button variant="outline" disabled={pending} onClick={() => jalankan(() => cocokkanOtomatisAction({ akunId: saringan.akun }) as never, (r) => t("otomatisBerhasil", { jumlah: Number(r.dicocokkan ?? 0) }))}>
                <CheckCheck className="mr-2 h-4 w-4" />
                {t("cocokOtomatis")}
              </Button>
              <Button onClick={() => setImporBuka(true)}>
                <FileUp className="mr-2 h-4 w-4" />
                {t("impor")}
              </Button>
            </>
          ) : null
        }
      />

      {rekening.length === 0 ? (
        <Card className="py-0">
          <CardContent className="py-6">
            <EmptyState icon={Landmark} title={t("tanpaRekening")} description={t("tanpaRekeningIsi")} />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-2">
              <Label>{t("rekening")}</Label>
              <Select value={saringan.akun} onValueChange={(v) => pergi({ akun: v })}>
                <SelectTrigger className="w-full sm:w-[300px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {rekening.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.nama} ({r.kode}){r.belumCocok ? ` · ${t("belumCocokSingkat", { jumlah: r.belumCocok })}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="inline-flex rounded-lg bg-muted p-1" role="tablist">
              {(["mutasi", "laporan", "impor"] as const).map((tb) => (
                <button key={tb} type="button" role="tab" aria-selected={saringan.tab === tb} className={tabKelas(saringan.tab === tb)} onClick={() => pergi({ tab: tb })}>
                  {t(`tab.${tb}`)}
                </button>
              ))}
            </div>
          </div>

          {gagal && <p className="text-sm text-destructive">{t("gagalMemuat")}</p>}

          {saringan.tab === "mutasi" && mutasi && (
            <Card className="py-0">
              <CardHeader className="pt-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Landmark className="h-5 w-5" />
                    {t("mutasiJudul")}
                  </CardTitle>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Select value={saringan.status} onValueChange={(v) => pergi({ status: v as SaringanRekonsiliasi["status"] })}>
                      <SelectTrigger className="w-full sm:w-[190px]" aria-label={t("saringStatus")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["UNMATCHED", "MATCHED", "IGNORED", "SEMUA"] as const).map((s) => (
                          <SelectItem key={s} value={s}>
                            {t(`status.${s}`)}
                            {s !== "SEMUA" ? ` (${mutasi.jumlahPerStatus[s] ?? 0})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="w-full sm:w-[240px]">
                      <RentangTanggalInput dari={saringan.dari} sampai={saringan.sampai} onChange={(r) => pergi({ dari: r.dari, sampai: r.sampai })} placeholder={t("rentang")} aria-label={t("rentang")} />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className={cn("pb-6", pindah && "opacity-60")}>
                {mutasi.baris.length === 0 ? (
                  <EmptyState icon={Landmark} title={saringan.status === "UNMATCHED" ? t("kosongBelum") : t("kosong")} description={bolehKelola ? t("kosongIsi") : undefined} />
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("kolom.tanggal")}</TableHead>
                            <TableHead>{t("kolom.keterangan")}</TableHead>
                            <TableHead className="text-right">{t("kolom.jumlah")}</TableHead>
                            <TableHead className="hidden text-right 2xl:table-cell">{t("kolom.saldo")}</TableHead>
                            <TableHead>{t("kolom.status")}</TableHead>
                            {bolehKelola && (
                              <TableHead className="w-12">
                                <span className="sr-only">{t("kolom.aksi")}</span>
                              </TableHead>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {mutasi.baris.map((b) => (
                            <TableRow key={b.id}>
                              <TableCell className="align-top whitespace-nowrap">{labelTanggal(b.tanggal, locale)}</TableCell>
                              <TableCell className="align-top whitespace-normal text-sm">
                                <p className="line-clamp-2">{b.keterangan}</p>
                                {b.referensi && <p className="text-xs text-muted-foreground">{b.referensi}</p>}
                                {b.catatan && <p className="text-xs text-muted-foreground">{b.catatan}</p>}
                              </TableCell>
                              <TableCell className={cn("align-top text-right tabular-nums", b.jumlah > 0 ? "text-emerald-700 dark:text-emerald-400" : "")}>
                                {b.jumlah > 0 ? "+" : "−"}
                                {formatRupiah(Math.abs(b.jumlah))}
                              </TableCell>
                              <TableCell className="hidden align-top text-right tabular-nums 2xl:table-cell">{b.saldo != null ? formatRupiah(b.saldo) : "–"}</TableCell>
                              <TableCell className="align-top">
                                {b.status === "MATCHED" ? (
                                  <div className="space-y-1">
                                    <StatusPill tone="settled">{t("status.MATCHED")}</StatusPill>
                                    {b.cocokDengan && (
                                      <Link href={`/backoffice/finance/journals/${b.cocokDengan.journalId}`} className={`${TAUTAN_DOKUMEN} block max-w-[220px] truncate text-xs`} title={b.cocokDengan.uraian}>
                                        {b.cocokDengan.uraian}
                                      </Link>
                                    )}
                                  </div>
                                ) : b.status === "IGNORED" ? (
                                  <StatusPill tone="inactive">{t("status.IGNORED")}</StatusPill>
                                ) : (
                                  <StatusPill tone="waiting">{t("status.UNMATCHED")}</StatusPill>
                                )}
                              </TableCell>
                              {bolehKelola && (
                                <TableCell className="align-top">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="outline" size="sm" className="gap-1" disabled={pending}>
                                        {t("kolom.aksi")}
                                        <ChevronDown className="h-3 w-3 opacity-60" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      {b.status === "UNMATCHED" && (
                                        <>
                                          <DropdownMenuItem onSelect={() => void bukaManual(b)}>{t("aksi.cocokManual")}</DropdownMenuItem>
                                          <DropdownMenuSeparator />
                                          {b.jumlah < 0 ? (
                                            <DropdownMenuItem onSelect={() => jalankan(() => buatVoucherDariMutasiAction({ mutasiId: b.id, peranCepat: "BIAYA_ADMIN" }) as never, (r) => t("voucherDibuat", { nomor: String(r.nomor ?? "") }))}>
                                              {t("aksi.biayaAdmin")}
                                            </DropdownMenuItem>
                                          ) : (
                                            <DropdownMenuItem onSelect={() => jalankan(() => buatVoucherDariMutasiAction({ mutasiId: b.id, peranCepat: "BUNGA" }) as never, (r) => t("voucherDibuat", { nomor: String(r.nomor ?? "") }))}>
                                              {t("aksi.bunga")}
                                            </DropdownMenuItem>
                                          )}
                                          <DropdownMenuItem
                                            onSelect={() => {
                                              setPilihAkun("");
                                              setKeterangan(b.keterangan);
                                              setCatat(b);
                                            }}
                                          >
                                            {t("aksi.catatAkun")}
                                          </DropdownMenuItem>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem
                                            onSelect={() => {
                                              setAlasan("");
                                              setAbaikan(b);
                                            }}
                                          >
                                            {t("aksi.abaikan")}
                                          </DropdownMenuItem>
                                        </>
                                      )}
                                      {b.status === "MATCHED" && (
                                        <DropdownMenuItem disabled={b.dariVoucher} onSelect={() => jalankan(() => lepasCocokAction({ mutasiId: b.id }) as never, () => t("dilepas"))}>
                                          {t("aksi.lepas")}
                                        </DropdownMenuItem>
                                      )}
                                      {b.status === "MATCHED" && b.dariVoucher && <p className="px-2 pb-1.5 text-xs text-muted-foreground">{t("aksi.lepasLewatVoucher")}</p>}
                                      {b.status === "IGNORED" && (
                                        <DropdownMenuItem onSelect={() => jalankan(() => bukaAbaikanAction({ mutasiId: b.id }) as never, () => t("dikembalikan"))}>{t("aksi.kembalikan")}</DropdownMenuItem>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <Pagination page={mutasi.halaman} totalPages={Math.max(1, Math.ceil(mutasi.total / mutasi.ukuran))} onPageChange={(h) => pergi({ halaman: h })} totalCount={mutasi.total} pageSize={mutasi.ukuran} />
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {saringan.tab === "laporan" && (
            <Card className="py-0">
              <CardHeader className="pt-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Scale className="h-5 w-5" />
                    {t("laporan.judul")}
                  </CardTitle>
                  <div className="space-y-1">
                    <Label htmlFor="tanggal-rekon" className="text-xs">
                      {t("laporan.perTanggal")}
                    </Label>
                    <TanggalInput id="tanggal-rekon" value={saringan.tanggal} max={hariIni} onChange={(e) => pergi({ tanggal: e.target.value })} className="w-[200px]" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className={cn("space-y-6 pb-6", pindah && "opacity-60")}>
                {!laporan ? null : !laporan.adaMutasi ? (
                  <EmptyState icon={Scale} title={t("laporan.tanpaMutasi")} />
                ) : (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2 rounded-md border p-4 text-sm">
                        <p className="font-medium">{t("laporan.sisiBank")}</p>
                        <Angka label={t("laporan.saldoBank")} nilai={laporan.ringkasan.saldoBankSen == null ? t("laporan.tidakDiketahui") : formatRupiah(laporan.ringkasan.saldoBankSen / 100)} />
                        <Angka label={t("laporan.tambahJurnal")} nilai={formatRupiah(laporan.ringkasan.jurnalBelumCocokSen / 100)} />
                        <Angka
                          label={t("laporan.bankDisesuaikan")}
                          nilai={laporan.ringkasan.saldoBankDisesuaikanSen == null ? "–" : formatRupiah(laporan.ringkasan.saldoBankDisesuaikanSen / 100)}
                          tebal
                        />
                      </div>
                      <div className="space-y-2 rounded-md border p-4 text-sm">
                        <p className="font-medium">{t("laporan.sisiBuku")}</p>
                        <Angka label={t("laporan.saldoBuku")} nilai={formatRupiah(laporan.ringkasan.saldoBukuSen / 100)} />
                        <Angka label={t("laporan.tambahMutasi")} nilai={formatRupiah(laporan.ringkasan.mutasiBelumCocokSen / 100)} />
                        <Angka label={t("laporan.bukuDisesuaikan")} nilai={formatRupiah(laporan.ringkasan.saldoBukuDisesuaikanSen / 100)} tebal />
                      </div>
                    </div>
                    <div
                      className={cn(
                        "rounded-md border p-3 text-sm",
                        laporan.ringkasan.cocok ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
                      )}
                    >
                      {laporan.ringkasan.selisihSen == null
                        ? t("laporan.saldoBankTidakDiketahui")
                        : laporan.ringkasan.cocok
                          ? t("laporan.cocok")
                          : t("laporan.selisih", { nilai: formatRupiah(laporan.ringkasan.selisihSen / 100) })}
                    </div>
                    {laporan.sejak && <p className="text-xs text-muted-foreground">{t("laporan.sejak", { tanggal: labelTanggal(laporan.sejak, locale) })}</p>}
                    <DaftarItem judul={t("laporan.jurnalBelumCocok")} kosong={t("laporan.tidakAda")} item={laporan.jurnalBelumCocok} terpotong={laporan.terpotong.jurnal} locale={locale} tautanJurnal tLebih={(n) => t("laporan.terpotong", { jumlah: n })} />
                    <DaftarItem judul={t("laporan.mutasiBelumCocok")} kosong={t("laporan.tidakAda")} item={laporan.mutasiBelumCocok} terpotong={laporan.terpotong.mutasi} locale={locale} tLebih={(n) => t("laporan.terpotong", { jumlah: n })} />
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {saringan.tab === "impor" && (
            <Card className="py-0">
              <CardHeader className="pt-6">
                <CardTitle className="flex items-center gap-2">
                  <FileUp className="h-5 w-5" />
                  {t("riwayatImpor")}
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-6">
                {impor.length === 0 ? (
                  <EmptyState icon={FileUp} title={t("belumAdaImpor")} />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("kolom.berkas")}</TableHead>
                          <TableHead>{t("kolom.periode")}</TableHead>
                          <TableHead className="text-right">{t("kolom.baris")}</TableHead>
                          <TableHead className="hidden xl:table-cell">{t("kolom.diimpor")}</TableHead>
                          {bolehKelola && (
                            <TableHead className="w-12">
                              <span className="sr-only">{t("hapusImpor")}</span>
                            </TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {impor.map((i) => (
                          <TableRow key={i.id}>
                            <TableCell className="whitespace-normal">
                              <p className="font-medium">{i.berkas}</p>
                              <p className="text-xs text-muted-foreground">{i.format ? t(`format.${i.format}` as never) : "–"}</p>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm">{i.periodeDari ? `${labelTanggal(i.periodeDari, locale)} – ${labelTanggal(i.periodeSampai ?? i.periodeDari, locale)}` : "–"}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {i.baris}
                              <span className="block text-xs text-muted-foreground">{t("cocokDari", { cocok: i.cocok })}</span>
                            </TableCell>
                            <TableCell className="hidden text-sm xl:table-cell">{formatDisplayDateTime(i.diimpor, locale)}</TableCell>
                            {bolehKelola && (
                              <TableCell>
                                <Button variant="ghost" size="icon" disabled={i.cocok > 0 || pending} onClick={() => setHapusImpor(i)} aria-label={t("hapusImporNama", { berkas: i.berkas })} title={i.cocok > 0 ? t("hapusDitolak") : undefined}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={imporBuka} onOpenChange={(v) => !pending && setImporBuka(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("impor")}</DialogTitle>
            <DialogDescription>{t("imporIsi", { akun: akunAktif ? `${akunAktif.nama} (${akunAktif.kode})` : "" })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="berkas-mutasi">{t("berkas")}</Label>
            <Input id="berkas-mutasi" ref={berkasRef} type="file" accept=".csv,.txt,.xls,.xlsx" />
            <p className="text-xs text-muted-foreground">{t("formatDidukung")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImporBuka(false)} disabled={pending}>
              {tk("tutup")}
            </Button>
            <Button onClick={kirimImpor} disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("imporTombol")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manual != null} onOpenChange={(v) => !pending && !v && setManual(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("aksi.cocokManual")}</DialogTitle>
            <DialogDescription>
              {manual ? t("manualIsi", { tanggal: labelTanggal(manual.baris.tanggal, locale), jumlah: formatRupiah(manual.baris.jumlah) }) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {manual?.kandidat == null ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : manual.kandidat.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("tanpaKandidat")}</p>
            ) : (
              manual.kandidat.map((k) => (
                <div key={k.barisId} className="flex items-center justify-between gap-3 rounded-md border p-2">
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium" title={k.uraian}>
                      {k.uraian}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {labelTanggal(k.tanggal, locale)} · {t("selisihHari", { hari: k.selisihHari })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => manual && jalankan(() => cocokkanManualAction({ mutasiId: manual.baris.id, barisJurnalId: k.barisId }) as never, () => t("dicocokkan"), () => setManual(null))}
                  >
                    {t("pilih")}
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={catat != null} onOpenChange={(v) => !pending && !v && setCatat(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("aksi.catatAkun")}</DialogTitle>
            <DialogDescription>{catat ? t(catat.jumlah < 0 ? "catatIsiKeluar" : "catatIsiMasuk", { jumlah: formatRupiah(Math.abs(catat.jumlah)) }) : null}</DialogDescription>
          </DialogHeader>
          {catat && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>{tk("form.pilihAkun")}</Label>
                <SearchableCombobox options={opsiAkun(catat.jumlah > 0)} value={pilihAkun} onValueChange={setPilihAkun} placeholder={tk("form.pilihAkun")} triggerClassName="w-full" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="keterangan-mutasi">{tk("form.keterangan")}</Label>
                <Textarea id="keterangan-mutasi" value={keterangan} onChange={(e) => setKeterangan(e.target.value)} rows={2} maxLength={1000} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatat(null)} disabled={pending}>
              {tk("tutup")}
            </Button>
            <Button
              disabled={pending || !pilihAkun}
              onClick={() =>
                catat &&
                jalankan(
                  () =>
                    buatVoucherDariMutasiAction({
                      mutasiId: catat.id,
                      akunId: pilihAkun.startsWith("a:") ? pilihAkun.slice(2) : null,
                      kategoriId: pilihAkun.startsWith("k:") ? pilihAkun.slice(2) : null,
                      keterangan,
                    }) as never,
                  (r) => t("voucherDibuat", { nomor: String(r.nomor ?? "") }),
                  () => setCatat(null),
                )
              }
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("catatTombol")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={abaikan != null} onOpenChange={(v) => !pending && !v && setAbaikan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("aksi.abaikan")}</DialogTitle>
            <DialogDescription>{t("abaikanIsi")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="alasan-abaikan">{t("alasan")}</Label>
            <Textarea id="alasan-abaikan" value={alasan} onChange={(e) => setAlasan(e.target.value)} rows={2} maxLength={500} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbaikan(null)} disabled={pending}>
              {tk("tutup")}
            </Button>
            <Button disabled={pending || alasan.trim().length < 3} onClick={() => abaikan && jalankan(() => abaikanMutasiAction({ mutasiId: abaikan.id, alasan }) as never, () => t("diabaikan"), () => setAbaikan(null))}>
              {t("aksi.abaikan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={hapusImpor != null} onOpenChange={(v) => !pending && !v && setHapusImpor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("hapusImporNama", { berkas: hapusImpor?.berkas ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("hapusImporIsi", { baris: hapusImpor?.baris ?? 0 })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{tk("tutup")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                if (hapusImpor) jalankan(() => hapusImporMutasiAction({ importId: hapusImpor.id }) as never, () => t("imporDihapus"), () => setHapusImpor(null));
              }}
            >
              {t("hapusImpor")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Angka({ label, nilai, tebal }: { label: string; nilai: string; tebal?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4", tebal && "border-t pt-2 font-semibold")}>
      <span className={tebal ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{nilai}</span>
    </div>
  );
}

function DaftarItem({
  judul,
  kosong,
  item,
  terpotong,
  locale,
  tautanJurnal,
  tLebih,
}: {
  judul: string;
  kosong: string;
  item: Array<{ id: string; tanggal: string; uraian: string; jumlah: number; journalId?: string }>;
  terpotong: number;
  locale: string;
  tautanJurnal?: boolean;
  tLebih: (n: number) => string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{judul}</p>
      {item.length === 0 ? (
        <p className="text-sm text-muted-foreground">{kosong}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableBody>
              {item.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="whitespace-nowrap text-sm">{labelTanggal(i.tanggal, locale)}</TableCell>
                  <TableCell className="whitespace-normal text-sm">
                    {tautanJurnal && i.journalId ? (
                      <Link href={`/backoffice/finance/journals/${i.journalId}`} className={TAUTAN_DOKUMEN}>
                        {i.uraian}
                      </Link>
                    ) : (
                      i.uraian
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{formatRupiah(i.jumlah)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {terpotong > 0 && <p className="text-xs text-muted-foreground">{tLebih(terpotong)}</p>}
    </div>
  );
}

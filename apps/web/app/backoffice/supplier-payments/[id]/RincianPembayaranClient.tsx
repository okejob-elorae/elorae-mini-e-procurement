"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, BookOpenText, Loader2, Wallet } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format/rupiah";
import { formatDisplayDateTime } from "@/lib/date-only";
import { labelTanggal } from "@/lib/tanggal-isian";
import { bacaRupiahSen } from "@/lib/finance/kas/aturan";
import { INFO_POTONG_PEMASOK, bacaJenisPotongPemasok } from "@/lib/finance/pajak/pemotongan";
import { kunciDokumenHutang } from "@/lib/purchasing/pembayaran-aturan";
import type { RincianPembayaran } from "@/lib/purchasing/pembayaran-queries";
import type { DokumenHutang } from "@/lib/purchasing/pembayaran-hutang-queries";
import { batalkanPembayaranPemasokAction, terapkanUangMukaAction } from "@/app/actions/pembayaran-pemasok";
import { TAUTAN_DOKUMEN } from "@/app/backoffice/purchase-orders/tautan-dokumen";
import { pesanGalatPembayaran } from "../pesan-pembayaran";

type Props = { bayar: RincianPembayaran; dokumenTerbuka: DokumenHutang[]; akses: { ubah: boolean; lihatJurnal: boolean } };

export function RincianPembayaranClient({ bayar: b, dokumenTerbuka, akses }: Props) {
  const t = useTranslations("supplierPayments.dokumen");
  const locale = useLocale();
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [batalBuka, setBatalBuka] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [terapkanBuka, setTerapkanBuka] = useState(false);
  const [isi, setIsi] = useState<Record<string, string>>({});
  const pesan = (r: { kode: string; peran?: string; baris?: number }) => pesanGalatPembayaran(t as unknown as Parameters<typeof pesanGalatPembayaran>[0], r);

  const jenisPotong = bacaJenisPotongPemasok(b.jenisPotong);
  const bisaBatal = akses.ubah && b.status === "POSTED" && !b.cerminTandaiLunas;
  const alasanTidakBatal = b.status !== "POSTED" ? null : b.cerminTandaiLunas ? t("batalLewatTandaiLunas") : !akses.ubah ? t("butuhIzinUbah") : null;

  const totalTerapkanSen = Object.values(isi).reduce((s, v) => s + (bacaRupiahSen(v) ?? 0), 0);
  const isiSalah = dokumenTerbuka.some((d) => {
    const v = isi[kunciDokumenHutang(d.jenis, d.id)]?.trim();
    if (!v) return false;
    const s = bacaRupiahSen(v);
    return s == null || s > d.sisaSen;
  });

  const batalkan = () =>
    mulai(async () => {
      const r = await batalkanPembayaranPemasokAction({ id: b.id, alasan });
      if (!r.ok) return void toast.error(pesan(r));
      toast.success(t("dibatalkan", { nomor: b.nomor }));
      setBatalBuka(false);
      router.refresh();
    });

  const terapkan = () =>
    mulai(async () => {
      const alokasi = dokumenTerbuka
        .map((d) => ({ jenis: d.jenis, id: d.id, jumlah: isi[kunciDokumenHutang(d.jenis, d.id)]?.trim() ?? "" }))
        .filter((a) => a.jumlah);
      const r = await terapkanUangMukaAction({ pembayaranId: b.id, alokasi });
      if (!r.ok) return void toast.error(pesan(r));
      toast.success(r.potong ? t("uangMukaDiterapkanPotong", { nilai: formatRupiah(r.potong.jumlah), nomor: r.potong.nomor }) : t("uangMukaDiterapkan"));
      setTerapkanBuka(false);
      setIsi({});
      router.refresh();
    });

  const tautanAlokasi = (a: RincianPembayaran["alokasi"][number]) =>
    a.poId ? `/backoffice/purchase-orders/${a.poId}` : a.woId ? `/backoffice/work-orders/${a.woId}` : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judulRincian", { nomor: b.nomor })}
        meta={`${b.pemasok.nama} (${b.pemasok.kode}) · ${labelTanggal(b.tanggal, locale)}`}
        actions={
          <>
            <Link href="/backoffice/supplier-payments?tab=pembayaran">
              <Button variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("kembali")}
              </Button>
            </Link>
            {akses.lihatJurnal && b.jurnalId && (
              <Link href={`/backoffice/finance/journals/${b.jurnalId}`}>
                <Button variant="outline">
                  <BookOpenText className="mr-2 h-4 w-4" />
                  {t("lihatJurnal")}
                </Button>
              </Link>
            )}
            {b.status === "POSTED" && (
              <Button variant="destructive" disabled={!bisaBatal} onClick={() => setBatalBuka(true)}>
                {t("batalkan")}
              </Button>
            )}
          </>
        }
      />
      {alasanTidakBatal && <p className="-mt-3 text-right text-xs text-muted-foreground">{alasanTidakBatal}</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="py-0 lg:col-span-1">
          <CardHeader className="pt-6">
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              {t("ringkasanJudul")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pb-6 text-sm">
            <div className="pb-2">
              {b.status === "CANCELLED" ? <StatusPill tone="inactive">{t("statusBatal")}</StatusPill> : <StatusPill tone="settled">{t("statusBerlaku")}</StatusPill>}
            </div>
            <Isi label={t("caraLabel")} nilai={t(`cara.${b.cara}` as never)} />
            <Isi label={t("rekening")} nilai={b.rekening ?? "–"} />
            {b.referensi && <Isi label={t("referensi")} nilai={b.referensi} />}
            {b.jatuhTempoGiro && <Isi label={t("jatuhTempoGiro")} nilai={labelTanggal(b.jatuhTempoGiro, locale)} />}
            <Isi label={t("ringkasBruto")} nilai={formatRupiah(b.bruto)} />
            <Isi label={t("ringkasPotongBaris", { jenis: jenisPotong ? INFO_POTONG_PEMASOK[jenisPotong].label : "–" })} nilai={b.potong > 0 ? `− ${formatRupiah(b.potong)}` : "–"} />
            <Isi label={t("ringkasNeto")} nilai={formatRupiah(b.neto)} tebal />
            {b.uangMukaSisa > 0 && <Isi label={t("uangMukaBelumTerpakai")} nilai={formatRupiah(b.uangMukaSisa)} />}
            {b.mutasiTercocok > 0 && <p className="pt-2 text-xs text-muted-foreground">{t("sudahDicocokkanBank")}</p>}
            {b.cerminTandaiLunas && <p className="pt-2 text-xs text-muted-foreground">{t("cerminPenjelasan")}</p>}
            {b.catatan && <p className="pt-2 text-sm whitespace-pre-line">{b.catatan}</p>}
            {b.fotoUrl && (
              <a href={b.fotoUrl} target="_blank" rel="noreferrer" className={`${TAUTAN_DOKUMEN} inline-block pt-2 text-sm`}>
                {t("lihatBukti")}
              </a>
            )}
            <p className="pt-3 text-xs text-muted-foreground">
              {t("dicatatOleh", { nama: b.pencatat ?? "–", waktu: formatDisplayDateTime(b.dibuat, locale) })}
            </p>
            {b.dibatalkan && (
              <p className="text-xs text-muted-foreground">
                {t("dibatalkanOleh", { nama: b.dibatalkan.oleh ?? "–", waktu: formatDisplayDateTime(b.dibatalkan.pada, locale), alasan: b.dibatalkan.alasan ?? "–" })}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="py-0 lg:col-span-2">
          <CardHeader className="pt-6">
            <CardTitle>{t("alokasiJudul")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pb-6">
            {b.alokasi.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("tanpaAlokasi")}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("kolomDokumenHutang")}</TableHead>
                      <TableHead>{t("kolomJenis")}</TableHead>
                      <TableHead className="text-right">{t("kolomJumlah")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {b.alokasi.map((a) => {
                      const tautan = tautanAlokasi(a);
                      return (
                        <TableRow key={a.id}>
                          <TableCell className="whitespace-normal">
                            {tautan ? (
                              <Link href={tautan} className={TAUTAN_DOKUMEN}>
                                {a.label}
                              </Link>
                            ) : (
                              a.label
                            )}
                          </TableCell>
                          <TableCell>{t(`jenisDokumen.${a.jenis}` as never)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatRupiah(a.jumlah)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            {akses.ubah && b.status === "POSTED" && !b.cerminTandaiLunas && b.uangMukaSisa > 0 && (
              <Button variant="outline" onClick={() => setTerapkanBuka(true)} disabled={dokumenTerbuka.length === 0}>
                {t("terapkanUangMuka")}
              </Button>
            )}
            {akses.ubah && b.status === "POSTED" && b.uangMukaSisa > 0 && dokumenTerbuka.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("tanpaDokumenUntukUangMuka")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={batalBuka} onOpenChange={(v) => !pending && setBatalBuka(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("batalJudul", { nomor: b.nomor })}</AlertDialogTitle>
            <AlertDialogDescription>{t("batalIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="alasan-batal">{t("alasanBatal")}</Label>
            <Textarea id="alasan-batal" value={alasan} onChange={(e) => setAlasan(e.target.value)} rows={3} maxLength={500} />
            {alasan.trim().length > 0 && alasan.trim().length < 5 && <p className="text-xs text-destructive">{t("err.ALASAN_WAJIB")}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("tutup")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending || alasan.trim().length < 5}
              onClick={(e) => {
                e.preventDefault();
                batalkan();
              }}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("batalkan")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={terapkanBuka} onOpenChange={(v) => !pending && setTerapkanBuka(v)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("terapkanUangMuka")}</DialogTitle>
            <DialogDescription>{t("terapkanIsi", { nilai: formatRupiah(b.uangMukaSisa) })}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {dokumenTerbuka.map((d) => {
              const k = kunciDokumenHutang(d.jenis, d.id);
              return (
                <div key={k} className="flex items-center justify-between gap-3 rounded-md border p-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.jenis === "OTHER" ? t("hutangSaldoAwal") : d.nomor}</p>
                    <p className="text-xs text-muted-foreground">{t("sisaDokumen", { nilai: formatRupiah(d.sisaSen / 100) })}</p>
                  </div>
                  <Input
                    inputMode="decimal"
                    className="w-[150px] text-right tabular-nums"
                    value={isi[k] ?? ""}
                    onChange={(e) => setIsi((x) => ({ ...x, [k]: e.target.value }))}
                    aria-label={t("bayarDokumen", { nomor: d.nomor })}
                  />
                </div>
              );
            })}
          </div>
          <p className="text-sm">
            {t("akanDiterapkan", { nilai: formatRupiah(totalTerapkanSen / 100) })}
            {totalTerapkanSen > Math.round(b.uangMukaSisa * 100) && <span className="ml-1 text-destructive">{t("err.MELEBIHI_UANG_MUKA")}</span>}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTerapkanBuka(false)} disabled={pending}>
              {t("tutup")}
            </Button>
            <Button onClick={terapkan} disabled={pending || isiSalah || totalTerapkanSen <= 0 || totalTerapkanSen > Math.round(b.uangMukaSisa * 100)}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("terapkan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Isi({ label, nilai, tebal }: { label: string; nilai: string; tebal?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${tebal ? "border-t pt-2 font-semibold" : ""}`}>
      <span className={tebal ? "" : "text-muted-foreground"}>{label}</span>
      <span className="text-right tabular-nums">{nilai}</span>
    </div>
  );
}

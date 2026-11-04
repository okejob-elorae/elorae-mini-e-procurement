"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Download, FileLock2, Loader2, Pencil, Receipt } from "lucide-react";
import { toast } from "sonner";
import { PinAuthModal } from "@/components/security/PinAuthModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { catatBuktiPotongAction, catatSetorPphAction } from "@/app/actions/kreatif-termin";
import { eksporPphDipotongAction } from "@/app/actions/kreatif-pajak";
import { labelTanggal } from "@/lib/tanggal-isian";
import { jumlahUang, rupiahTeks } from "@/lib/creative/angka-konten";
import { labelPasal } from "@/lib/creative/pph";
import { geserMasa } from "@/lib/creative/termin-param";
import type { BarisPph } from "@/lib/creative/termin-queries";
import type { BarisPotongPemasok } from "@/lib/finance/kas/pph-dipotong-queries";
import { PotongPemasokCard } from "./PotongPemasokCard";

type Props = {
  masa: string;
  baris: BarisPph[];
  gagal: boolean;
  hariIni: string;
  bolehMengelola: boolean;
  /** PPh dipotong dari pembayaran pemasok dan voucher kas keluar masa ini. */
  potongPemasok?: BarisPotongPemasok[];
};

function unduh(isi: string, namaBerkas: string) {
  const url = URL.createObjectURL(new Blob([isi], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = namaBerkas;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type Ubah = { jenis: "bukti"; baris: BarisPph } | { jenis: "setor"; baris: BarisPph };

/**
 * PPh dipotong per masa. Nomor bukti potong dan setoran (tanggal + NTPN)
 * diketik keuangan sesudah dibuat di Coretax. Ekspor CSV tersamar untuk semua
 * pembaca; ekspor beridentitas lengkap hanya untuk keuangan dengan PIN.
 */
export function PphDipotongClient({ masa, baris, gagal, hariIni, bolehMengelola, potongPemasok }: Props) {
  const t = useTranslations("pphDipotong");
  const locale = useLocale();
  const router = useRouter();
  const [berpindah, mulaiPindah] = useTransition();
  const [pending, mulai] = useTransition();
  const [ubah, setUbah] = useState<Ubah | null>(null);
  const [nomor, setNomor] = useState("");
  const [tanggal, setTanggal] = useState(hariIni);
  const [ntpn, setNtpn] = useState("");
  const [minta, setMinta] = useState(false);
  const [mengekspor, setMengekspor] = useState(false);

  const [tahun, bulan] = masa.split("-").map(Number);
  const namaMasa = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(tahun, bulan - 1, 1)),
  );
  const pergi = (m: string) => mulaiPindah(() => router.replace(`/backoffice/finance/pph-dipotong?masa=${m}`, { scroll: false }));

  const per = (pasal: "21" | "23") => baris.filter((b) => b.pasal === pasal);
  const total21 = jumlahUang(per("21").map((b) => b.pph));
  const total23 = jumlahUang(per("23").map((b) => b.pph));
  const belumSetor = baris.filter((b) => !b.setorAt).length;
  const belumBukti = baris.filter((b) => !b.nomorBuktiPotong).length;

  /** Tanpa PIN: tersamar. Dengan PIN (keuangan): identitas lengkap — galat dilempar ke modal PIN. */
  const ekspor = async (pin?: string) => {
    setMengekspor(true);
    try {
      const r = await eksporPphDipotongAction({ masa, pin: pin ?? null });
      if (!r.ok) {
        const pesan = r.kode === "PIN" && "pesan" in r ? t(`pin.${r.pesan}`) : t(`err.${r.kode}`);
        if (pin) throw new Error(pesan);
        toast.error(pesan);
        return;
      }
      unduh(r.isi, r.namaBerkas);
      toast.success(r.lengkap ? t("eksporLengkapOk") : t("eksporOk"));
    } finally {
      setMengekspor(false);
    }
  };

  const bukaUbah = (u: Ubah) => {
    setUbah(u);
    setNomor(u.baris.nomorBuktiPotong ?? "");
    setTanggal(u.jenis === "bukti" ? (u.baris.buktiPotongAt ?? hariIni) : (u.baris.setorAt ?? hariIni));
    setNtpn(u.baris.ntpn ?? "");
  };

  const simpan = (hapus = false) =>
    mulai(async () => {
      if (!ubah) return;
      const r =
        ubah.jenis === "bukti"
          ? await catatBuktiPotongAction({ terminId: ubah.baris.terminId, nomor: hapus ? null : nomor, tanggal })
          : await catatSetorPphAction({ terminId: ubah.baris.terminId, setor: hapus ? null : { tanggal, ntpn } });
      if (!r.ok) {
        toast.error(t(`err.${r.kode}`));
        return;
      }
      toast.success(t(ubah.jenis === "bukti" ? "buktiOk" : "setorOk"));
      setUbah(null);
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={t("meta", { n: baris.length, masa: namaMasa })}
        actions={
          <>
            <Button variant="outline" onClick={() => void ekspor()} disabled={mengekspor || baris.length === 0}>
              {mengekspor ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
              {t("ekspor")}
            </Button>
            {bolehMengelola ? (
              <Button variant="outline" onClick={() => setMinta(true)} disabled={mengekspor || baris.length === 0}>
                <FileLock2 className="h-4 w-4" aria-hidden />
                {t("eksporLengkap")}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label={t("masaSebelum")} onClick={() => pergi(geserMasa(masa, -1))} disabled={berpindah}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>
        <p className="min-w-40 text-center font-medium capitalize">{namaMasa}</p>
        <Button variant="outline" size="icon" aria-label={t("masaSesudah")} onClick={() => pergi(geserMasa(masa, 1))} disabled={berpindah}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="gap-1 py-4">
          <CardContent className="px-4">
            <p className="text-sm text-muted-foreground">{t("kartu.pph21")}</p>
            <p className="text-2xl font-semibold tabular-nums">{rupiahTeks(total21)}</p>
            <p className="text-xs text-muted-foreground">{t("kartu.jumlah", { n: per("21").length })}</p>
          </CardContent>
        </Card>
        <Card className="gap-1 py-4">
          <CardContent className="px-4">
            <p className="text-sm text-muted-foreground">{t("kartu.pph23")}</p>
            <p className="text-2xl font-semibold tabular-nums">{rupiahTeks(total23)}</p>
            <p className="text-xs text-muted-foreground">{t("kartu.jumlah", { n: per("23").length })}</p>
          </CardContent>
        </Card>
        <Card className="gap-1 py-4">
          <CardContent className="px-4">
            <p className="text-sm text-muted-foreground">{t("kartu.belum")}</p>
            <p className="text-2xl font-semibold tabular-nums">{belumSetor}</p>
            <p className="text-xs text-muted-foreground">{t("kartu.belumBukti", { n: belumBukti })}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" aria-hidden />
            {t("daftar")}
          </CardTitle>
        </CardHeader>
        <CardContent className={berpindah ? "opacity-60 transition-opacity" : undefined}>
          {gagal ? (
            <p className="text-sm text-destructive">{t("gagal")}</p>
          ) : baris.length === 0 ? (
            <EmptyState icon={Receipt} title={t("kosong", { masa: namaMasa })} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolom.tanggal")}</TableHead>
                    <TableHead className="min-w-[150px]">{t("kolom.kol")}</TableHead>
                    <TableHead>{t("kolom.jenis")}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t("kolom.identitas")}</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">{t("kolom.bruto")}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{t("kolom.dpp")}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{t("kolom.tarif")}</TableHead>
                    <TableHead className="text-right">{t("kolom.pph")}</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">{t("kolom.neto")}</TableHead>
                    <TableHead>{t("kolom.bukti")}</TableHead>
                    <TableHead>{t("kolom.setor")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow key={b.terminId}>
                      <TableCell className="tabular-nums">{labelTanggal(b.dibayarAt, locale)}</TableCell>
                      <TableCell className="whitespace-normal">
                        <Link href={`/backoffice/kreatif/kolaborasi/${b.kolaborasiId}?tab=pembayaran`} className="font-medium text-tautan hover:underline">
                          {b.kolNama}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {b.docNo} · {b.label}
                          {b.grossUp ? ` · ${t("grossUp")}` : ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        {labelPasal(b.pasal)}
                        {!b.adaNpwp ? <span className="block text-xs text-muted-foreground">{t("tanpaNpwp")}</span> : null}
                      </TableCell>
                      <TableCell className="hidden tabular-nums xl:table-cell">{b.identitasTersamar ?? <span className="text-amber-700 dark:text-amber-300">{t("identitasKosong")}</span>}</TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">{rupiahTeks(b.bruto)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{rupiahTeks(b.dpp)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{String(b.tarifEfektifPersen).replace(".", ",")}%</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{rupiahTeks(b.pph)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">{rupiahTeks(b.neto)}</TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="flex items-center gap-1">
                          <span className={b.nomorBuktiPotong ? "tabular-nums" : "text-sm text-muted-foreground"}>{b.nomorBuktiPotong ?? t("belumAda")}</span>
                          {bolehMengelola ? (
                            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("ubahBukti", { kol: b.kolNama })} onClick={() => bukaUbah({ jenis: "bukti", baris: b })}>
                              <Pencil className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <StatusPill
                            tone={b.setorAt ? "settled" : "waiting"}
                            detail={b.setorAt ? <span className="text-xs text-muted-foreground">{labelTanggal(b.setorAt, locale)}{b.ntpn ? ` · ${b.ntpn}` : ""}</span> : undefined}
                          >
                            {b.setorAt ? t("sudahSetor") : t("belumSetor")}
                          </StatusPill>
                          {bolehMengelola ? (
                            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("ubahSetor", { kol: b.kolNama })} onClick={() => bukaUbah({ jenis: "setor", baris: b })}>
                              <Pencil className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={ubah !== null} onOpenChange={(v) => !v && !pending && setUbah(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{ubah?.jenis === "bukti" ? t("dialog.buktiJudul") : t("dialog.setorJudul")}</DialogTitle>
            <DialogDescription>{ubah ? `${ubah.baris.kolNama} · ${labelPasal(ubah.baris.pasal)} ${rupiahTeks(ubah.baris.pph)}` : null}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {ubah?.jenis === "bukti" ? (
              <div className="space-y-1.5">
                <Label htmlFor="pph-nomor">{t("dialog.nomor")}</Label>
                <Input id="pph-nomor" value={nomor} maxLength={60} onChange={(e) => setNomor(e.target.value)} />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="pph-ntpn">{t("dialog.ntpn")}</Label>
                <Input id="pph-ntpn" value={ntpn} maxLength={60} onChange={(e) => setNtpn(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pph-tanggal">{ubah?.jenis === "bukti" ? t("dialog.tanggalBukti") : t("dialog.tanggalSetor")}</Label>
              <TanggalInput id="pph-tanggal" value={tanggal} max={hariIni} required onChange={(e) => setTanggal(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {ubah && (ubah.jenis === "bukti" ? ubah.baris.nomorBuktiPotong : ubah.baris.setorAt) ? (
              <Button variant="ghost" onClick={() => simpan(true)} disabled={pending}>
                {t("dialog.hapus")}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setUbah(null)} disabled={pending}>
                {t("dialog.batal")}
              </Button>
              <Button onClick={() => simpan(false)} disabled={pending || !tanggal || (ubah?.jenis === "bukti" && !nomor.trim())}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {t("dialog.simpan")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PinAuthModal isOpen={minta} onClose={() => setMinta(false)} onConfirm={(pin) => ekspor(pin)} action={t("pinAksi")} />

      {potongPemasok && <PotongPemasokCard baris={potongPemasok} />}
    </div>
  );
}

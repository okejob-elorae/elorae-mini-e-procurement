"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ChevronDown, ChevronRight, ImageIcon, Loader2, RefreshCw, Settings2, Wallet } from "lucide-react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { batalkanBayarTerminAction, postingUlangJurnalKolAction, ubahModePajakAction } from "@/app/actions/kreatif-termin";
import { auditActionLabel } from "@/lib/audit/action-label";
import { formatDisplayDateTime } from "@/lib/date-only";
import { labelTanggal } from "@/lib/tanggal-isian";
import { rupiahTeks } from "@/lib/creative/angka-konten";
import { SEMUA_MODE_PAJAK, type ModePajak } from "@/lib/creative/pph";
import type { BarisTermin, PanelTerminData } from "@/lib/creative/termin-queries";
import { nadaBayar } from "@/lib/creative/bayar-aturan";
import { cn } from "@/lib/utils";
import { DialogAturTermin } from "./DialogAturTermin";
import { DialogBayarTermin } from "./DialogBayarTermin";
import { RincianPph } from "./RincianPph";

type Props = {
  data: PanelTerminData | null;
  hariIni: string;
  bolehMengelola: boolean;
  keuangan: boolean;
  jatuhTempoBawaan: number;
};

function Statistik({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className={cn("text-sm font-medium tabular-nums", className)}>{children}</div>
    </div>
  );
}

const objek = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Isi panel pembayaran: termin, mode pajak, rincian PPh, aksi, jurnal tertunda, riwayat. */
export function PanelBayarKlien({ data, hariIni, bolehMengelola, keuangan, jatuhTempoBawaan }: Props) {
  const t = useTranslations("kreatifRuang");
  const tAudit = useTranslations("auditActions");
  const locale = useLocale();
  const router = useRouter();
  const [terbuka, setTerbuka] = useState<Set<string>>(new Set());
  const [bayar, setBayar] = useState<BarisTermin | null>(null);
  const [atur, setAtur] = useState(false);
  const [aturKe, setAturKe] = useState(0);
  const [batal, setBatal] = useState<BarisTermin | null>(null);
  const [alasan, setAlasan] = useState("");
  const [pending, mulai] = useTransition();

  if (!data) {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground">{t("panelBayar.tidakAda")}</CardContent>
      </Card>
    );
  }

  const tanpaFee = data.fee <= 0;
  const pajak = data.pajakKol;
  const subjek = { jenis: pajak?.jenisPajak ?? "ORANG_PRIBADI", adaNpwp: pajak?.adaNpwp ?? false } as const;
  const kurangData = pajak ? pajak.jenisPajak !== "TIDAK_DIPOTONG" && !pajak.dataPajakLengkap : false;
  const dibayar = data.termin.filter((b) => b.status === "DIBAYAR");
  const belum = data.termin.filter((b) => b.status === "BELUM");

  const ganti = (id: string) =>
    setTerbuka((s) => {
      const baru = new Set(s);
      if (baru.has(id)) baru.delete(id);
      else baru.add(id);
      return baru;
    });

  const ubahMode = (mode: ModePajak) =>
    mulai(async () => {
      const r = await ubahModePajakAction({ kolaborasiId: data.kolaborasiId, mode });
      if (!r.ok) {
        toast.error(t(`termin.err.${r.kode}`));
        return;
      }
      if (r.berubah) toast.success(t(`termin.modeOk.${mode}`));
      router.refresh();
    });

  const batalkan = () =>
    mulai(async () => {
      if (!batal) return;
      const r = await batalkanBayarTerminAction({ terminId: batal.id, alasan });
      if (!r.ok) {
        toast.error(t(`termin.err.${r.kode}`));
        return;
      }
      toast.success(t("termin.batalOk", { label: batal.label }));
      setBatal(null);
      setAlasan("");
      router.refresh();
    });

  const postingUlang = () =>
    mulai(async () => {
      const r = await postingUlangJurnalKolAction(data.kolaborasiId);
      if ("kode" in r) {
        toast.error(t(`termin.err.${r.kode}`));
        return;
      }
      if (r.ok) toast.success(t("termin.jurnal.ok", { n: r.diposting }));
      else toast.error(t("termin.jurnal.gagal", { sebab: r.gagal.map((g) => (g.peran ? `${g.kode}: ${g.peran}` : g.kode)).join(", ") }));
      router.refresh();
    });

  const teksPemicu = (b: BarisTermin) =>
    b.pemicu === "TANGGAL" ? t("termin.pemicuTanggal") : t(`termin.pemicu.${b.pemicu}`, { n: b.hariSesudah });

  const ringkasRiwayat = (aksi: string, changes: unknown, metadata: unknown): string | null => {
    const sesudah = objek(objek(changes)?.after);
    const sebelum = objek(objek(changes)?.before);
    const termin = (sesudah?.termin ?? sebelum?.termin ?? objek(metadata)?.termin) as string | undefined;
    if (aksi === "KOL_PAYMENT_TERM_PAID" && sesudah) {
      return t("termin.riwayat.dibayar", { termin: termin ?? "", neto: rupiahTeks(Number(sesudah.neto ?? 0)), tanggal: labelTanggal(String(sesudah.tanggal ?? ""), locale) });
    }
    if (aksi === "KOL_PAYMENT_TERM_PAYMENT_CANCELLED") return t("termin.riwayat.dibatalkan", { termin: termin ?? "" });
    if (aksi === "KOL_COLLAB_TAX_MODE_CHANGED" && sesudah?.modePajak) return t(`termin.mode.${sesudah.modePajak as ModePajak}`);
    if (aksi === "KOL_PAYMENT_TERMS_SET" && Array.isArray(objek(changes)?.after)) {
      const daftar = objek(changes)!.after as { label: string; jumlah: number }[];
      return daftar.map((d) => `${d.label} ${rupiahTeks(d.jumlah)}`).join(" · ");
    }
    if (aksi === "KOL_PAYMENT_RECORDED" && sesudah?.payStatus) return t(`bayar.${sesudah.payStatus as "BELUM"}`);
    return termin ?? null;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" aria-hidden />
          {t("panelBayar.judul")}
        </CardTitle>
        {bolehMengelola && !tanpaFee ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAturKe((k) => k + 1);
              setAtur(true);
            }}
            disabled={belum.length === 0 && data.total.sisaNeto === 0 && dibayar.length > 0}
          >
            <Settings2 className="h-4 w-4" aria-hidden />
            {t("termin.aturTombol")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Statistik label={data.modePajak === "GROSS_UP" ? t("termin.feeNeto") : t("termin.feeBruto")}>{rupiahTeks(data.fee)}</Statistik>
          <Statistik label={t("panelBayar.status")}>
            <StatusPill tone={nadaBayar(data.payStatus)}>{t(`bayar.${data.payStatus}`)}</StatusPill>
          </Statistik>
          <Statistik label={t("panelBayar.jenis")}>{t(`jenis.${data.jenis}`)}</Statistik>
          <Statistik label={t("termin.kolom.bruto")}>{rupiahTeks(data.total.bruto)}</Statistik>
          <Statistik label={t("termin.kolom.pph")}>{rupiahTeks(data.total.pph)}</Statistik>
          <Statistik label={t("termin.kolom.neto")}>{rupiahTeks(data.total.neto)}</Statistik>
          <Statistik label={t("termin.dibayarNeto")} className="text-emerald-700 dark:text-emerald-400">
            {rupiahTeks(data.total.dibayarNeto)}
          </Statistik>
          <Statistik label={t("termin.sisaNeto")} className={data.total.sisaNeto > 0 ? "text-red-700 dark:text-red-400" : undefined}>
            {data.total.sisaNeto > 0 ? rupiahTeks(data.total.sisaNeto) : "—"}
          </Statistik>
        </div>

        {tanpaFee ? (
          <p className="text-sm text-muted-foreground">{t("panelBayar.tanpaFee")}</p>
        ) : (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("termin.modeJudul")}</p>
                <p className="text-xs text-muted-foreground">
                  {pajak ? t(`termin.subjek.${pajak.jenisPajak}`) : "—"}
                  {pajak && pajak.jenisPajak !== "TIDAK_DIPOTONG" ? ` · ${pajak.adaNpwp ? t("termin.npwpAda") : t("termin.npwpTidak")}` : ""}
                  {" · "}
                  <Link href={`/backoffice/kreatif/kol/${data.kolId}`} className="text-tautan hover:underline">
                    {t("termin.ubahDiProfil")}
                  </Link>
                </p>
              </div>
              <div role="group" aria-label={t("termin.modeJudul")} className="flex gap-1">
                {SEMUA_MODE_PAJAK.map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={data.modePajak === m ? "secondary" : "outline"}
                    aria-pressed={data.modePajak === m}
                    disabled={!bolehMengelola || pending || data.modePajak === m}
                    className={cn(data.modePajak === m && "ring-1 ring-foreground/30")}
                    onClick={() => ubahMode(m)}
                  >
                    {t(`termin.mode.${m}`)}
                  </Button>
                ))}
              </div>
            </div>
            {kurangData ? (
              <p className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300" role="status">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("termin.dataBelumLengkapPanjang")}
              </p>
            ) : null}
          </div>
        )}

        {keuangan && data.jurnalTertunda && (data.jurnalTertunda.kolaborasi || data.jurnalTertunda.sampelIds.length > 0) ? (
          <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between" role="status">
            <p className="flex items-start gap-2 text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t("termin.jurnal.tertunda", { sebab: data.jurnalTertunda.sebab.join(", ") || "—" })}
            </p>
            <Button size="sm" variant="outline" onClick={postingUlang} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
              {t("termin.jurnal.ulang")}
            </Button>
          </div>
        ) : null}
        {!data.jurnalOtomatis && !tanpaFee ? <p className="text-xs text-muted-foreground">{t("termin.jurnal.luarBuku")}</p> : null}

        {data.termin.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <span className="sr-only">{t("termin.rincianToggle")}</span>
                  </TableHead>
                  <TableHead className="min-w-[140px]">{t("termin.kolom.termin")}</TableHead>
                  <TableHead>{t("pembayaran.kolom.jatuhTempo")}</TableHead>
                  <TableHead className="hidden text-right md:table-cell">{t("termin.kolom.bruto")}</TableHead>
                  <TableHead className="hidden text-right md:table-cell">{t("termin.kolom.pph")}</TableHead>
                  <TableHead className="text-right">{t("termin.kolom.neto")}</TableHead>
                  <TableHead>{t("pembayaran.kolom.status")}</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">{t("pembayaran.kolom.aksi")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.termin.map((b) => (
                  <Fragment key={b.id}>
                    <TableRow>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-expanded={terbuka.has(b.id)}
                          aria-label={t("termin.rincianAria", { label: b.label })}
                          onClick={() => ganti(b.id)}
                        >
                          {terbuka.has(b.id) ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                        </Button>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <p className="font-medium">{b.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {teksPemicu(b)}
                          {b.grossUp ? ` · ${t("termin.grossUp")}` : ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        {b.status === "DIBAYAR" ? (
                          <span className="text-sm text-muted-foreground">—</span>
                        ) : b.jatuhTempo ? (
                          <span className={cn("text-sm tabular-nums", b.jatuhTempo.lewat && "font-medium text-red-700 dark:text-red-400")}>
                            {labelTanggal(b.jatuhTempo.tanggal, locale)}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">{t(`termin.menunggu.${b.pemicu}`)}</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{rupiahTeks(b.bruto)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{b.warisan ? "—" : rupiahTeks(b.pph)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{rupiahTeks(b.neto)}</TableCell>
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
                          {b.buktiTransferUrl ? (
                            <Button asChild variant="ghost" size="icon" aria-label={t("termin.lihatBukti")}>
                              <a href={b.buktiTransferUrl} target="_blank" rel="noopener noreferrer">
                                <ImageIcon className="h-4 w-4" aria-hidden />
                              </a>
                            </Button>
                          ) : null}
                          {bolehMengelola && b.status === "BELUM" ? (
                            <Button size="sm" onClick={() => setBayar(b)}>
                              {t("termin.bayar")}
                            </Button>
                          ) : null}
                          {bolehMengelola && b.status === "DIBAYAR" && !b.warisan ? (
                            <Button size="sm" variant="ghost" onClick={() => setBatal(b)} disabled={Boolean(b.setorAt)} title={b.setorAt ? t("termin.err.SUDAH_DISETOR") : undefined}>
                              {t("termin.batalkan")}
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                    {terbuka.has(b.id) ? (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell />
                        <TableCell colSpan={7} className="whitespace-normal">
                          <div className="grid gap-4 py-1 sm:grid-cols-2">
                            <RincianPph bruto={b.bruto} dpp={b.dpp} pph={b.pph} neto={b.neto} info={b.tarifInfo} warisan={b.warisan} />
                            <dl className="space-y-1 text-xs">
                              {b.nomorBuktiPotong ? (
                                <div className="flex justify-between gap-4">
                                  <dt className="text-muted-foreground">{t("termin.dialog.nomorBukti")}</dt>
                                  <dd>{b.nomorBuktiPotong}</dd>
                                </div>
                              ) : null}
                              {b.setorAt ? (
                                <div className="flex justify-between gap-4">
                                  <dt className="text-muted-foreground">{t("termin.disetor")}</dt>
                                  <dd>{labelTanggal(b.setorAt, locale)}</dd>
                                </div>
                              ) : null}
                              {b.catatan ? <p className="whitespace-pre-line">{b.catatan}</p> : null}
                            </dl>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : !tanpaFee ? (
          <p className="text-sm text-muted-foreground">{t("termin.kosongPanel")}</p>
        ) : null}

        <div className="space-y-2">
          <p className="text-sm font-medium">{t("panelBayar.riwayat")}</p>
          {data.riwayat.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("panelBayar.riwayatKosong")}</p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {data.riwayat.map((r) => {
                const ringkas = ringkasRiwayat(r.aksi, r.changes, r.metadata);
                return (
                  <li key={r.id} className="border-l-2 border-muted-foreground/30 pl-3 text-sm">
                    <p className="font-medium">{auditActionLabel(tAudit, r.aksi, "KolBrief")}</p>
                    {ringkas ? <p className="text-xs tabular-nums">{ringkas}</p> : null}
                    {r.reason ? <p className="whitespace-pre-line text-xs">{r.reason}</p> : null}
                    <p className="text-xs text-muted-foreground">{t("panelBayar.riwayatOleh", { waktu: formatDisplayDateTime(r.waktu, locale), nama: r.oleh })}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>

      {bayar ? (
        <DialogBayarTermin
          key={bayar.id}
          open
          onOpenChange={(v) => !v && setBayar(null)}
          termin={[bayar]}
          hariIni={hariIni}
          onSelesai={() => {
            setBayar(null);
            router.refresh();
          }}
        />
      ) : null}

      {atur ? (
        <DialogAturTermin
          key={aturKe}
          open
          onOpenChange={setAtur}
          kolaborasiId={data.kolaborasiId}
          fee={data.fee}
          mode={data.modePajak}
          subjek={subjek}
          tarif={data.tarif}
          dibayar={dibayar.map((b) => b.jumlah)}
          awal={belum.map((b) => ({ label: b.label, jumlah: b.jumlah, pemicu: b.pemicu, hariSesudah: b.hariSesudah, tanggal: b.pemicu === "TANGGAL" ? (b.jatuhTempo?.tanggal ?? null) : null }))}
          jatuhTempoBawaan={jatuhTempoBawaan}
          onSelesai={() => {
            setAtur(false);
            router.refresh();
          }}
        />
      ) : null}

      <AlertDialog open={batal !== null} onOpenChange={(o) => !o && !pending && setBatal(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("termin.batalJudul", { label: batal?.label ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{batal ? t("termin.batalIsi", { neto: rupiahTeks(batal.neto) }) : null}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="batal-termin-alasan">{t("termin.batalAlasan")}</Label>
            <Textarea id="batal-termin-alasan" rows={2} maxLength={1000} value={alasan} onChange={(e) => setAlasan(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("termin.dialog.batal")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending || !alasan.trim()}
              onClick={(e) => {
                e.preventDefault();
                batalkan();
              }}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("termin.batalkan")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

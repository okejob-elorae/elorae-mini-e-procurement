"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { Textarea } from "@/components/ui/textarea";
import { catatPembayaranAction } from "@/app/actions/kreatif-bayar";
import { formatDisplayDateTime } from "@/lib/date-only";
import { labelTanggal } from "@/lib/tanggal-isian";
import { angkaTitik, rupiahTeks } from "@/lib/creative/angka-konten";
import { bacaAngka } from "@/lib/creative/angka-masuk";
import { nadaBayar, rencanaPembayaran, type StatusDialogBayar } from "@/lib/creative/bayar-aturan";
import type { PanelBayarData, RiwayatBayar } from "@/lib/creative/bayar-queries";
import type { StatusBayar } from "@/lib/creative/tahap";
import { cn } from "@/lib/utils";

type Props = { data: PanelBayarData | null; hariIni: string; bolehMengelola: boolean };

const PILIHAN: readonly StatusDialogBayar[] = ["LUNAS", "SEBAGIAN", "BELUM"];

function Statistik({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className={cn("text-sm font-medium tabular-nums", className)}>{children}</div>
    </div>
  );
}

/** Isi panel pembayaran: angka, formulir catat bayar, dan riwayat dari jejak. */
export function PanelBayarKlien({ data, hariIni, bolehMengelola }: Props) {
  const t = useTranslations("kreatifRuang");
  const locale = useLocale();
  const router = useRouter();
  const [menyimpan, mulaiSimpan] = useTransition();
  const awal: StatusDialogBayar = data && data.payStatus !== "TIDAK_PERLU" ? data.payStatus : "LUNAS";
  const [status, setStatus] = useState<StatusDialogBayar>(awal === "BELUM" ? "LUNAS" : awal);
  const [jumlah, setJumlah] = useState(data && data.payStatus === "SEBAGIAN" && data.dibayar > 0 ? angkaTitik(data.dibayar) : "");
  // Lunas: tanggal lunasnya; selain itu cicilan baru biasanya dibayar hari ini.
  const [tanggal, setTanggal] = useState(data?.payStatus === "LUNAS" && data.paidAt ? data.paidAt : hariIni);
  const [catatan, setCatatan] = useState(data?.payNote ?? "");

  if (!data) {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground">{t("panelBayar.tidakAda")}</CardContent>
      </Card>
    );
  }

  const tanpaFee = data.fee <= 0;
  const rencana = rencanaPembayaran({ fee: data.fee, status, jumlah: bacaAngka(jumlah), tanggal: status === "BELUM" ? null : tanggal, hariIni });
  const galat = rencana.ok ? null : rencana.kode;

  const simpan = () =>
    mulaiSimpan(async () => {
      const r = await catatPembayaranAction({
        kolaborasiId: data.id,
        status,
        jumlah: status === "SEBAGIAN" ? bacaAngka(jumlah) : null,
        tanggal: status === "BELUM" ? null : tanggal,
        catatan,
      });
      if (!r.ok) {
        toast.error(t(`errBayar.${r.kode}`));
        return;
      }
      if (!r.berubah) toast(t("panelBayar.okTanpa"));
      else if (r.tahap) toast.success(t("panelBayar.okMaju", { tahap: t(`tahap.${r.tahap.ke}`) }));
      else toast.success(t("panelBayar.ok"));
      router.refresh();
    });

  const teksKeadaan = (k: RiwayatBayar["sesudah"]) => {
    if (!k?.payStatus) return "—";
    const bagian = [t(`bayar.${k.payStatus as StatusBayar}`)];
    if (typeof k.paidAmount === "number" && k.paidAmount > 0) bagian.push(rupiahTeks(k.paidAmount));
    if (k.paidAt) bagian.push(labelTanggal(k.paidAt, locale));
    return bagian.join(" · ");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" aria-hidden />
          {t("panelBayar.judul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Statistik label={t("panelBayar.fee")}>{rupiahTeks(data.fee)}</Statistik>
          <Statistik label={t("panelBayar.jenis")}>{t(`jenis.${data.jenis}`)}</Statistik>
          <Statistik label={t("panelBayar.status")}>
            <StatusPill tone={nadaBayar(data.payStatus)}>{t(`bayar.${data.payStatus}`)}</StatusPill>
          </Statistik>
          <Statistik label={t("panelBayar.dibayar")}>
            {rupiahTeks(data.dibayar)}
            {data.paidAt ? <span className="block text-xs font-normal text-muted-foreground">{labelTanggal(data.paidAt, locale)}</span> : null}
          </Statistik>
          <Statistik label={t("panelBayar.sisa")} className={data.sisa > 0 ? "text-red-700 dark:text-red-400" : undefined}>
            {data.sisa > 0 ? rupiahTeks(data.sisa) : "—"}
          </Statistik>
          <Statistik label={t("panelBayar.jatuhTempo")} className={data.jatuhTempo?.lewat ? "text-red-700 dark:text-red-400" : undefined}>
            {data.jatuhTempo ? labelTanggal(data.jatuhTempo.tanggal, locale) : "—"}
            {data.jatuhTempo?.lewat ? (
              <span className="block text-xs font-normal">{t("pembayaran.lewatHari", { n: data.jatuhTempo.lewatHari })}</span>
            ) : null}
          </Statistik>
        </div>

        {data.payNote ? (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">{t("panelBayar.catatan")}</p>
            <p className="whitespace-pre-line text-sm">{data.payNote}</p>
          </div>
        ) : null}

        {tanpaFee ? <p className="text-sm text-muted-foreground">{t("panelBayar.tanpaFee")}</p> : null}

        {bolehMengelola && !tanpaFee ? (
          <div className="space-y-3 rounded-md border p-4">
            <p className="text-sm font-medium">{t("panelBayar.formJudul")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`status-bayar-${data.id}`}>{t("panelBayar.status")}</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as StatusDialogBayar)}>
                  <SelectTrigger id={`status-bayar-${data.id}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PILIHAN.map((p) => (
                      <SelectItem key={p} value={p}>
                        {t(`bayar.${p}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {status !== "BELUM" ? (
                <div className="space-y-1.5">
                  <Label htmlFor={`tanggal-bayar-${data.id}`}>{t("panelBayar.tanggal")}</Label>
                  <TanggalInput id={`tanggal-bayar-${data.id}`} value={tanggal} max={hariIni} required onChange={(e) => setTanggal(e.target.value)} />
                </div>
              ) : null}
              {status === "SEBAGIAN" ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`jumlah-bayar-${data.id}`}>{t("panelBayar.formJumlah")}</Label>
                  <Input
                    id={`jumlah-bayar-${data.id}`}
                    inputMode="decimal"
                    value={jumlah}
                    onChange={(e) => setJumlah(e.target.value)}
                    aria-invalid={Boolean(galat && jumlah)}
                    aria-describedby={`jumlah-bayar-${data.id}-petunjuk`}
                    className="tabular-nums"
                  />
                  <p id={`jumlah-bayar-${data.id}-petunjuk`} className="text-xs text-muted-foreground">
                    {t("panelBayar.formJumlahPetunjuk")} {t("pembayaran.dialog.dariFee", { fee: rupiahTeks(data.fee) })}
                  </p>
                </div>
              ) : null}
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`catatan-bayar-${data.id}`}>{t("panelBayar.catatan")}</Label>
                <Textarea
                  id={`catatan-bayar-${data.id}`}
                  value={catatan}
                  maxLength={1000}
                  rows={2}
                  placeholder={t("panelBayar.formCatatanPh")}
                  onChange={(e) => setCatatan(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              {galat && (status !== "SEBAGIAN" || jumlah) ? <p className="text-xs text-destructive sm:mr-auto">{t(`errBayar.${galat}`)}</p> : null}
              <Button onClick={simpan} disabled={Boolean(galat) || menyimpan}>
                {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {menyimpan ? t("panelBayar.menyimpan") : t("panelBayar.simpan")}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-sm font-medium">{t("panelBayar.riwayat")}</p>
          {data.riwayat.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("panelBayar.riwayatKosong")}</p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {data.riwayat.map((r) => (
                <li key={r.id} className="border-l-2 border-muted-foreground/30 pl-3 text-sm">
                  <p className="tabular-nums">
                    <span className="text-muted-foreground">{teksKeadaan(r.sebelum)}</span>
                    {" → "}
                    <span className="font-medium">{teksKeadaan(r.sesudah)}</span>
                  </p>
                  {r.sesudah?.payNote && r.sesudah.payNote !== r.sebelum?.payNote ? (
                    <p className="whitespace-pre-line text-xs">{r.sesudah.payNote}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {t("panelBayar.riwayatOleh", { waktu: formatDisplayDateTime(r.waktu, locale), nama: r.oleh })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

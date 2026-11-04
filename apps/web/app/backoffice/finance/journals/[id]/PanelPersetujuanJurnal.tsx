"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, Loader2, Pencil, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/ui/status-pill";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { Textarea } from "@/components/ui/textarea";
import { formatDisplayDateTime } from "@/lib/date-only";
import { aksiJurnalManual, MIN_ALASAN_JURNAL } from "@/lib/finance/jurnal-manual/aturan";
import type { InfoPersetujuanJurnal } from "@/lib/finance/jurnal-manual/queries";
import { approveManualJournalAction, rejectManualJournalAction, reverseManualJournalAction } from "@/app/actions/journals";

type Props = {
  info: InfoPersetujuanJurnal;
  penggunaId: string;
  bolehMengelola: boolean;
  hariIni: string;
};

type Dialog = "tolak" | "balik" | null;

/**
 * Status persetujuan jurnal manual (dan jurnal berulang yang bisa dibalik):
 * siapa membuat / menyetujui / menolak, tautan pembalik, dan tombolnya —
 * menurut `aksiJurnalManual`, aturan yang sama dengan penulisnya.
 */
export function PanelPersetujuanJurnal({ info, penggunaId, bolehMengelola, hariIni }: Props) {
  const t = useTranslations("financeJournals.persetujuan");
  const locale = useLocale();
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [alasan, setAlasan] = useState("");
  const [tanggal, setTanggal] = useState(hariIni < info.tanggal ? info.tanggal : hariIni);

  const aksi = aksiJurnalManual({
    status: info.status,
    isManual: info.isManual,
    sourceType: info.sourceType,
    pembuatId: info.pembuatId,
    penontonId: penggunaId,
    bolehMengelola,
    adaPembalik: !!info.dibalikOleh,
    adalahPembalik: !!info.pembalikDari,
  });
  const relevan = info.isManual || aksi.balik || !!info.dibalikOleh;
  if (!relevan) return null;

  const pesan = (kode: string) => (t.has(`err.${kode}`) ? t(`err.${kode}` as never) : t("err.GAGAL"));
  const jalankan = (fn: () => Promise<{ ok: boolean; code?: string; journalId?: string }>, sukses: string, keJurnal?: boolean) =>
    mulai(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(pesan(r.code ?? "GAGAL"));
        return;
      }
      toast.success(sukses);
      setDialog(null);
      setAlasan("");
      if (keJurnal && r.journalId) router.push(`/backoffice/finance/journals/${r.journalId}`);
      router.refresh();
    });

  const tarik = aksi.tarik;
  const alasanKurang = alasan.trim().length < MIN_ALASAN_JURNAL;
  const nada = info.status === "POSTED" ? "settled" : info.status === "DRAFT" ? "waiting" : "attention";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          {t("judul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={nada}>{t(`status.${info.status}` as never)}</StatusPill>
          {info.status === "DRAFT" && aksi.alasanTidakBisaSetujui === "PEMBUAT_SAMA" ? (
            <span className="text-sm text-muted-foreground">{t("menungguOrangLain")}</span>
          ) : null}
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">{t("dibuatOleh")}</dt>
            <dd>{info.pembuatNama ?? "—"}</dd>
          </div>
          {info.disetujuiNama ? (
            <div>
              <dt className="text-muted-foreground">{t("disetujuiOleh")}</dt>
              <dd>
                {info.disetujuiNama}
                {info.disetujuiPada ? ` · ${formatDisplayDateTime(info.disetujuiPada, locale)}` : ""}
              </dd>
            </div>
          ) : null}
          {info.ditolakNama ? (
            <div>
              <dt className="text-muted-foreground">{info.ditolakNama === info.pembuatNama ? t("ditarikOleh") : t("ditolakOleh")}</dt>
              <dd>
                {info.ditolakNama}
                {info.ditolakPada ? ` · ${formatDisplayDateTime(info.ditolakPada, locale)}` : ""}
              </dd>
            </div>
          ) : null}
          {info.alasanTolak ? (
            <div className="sm:col-span-3">
              <dt className="text-muted-foreground">{t("alasan")}</dt>
              <dd className="whitespace-pre-line">{info.alasanTolak}</dd>
            </div>
          ) : null}
          {info.pembalikDari ? (
            <div className="sm:col-span-3">
              <dt className="text-muted-foreground">{t("membalik")}</dt>
              <dd>
                <Link href={`/backoffice/finance/journals/${info.pembalikDari.id}`} className="underline underline-offset-4">
                  {info.pembalikDari.keterangan}
                </Link>
              </dd>
            </div>
          ) : null}
          {info.dibalikOleh ? (
            <div className="sm:col-span-3">
              <dt className="text-muted-foreground">{info.dibalikOleh.status === "DRAFT" ? t("pembalikMenunggu") : t("dibalikOleh")}</dt>
              <dd>
                <Link href={`/backoffice/finance/journals/${info.dibalikOleh.id}`} className="underline underline-offset-4">
                  {info.dibalikOleh.keterangan}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>

        {aksi.setujui || aksi.tolak || aksi.tarik || aksi.ubah || aksi.balik ? (
          <div className="flex flex-wrap gap-2">
            {aksi.setujui ? (
              <Button disabled={pending} onClick={() => jalankan(() => approveManualJournalAction({ id: info.id }), t("berhasilSetujui"))}>
                {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                {t("setujui")}
              </Button>
            ) : null}
            {aksi.tolak || aksi.tarik ? (
              <Button variant="outline" disabled={pending} onClick={() => setDialog("tolak")}>
                <XCircle className="mr-2 h-4 w-4" />
                {tarik ? t("tarik") : t("tolak")}
              </Button>
            ) : null}
            {aksi.ubah ? (
              <Button variant="outline" asChild>
                <Link href={`/backoffice/finance/journals/${info.id}/ubah`}>
                  <Pencil className="mr-2 h-4 w-4" />
                  {t("ubahDraf")}
                </Link>
              </Button>
            ) : null}
            {aksi.balik ? (
              <Button variant="outline" disabled={pending} onClick={() => setDialog("balik")}>
                <RotateCcw className="mr-2 h-4 w-4" />
                {t("balik")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>

      <Dialog open={dialog !== null} onOpenChange={(v) => !pending && !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === "balik" ? t("balikJudul") : tarik ? t("tarikJudul") : t("tolakJudul")}</DialogTitle>
            <DialogDescription>{dialog === "balik" ? t("balikIsi") : tarik ? t("tarikIsi") : t("tolakIsi")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {dialog === "balik" ? (
              <div className="space-y-1.5">
                <Label htmlFor="tanggal-balik">{t("tanggalBalik")}</Label>
                <TanggalInput id="tanggal-balik" value={tanggal} min={info.tanggal} required onChange={(e) => setTanggal(e.target.value)} disabled={pending} />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="alasan-jurnal">{t("alasan")}</Label>
              <Textarea id="alasan-jurnal" rows={3} maxLength={2000} value={alasan} onChange={(e) => setAlasan(e.target.value)} disabled={pending} />
              {alasanKurang ? <p className="text-xs text-muted-foreground">{t("err.ALASAN_WAJIB")}</p> : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={pending}>
              {t("batal")}
            </Button>
            <Button
              variant={dialog === "balik" ? "default" : "destructive"}
              disabled={pending || alasanKurang || (dialog === "balik" && !tanggal)}
              onClick={() =>
                dialog === "balik"
                  ? jalankan(() => reverseManualJournalAction({ id: info.id, date: tanggal, reason: alasan }), t("berhasilBalik"), true)
                  : jalankan(() => rejectManualJournalAction({ id: info.id, reason: alasan }), tarik ? t("berhasilTarik") : t("berhasilTolak"))
              }
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dialog === "balik" ? t("ajukanBalik") : tarik ? t("tarik") : t("tolak")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Copy, Link2, Loader2, MessageCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import {
  buatLinkFormulirKolAction,
  cabutLinkFormulirKolAction,
  kembalikanKolomKirimanAction,
  tandaiKirimanDicekAction,
  type HasilBuatLinkAksi,
} from "@/app/actions/formulir-kol";
import { catatKirimWaAction } from "@/app/actions/kreatif-wa";
import type { RingkasFormulirKol } from "@/lib/creative/formulir-kol-queries";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import { tautanWa } from "@/lib/creative/wa";

type LinkBaru = Extract<HasilBuatLinkAksi, { ok: true }>;

export function KartuFormulirKolKlien({ kolId, data, bolehMengelola }: { kolId: string; data: RingkasFormulirKol; bolehMengelola: boolean }) {
  const t = useTranslations("kreatifRuang.formulirKol");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [baru, setBaru] = useState<LinkBaru | null>(null);
  const [pending, mulai] = useTransition();

  const gagal = (kode: string) => {
    toast.error(t.has(`err.${kode}`) ? td(`err.${kode}`) : t("err.GAGAL"));
  };

  const buat = () =>
    mulai(async () => {
      const r = await buatLinkFormulirKolAction({ kolId, asal: window.location.origin });
      if (!r.ok) return gagal(r.kode);
      setBaru(r);
      router.refresh();
    });

  const salin = async (teks: string, pesanBerhasil: string) => {
    try {
      await navigator.clipboard.writeText(teks);
      toast.success(pesanBerhasil);
    } catch {
      toast.error(t("err.SALIN"));
    }
  };

  const kirimWa = (l: LinkBaru) => {
    const url = tautanWa(l.nomor, l.pesan);
    if (!url) return;
    // Dibuka sinkron di klik (pemblokir pop-up); kontaknya dicatat sesudahnya.
    window.open(url, "_blank", "noopener,noreferrer");
    void catatKirimWaAction({ kolId, templateNama: l.templateNama }).then(() => router.refresh());
  };

  const cabut = (linkId: string) =>
    mulai(async () => {
      const r = await cabutLinkFormulirKolAction({ linkId, kolId });
      if (!r.ok) return gagal(r.kode);
      setBaru(null);
      toast.success(t("dicabut"));
      router.refresh();
    });

  const dicek = (submissionId: string) =>
    mulai(async () => {
      const r = await tandaiKirimanDicekAction({ submissionId, kolId });
      if (!r.ok) return gagal(r.kode);
      router.refresh();
    });

  const kembalikan = (submissionId: string, kolom: string) =>
    mulai(async () => {
      const r = await kembalikanKolomKirimanAction({ submissionId, kolId, kolom });
      if (!r.ok) return gagal(r.kode);
      toast.success(t("dikembalikan"));
      router.refresh();
    });

  const aktif = data.linkAktif;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" aria-hidden />
            {t("judul")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {aktif
              ? t("aktif", {
                  tanggal: formatDisplayDate(aktif.berlakuSampai, locale),
                  dibuka: aktif.terakhirDibuka ? formatDisplayDateTime(aktif.terakhirDibuka, locale) : t("belumDibuka"),
                })
              : t("tidakAdaLink")}
          </p>
        </div>
        {bolehMengelola ? (
          <div className="flex flex-wrap justify-end gap-2">
            {aktif ? (
              <Button size="sm" variant="ghost" onClick={() => cabut(aktif.id)} disabled={pending}>
                {t("cabut")}
              </Button>
            ) : null}
            <Button size="sm" onClick={buat} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {aktif ? t("buatBaru") : t("buat")}
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {baru ? (
          <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
            <p className="text-sm font-medium">{t("linkSiap")}</p>
            <Input readOnly value={baru.link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" aria-label={t("judul")} />
            <div className="flex flex-wrap gap-2">
              {baru.nomor ? (
                <Button size="sm" onClick={() => kirimWa(baru)}>
                  <MessageCircle className="h-4 w-4" aria-hidden />
                  {t("kirimWa")}
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => salin(baru.link, t("linkDisalin"))}>
                <Copy className="h-4 w-4" aria-hidden />
                {t("salinLink")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => salin(baru.pesan, t("pesanDisalin"))}>
                <Copy className="h-4 w-4" aria-hidden />
                {t("salinPesan")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{baru.nomor ? t("sekaliTampil") : t("tanpaWa")}</p>
          </div>
        ) : null}

        {data.kiriman.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("belumAdaKiriman")}</p>
        ) : (
          <ul className="space-y-3">
            {data.kiriman.map((k) => (
              <li key={k.id} className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{t("kirimanPada", { waktu: formatDisplayDateTime(k.dikirim, locale) })}</p>
                  <div className="flex items-center gap-2">
                    {k.menimpa > 0 ? <StatusPill tone="attention">{t("menimpaN", { n: k.menimpa })}</StatusPill> : null}
                    {k.dicek ? <StatusPill tone="settled">{t("sudahDicek")}</StatusPill> : <StatusPill tone="waiting">{t("belumDicek")}</StatusPill>}
                  </div>
                </div>
                <dl className="space-y-1 text-sm">
                  {k.perubahan.map((p) => (
                    <div key={p.kolom} className="flex flex-wrap items-baseline gap-x-2">
                      <dt className="text-muted-foreground">{td(`kolom.${p.kolom}`)}</dt>
                      <dd className="min-w-0 flex-1 whitespace-pre-line">
                        {p.menimpa ? <span className="text-muted-foreground line-through">{p.sebelum}</span> : null}
                        {p.menimpa ? " → " : null}
                        <span className={p.dikembalikan ? "text-muted-foreground line-through" : "font-medium"}>{p.sesudah}</span>
                        {p.dikembalikan ? <span className="text-muted-foreground"> · {t("sudahDikembalikan")}</span> : null}
                        {bolehMengelola && p.menimpa && !p.dikembalikan ? (
                          <Button size="sm" variant="link" className="h-auto px-1 py-0 text-xs" onClick={() => kembalikan(k.id, p.kolom)} disabled={pending}>
                            <RotateCcw className="h-3 w-3" aria-hidden />
                            {t("kembalikan")}
                          </Button>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                  {k.sensitif.length ? (
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <dt className="text-muted-foreground">{t("kolom.rekening")}</dt>
                      <dd>{t("sensitifDiisi", { daftar: k.sensitif.map((s) => td(`sensitif.${s}`)).join(", ") })}</dd>
                    </div>
                  ) : null}
                </dl>
                {k.npwpBaru ? (
                  <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    {t("npwpBaru")}
                  </p>
                ) : null}
                {bolehMengelola && !k.dicek ? (
                  <Button size="sm" variant="outline" onClick={() => dicek(k.id)} disabled={pending}>
                    {t("tandaiDicek")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

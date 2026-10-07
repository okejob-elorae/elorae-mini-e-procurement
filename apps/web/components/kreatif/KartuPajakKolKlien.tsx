"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, Copy, Eye, KeyRound, Loader2, Pencil, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PinAuthModal } from "@/components/security/PinAuthModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { bukaDataSensitifKolAction, simpanDataSensitifKolAction, simpanPajakKolAction } from "@/app/actions/kreatif-pajak";
import { SEMUA_JENIS_PAJAK, type JenisPajak } from "@/lib/creative/pph";
import type { RingkasPajakKol } from "@/lib/creative/pajak-kol-queries";

type Kolom = "bankName" | "bankAccount" | "bankHolder" | "nik" | "npwp";
const KOLOM: readonly Kolom[] = ["bankName", "bankAccount", "bankHolder", "nik", "npwp"];

/**
 * Pajak & rekening satu KOL. Nilai lengkap rekening/NIK/NPWP TIDAK PERNAH
 * dikirim ke layar ini kecuali lewat "Buka data lengkap" (keuangan + PIN,
 * dicatat di jejak); mengisi bersifat tulis-saja.
 */
export function KartuPajakKolKlien({ data, bolehMengelola, bolehBuka }: { data: RingkasPajakKol; bolehMengelola: boolean; bolehBuka: boolean }) {
  const t = useTranslations("kreatifRuang.pajakKol");
  const tt = useTranslations("kreatifRuang.termin");
  const router = useRouter();
  const [ubahSubjek, setUbahSubjek] = useState(false);
  const [ubahData, setUbahData] = useState(false);
  const [minta, setMinta] = useState(false);
  const [terbuka, setTerbuka] = useState<Record<Kolom, string | null> | null>(null);
  const [pending, mulai] = useTransition();

  // Isian subjek pajak.
  const [jenis, setJenis] = useState<JenisPajak>(data.jenisPajak);
  const [alasan, setAlasan] = useState(data.alasanTidakDipotong ?? "");
  const [npwp, setNpwp] = useState(data.adaNpwp);
  const [grossUp, setGrossUp] = useState(data.grossUpBawaan);

  // Isian data sensitif (tulis-saja).
  const kosong: Record<Kolom, string> = { bankName: "", bankAccount: "", bankHolder: "", nik: "", npwp: "" };
  const [isi, setIsi] = useState<Record<Kolom, string>>(kosong);
  const [hapus, setHapus] = useState<Record<Kolom, boolean>>({ bankName: false, bankAccount: false, bankHolder: false, nik: false, npwp: false });

  const simpanSubjek = () =>
    mulai(async () => {
      const r = await simpanPajakKolAction({ kolId: data.kolId, jenisPajak: jenis, alasanTidakDipotong: alasan, adaNpwp: npwp, grossUpBawaan: grossUp });
      if (!r.ok) {
        toast.error(t(`err.${r.kode}`));
        return;
      }
      toast.success(r.dihitungUlang > 0 ? t("subjekOkHitung", { n: r.dihitungUlang }) : t("subjekOk"));
      setUbahSubjek(false);
      router.refresh();
    });

  const simpanData = () =>
    mulai(async () => {
      const kirim: Partial<Record<Kolom, string | null>> = {};
      for (const k of KOLOM) {
        if (hapus[k]) kirim[k] = null;
        else if (isi[k].trim()) kirim[k] = isi[k];
      }
      const r = await simpanDataSensitifKolAction({ kolId: data.kolId, isi: kirim });
      if (!r.ok) {
        toast.error("kolom" in r && r.kolom ? `${t(`kolom.${r.kolom}`)}: ${t(`err.${r.kode}`)}` : t(`err.${r.kode}`));
        return;
      }
      toast.success(t("dataOk"));
      setIsi(kosong);
      setUbahData(false);
      router.refresh();
    });

  const buka = async (pin: string) => {
    const r = await bukaDataSensitifKolAction({ kolId: data.kolId, pin });
    if (!r.ok) {
      const pesan = r.kode === "PIN" && "pesan" in r ? t(`pin.${r.pesan}`) : t(`err.${r.kode}`);
      throw new Error(pesan);
    }
    setTerbuka(r.isi);
  };

  const salin = async (nilai: string) => {
    try {
      await navigator.clipboard.writeText(nilai);
      toast.success(t("disalin"));
    } catch {
      toast.error(t("gagalSalin"));
    }
  };

  const rekening = data.bankLast4 ? t("rekeningTersamar", { bank: data.bankNama ?? t("bank"), last4: data.bankLast4 }) : t("belumDiisi");
  const baris = (label: string, nilai: React.ReactNode) => (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{nilai}</dd>
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          {t("judul")}
        </CardTitle>
        <StatusPill tone={data.jenisPajak === "TIDAK_DIPOTONG" || data.dataPajakLengkap ? "settled" : "waiting"}>
          {data.dataPajakLengkap ? t("lengkap") : t("belumLengkap")}
        </StatusPill>
      </CardHeader>
      <CardContent className="space-y-3">
        {!data.kunciTersedia ? (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300" role="status">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("tanpaKunci")}
          </p>
        ) : null}
        <dl>
          {baris(t("subjek"), tt(`subjek.${data.jenisPajak}`))}
          {data.jenisPajak === "TIDAK_DIPOTONG" && data.alasanTidakDipotong ? baris(t("alasan"), data.alasanTidakDipotong) : null}
          {data.jenisPajak !== "TIDAK_DIPOTONG" ? baris(t("npwpStatus"), data.adaNpwp ? t("npwpYa") : t("npwpTidak")) : null}
          {baris(t("grossUpBawaan"), data.grossUpBawaan ? t("ya") : t("tidak"))}
          {baris(t("rekening"), <span className="tabular-nums">{rekening}{data.ada.bankHolder ? ` · ${t("atasNamaAda")}` : ""}</span>)}
          {baris(t("kolom.nik"), <span className="tabular-nums">{data.nikLast4 ? `••••${data.nikLast4}` : t("belumDiisi")}</span>)}
          {baris(t("kolom.npwp"), data.ada.npwp ? t("tersimpan") : t("belumDiisi"))}
        </dl>
        <div className="flex flex-wrap gap-2">
          {bolehMengelola ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setUbahSubjek(true)}>
                <Pencil className="h-4 w-4" aria-hidden />
                {t("ubahSubjek")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setUbahData(true)} disabled={!data.kunciTersedia}>
                <KeyRound className="h-4 w-4" aria-hidden />
                {t("isiData")}
              </Button>
            </>
          ) : null}
          {bolehBuka ? (
            <Button size="sm" variant="outline" onClick={() => setMinta(true)} disabled={!data.kunciTersedia}>
              <Eye className="h-4 w-4" aria-hidden />
              {t("buka")}
            </Button>
          ) : null}
        </div>
      </CardContent>

      <Dialog open={ubahSubjek} onOpenChange={(v) => !pending && setUbahSubjek(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("ubahSubjek")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pajak-kol-jenis">{t("subjek")}</Label>
              <Select value={jenis} onValueChange={(v) => setJenis(v as JenisPajak)}>
                <SelectTrigger id="pajak-kol-jenis" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEMUA_JENIS_PAJAK.map((j) => (
                    <SelectItem key={j} value={j}>
                      {tt(`subjek.${j}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {jenis === "TIDAK_DIPOTONG" ? (
              <div className="space-y-1.5">
                <Label htmlFor="pajak-kol-alasan">{t("alasan")}</Label>
                <Textarea id="pajak-kol-alasan" rows={2} maxLength={1000} value={alasan} onChange={(e) => setAlasan(e.target.value)} />
              </div>
            ) : (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={npwp} onCheckedChange={(v) => setNpwp(v === true)} className="mt-0.5" />
                <span>{t("npwpCentang")}</span>
              </label>
            )}
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={grossUp} onCheckedChange={(v) => setGrossUp(v === true)} className="mt-0.5" />
              <span>{t("grossUpCentang")}</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUbahSubjek(false)} disabled={pending}>
              {tt("dialog.batal")}
            </Button>
            <Button onClick={simpanSubjek} disabled={pending || (jenis === "TIDAK_DIPOTONG" && !alasan.trim())}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("simpan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ubahData} onOpenChange={(v) => !pending && setUbahData(v)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("isiData")}</DialogTitle>
            <DialogDescription>{t("isiDataDesk")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {KOLOM.map((k) => {
              const ada = data.ada[k];
              return (
                <div key={k} className="space-y-1.5">
                  <Label htmlFor={`sensitif-${k}`}>{t(`kolom.${k}`)}</Label>
                  <Input
                    id={`sensitif-${k}`}
                    value={isi[k]}
                    autoComplete="off"
                    inputMode={k === "bankName" || k === "bankHolder" ? "text" : "numeric"}
                    placeholder={ada ? t("placeholderAda") : ""}
                    disabled={hapus[k]}
                    onChange={(e) => setIsi((x) => ({ ...x, [k]: e.target.value }))}
                  />
                  {ada ? (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox checked={hapus[k]} onCheckedChange={(v) => setHapus((x) => ({ ...x, [k]: v === true }))} />
                      {t("hapusKolom")}
                    </label>
                  ) : null}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUbahData(false)} disabled={pending}>
              {tt("dialog.batal")}
            </Button>
            <Button onClick={simpanData} disabled={pending || !KOLOM.some((k) => hapus[k] || isi[k].trim())}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("simpan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PinAuthModal isOpen={minta} onClose={() => setMinta(false)} onConfirm={buka} action={t("pinAksi")} />

      <Dialog open={terbuka !== null} onOpenChange={(v) => !v && setTerbuka(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("dataLengkap")}</DialogTitle>
            <DialogDescription>{t("dataLengkapDesk")}</DialogDescription>
          </DialogHeader>
          {terbuka ? (
            <dl className="space-y-2">
              {KOLOM.map((k) => (
                <div key={k} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{t(`kolom.${k}`)}</dt>
                    <dd className="break-all font-medium tabular-nums">{terbuka[k] ?? "—"}</dd>
                  </div>
                  {terbuka[k] ? (
                    <Button variant="ghost" size="icon" aria-label={t("salin", { kolom: t(`kolom.${k}`) })} onClick={() => salin(terbuka[k]!)}>
                      <Copy className="h-4 w-4" aria-hidden />
                    </Button>
                  ) : null}
                </div>
              ))}
            </dl>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setTerbuka(null)}>{t("tutup")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

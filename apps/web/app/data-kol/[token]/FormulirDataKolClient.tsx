"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, Loader2, Lock, MapPin, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { kirimFormulirKolAction } from "@/app/actions/formulir-kol";
import { ISIAN_KOSONG, type GalatFormulir, type IsianFormulirKol } from "@/lib/creative/formulir-kol-aturan";
import type { DataFormulirPublik } from "@/lib/creative/formulir-kol-writer";
import { formatDisplayDate } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";

/** Urutan isian di layar — galat pertama di urutan ini yang digulir ke pandangan. */
const URUTAN: (keyof IsianFormulirKol)[] = [
  "recipientName",
  "phone",
  "email",
  "address",
  "city",
  "province",
  "postalCode",
  "atasan",
  "bawahan",
  "tinggi",
  "hijab",
  "catatanFit",
  "bankName",
  "bankAccount",
  "bankHolder",
  "nik",
  "npwp",
  "setuju",
];

export function FormulirDataKolClient({ token, data, brand }: { token: string; data: DataFormulirPublik; brand: string }) {
  const t = useTranslations("formulirKol");
  const td = dinamis(t);
  const locale = useLocale();
  const [isian, setIsian] = useState<IsianFormulirKol>({ ...ISIAN_KOSONG, ...data.isian });
  const [galat, setGalat] = useState<GalatFormulir>({});
  const [pesan, setPesan] = useState<string | null>(null);
  const [selesai, setSelesai] = useState<number | null>(null);
  const [mengirim, mulai] = useTransition();
  const akar = useRef<HTMLFormElement>(null);

  const ubah = (u: Partial<IsianFormulirKol>) => {
    setIsian((s) => ({ ...s, ...u }));
    // Galat isian yang diubah hilang begitu diketik ulang.
    setGalat((g) => {
      const baru = { ...g };
      for (const k of Object.keys(u) as (keyof IsianFormulirKol)[]) delete baru[k];
      return baru;
    });
  };

  const teksGalat = (k: keyof IsianFormulirKol) => {
    const kode = galat[k];
    if (!kode) return null;
    return t.has(`galat.${kode}`) ? td(`galat.${kode}`) : t("galat.TIDAK_SAH");
  };

  const kirim = (e: React.FormEvent) => {
    e.preventDefault();
    setPesan(null);
    mulai(async () => {
      const r = await kirimFormulirKolAction(token, isian);
      if (r.ok) {
        setSelesai(r.berubah);
        window.scrollTo({ top: 0 });
        return;
      }
      if (r.kode === "ISIAN_TIDAK_SAH") {
        setGalat(r.galat);
        setPesan(t("periksaLagi"));
        const pertama = URUTAN.find((k) => r.galat[k]);
        if (pertama) akar.current?.querySelector<HTMLElement>(`[data-isian="${pertama}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      setPesan(td(`gagal.${r.kode}`));
    });
  };

  if (selesai !== null) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full py-0">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <CheckCircle2 className="h-6 w-6" aria-hidden />
            </span>
            <h1 className="text-lg font-semibold">{t("terimaKasih.judul")}</h1>
            <p className="text-sm text-muted-foreground">{selesai > 0 ? t("terimaKasih.isi", { brand }) : t("terimaKasih.tanpaUbahan")}</p>
            <p className="text-xs text-muted-foreground">{t("terimaKasih.ubahLagi", { tanggal: formatDisplayDate(data.berlakuSampai, locale) })}</p>
            <Button type="button" variant="outline" onClick={() => setSelesai(null)}>
              {t("terimaKasih.lihatLagi")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const bidang = (k: keyof IsianFormulirKol, label: string, el: ReactNode, opsi: { wajib?: boolean; petunjuk?: string } = {}) => (
    <div className="space-y-1.5" data-isian={k}>
      <Label htmlFor={`isian-${k}`}>
        {label}
        {opsi.wajib ? <span className="text-destructive"> *</span> : <span className="font-normal text-muted-foreground"> {t("opsional")}</span>}
      </Label>
      {el}
      {opsi.petunjuk ? <p className="text-xs text-muted-foreground">{opsi.petunjuk}</p> : null}
      {teksGalat(k) ? <p className="text-xs text-destructive">{teksGalat(k)}</p> : null}
    </div>
  );
  const masukan = (k: keyof IsianFormulirKol, props: React.ComponentProps<typeof Input> = {}) => (
    <Input
      id={`isian-${k}`}
      value={String(isian[k] ?? "")}
      aria-invalid={Boolean(galat[k])}
      onChange={(e) => ubah({ [k]: e.target.value } as Partial<IsianFormulirKol>)}
      {...props}
    />
  );
  const judulBagian = (ikon: ReactNode, teks: string) => (
    <CardHeader className="pb-0">
      <CardTitle className="flex items-center gap-2 text-base">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">{ikon}</span>
        {teks}
      </CardTitle>
    </CardHeader>
  );

  return (
    <form ref={akar} onSubmit={kirim} className="flex flex-1 flex-col gap-4 p-4" noValidate>
      <header className="space-y-1 pt-2">
        <p className="text-sm font-semibold text-primary">{brand}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t("judul")}</h1>
        <p className="text-sm text-muted-foreground">{t("pembuka", { nama: data.namaKol, brand })}</p>
        <p className="text-xs text-muted-foreground">{t("berlaku", { tanggal: formatDisplayDate(data.berlakuSampai, locale) })}</p>
      </header>

      <Card className="gap-4">
        {judulBagian(<MapPin className="h-4 w-4" aria-hidden />, t("bagian.kirim"))}
        <CardContent className="space-y-4">
          {bidang("recipientName", t("isian.recipientName"), masukan("recipientName", { autoComplete: "name" }), { wajib: true })}
          {bidang("phone", t("isian.phone"), masukan("phone", { inputMode: "tel", autoComplete: "tel", placeholder: "0812…" }), { wajib: true })}
          {bidang("email", t("isian.email"), masukan("email", { type: "email", inputMode: "email", autoComplete: "email" }))}
          {bidang(
            "address",
            t("isian.address"),
            <Textarea
              id="isian-address"
              rows={4}
              autoComplete="street-address"
              value={isian.address}
              aria-invalid={Boolean(galat.address)}
              onChange={(e) => ubah({ address: e.target.value })}
            />,
            { wajib: true, petunjuk: t("petunjuk.address") },
          )}
          {bidang("city", t("isian.city"), masukan("city", { autoComplete: "address-level2" }), { wajib: true })}
          {bidang("province", t("isian.province"), masukan("province", { autoComplete: "address-level1" }))}
          {bidang("postalCode", t("isian.postalCode"), masukan("postalCode", { inputMode: "numeric", autoComplete: "postal-code", maxLength: 6 }), { wajib: true })}
        </CardContent>
      </Card>

      <Card className="gap-4">
        {judulBagian(<Ruler className="h-4 w-4" aria-hidden />, t("bagian.ukuran"))}
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {bidang("atasan", t("isian.atasan"), masukan("atasan", { placeholder: t("contoh.atasan") }))}
            {bidang("bawahan", t("isian.bawahan"), masukan("bawahan", { placeholder: t("contoh.bawahan") }))}
            {bidang("tinggi", t("isian.tinggi"), masukan("tinggi", { inputMode: "numeric", placeholder: "160" }))}
            {bidang(
              "hijab",
              t("isian.hijab"),
              <Select value={isian.hijab || "kosong"} onValueChange={(v) => ubah({ hijab: v === "kosong" ? "" : (v as "ya" | "tidak") })}>
                <SelectTrigger id="isian-hijab" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kosong">—</SelectItem>
                  <SelectItem value="ya">{t("hijab.ya")}</SelectItem>
                  <SelectItem value="tidak">{t("hijab.tidak")}</SelectItem>
                </SelectContent>
              </Select>,
            )}
          </div>
          {bidang("catatanFit", t("isian.catatanFit"), masukan("catatanFit", { placeholder: t("contoh.catatanFit") }))}
        </CardContent>
      </Card>

      {data.bolehSensitif ? (
        <Card className="gap-4">
          {judulBagian(<Lock className="h-4 w-4" aria-hidden />, t("bagian.rekening"))}
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">{t("petunjuk.rekening")}</p>
            {data.tersimpan.rekeningAkhir !== null ? (
              <p className="rounded-md bg-muted px-3 py-2 text-xs">{t("tersimpan.rekening", { akhir: data.tersimpan.rekeningAkhir })}</p>
            ) : null}
            {bidang("bankName", t("isian.bankName"), masukan("bankName", { placeholder: t("contoh.bankName") }))}
            {bidang("bankAccount", t("isian.bankAccount"), masukan("bankAccount", { inputMode: "numeric", autoComplete: "off" }))}
            {bidang("bankHolder", t("isian.bankHolder"), masukan("bankHolder", { autoComplete: "off" }))}
            {bidang("nik", t("isian.nik"), masukan("nik", { inputMode: "numeric", autoComplete: "off" }), {
              petunjuk: data.tersimpan.nikAkhir ? t("tersimpan.nik", { akhir: data.tersimpan.nikAkhir }) : t("petunjuk.nik"),
            })}
            {bidang("npwp", t("isian.npwp"), masukan("npwp", { inputMode: "numeric", autoComplete: "off" }), {
              petunjuk: data.tersimpan.npwp ? t("tersimpan.npwp") : t("petunjuk.npwp"),
            })}
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-1.5" data-isian="setuju">
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={isian.setuju} onCheckedChange={(v) => ubah({ setuju: v === true })} aria-invalid={Boolean(galat.setuju)} className="mt-0.5" />
          <span>{t("setuju", { brand })}</span>
        </label>
        {teksGalat("setuju") ? <p className="text-xs text-destructive">{teksGalat("setuju")}</p> : null}
      </div>

      <div className="mt-auto space-y-2 pb-4">
        {pesan ? (
          <p role="alert" className="text-sm text-destructive">
            {pesan}
          </p>
        ) : null}
        <Button type="submit" className="w-full" size="lg" disabled={mengirim}>
          {mengirim ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {t("kirim")}
        </Button>
      </div>
    </form>
  );
}

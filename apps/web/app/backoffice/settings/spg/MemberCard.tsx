"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, BadgeCheck, Loader2, Plus, Trash2 } from "lucide-react";
import { simpanAturanMemberSpg } from "@/app/actions/settings/spg-member";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { dinamis } from "@/lib/i18n/dinamis";
import { MAKS_TINGKAT, MEMBER_BAWAAN, sahkanAturanMember, type AturanMember } from "@/lib/spg/member";
import { cn } from "@/lib/utils";
import { aturanDariIsian, isianDariAturan, salahIsian, type BarisTingkatIsian, type IsianMember } from "./member-isian";

let urutBaris = 0;
const kunciBaru = () => `baru-${++urutBaris}`;

/**
 * Program member & pelacakan pelanggan SPG (`spg.member`). Diskon member
 * bawaan MATI: pendaftaran, tingkat, promo khusus member, dan pelacakan jalan,
 * potongan uangnya menunggu pemilik. Menyalakannya meminta konfirmasi, karena
 * mengurangi pendapatan di semua toko. Diubah oleh pengelola promo
 * (`promos:manage`); yang lain hanya melihat.
 */
export function MemberCard({ bolehUbah, nilai }: { bolehUbah: boolean; nilai: AturanMember }) {
  const t = useTranslations("pengaturanMemberSpg");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [isian, setIsian] = useState<IsianMember>(() => isianDariAturan(nilai));
  const [konfirmasi, setKonfirmasi] = useState(false);

  const aturan = aturanDariIsian(isian);
  const sah = sahkanAturanMember(aturan);
  const salah = salahIsian(aturan);
  const berubah = JSON.stringify(aturan) !== JSON.stringify(nilai);
  const nonaktif = !bolehUbah || sibuk;
  const menyalakanDiskon = isian.diskonAktif && !nilai.diskonAktif;

  const ubah = (sebagian: Partial<IsianMember>) => setIsian((x) => ({ ...x, ...sebagian }));
  const ubahTingkat = (i: number, sebagian: Partial<BarisTingkatIsian>) =>
    setIsian((x) => ({ ...x, tingkat: x.tingkat.map((b, j) => (j === i ? { ...b, ...sebagian } : b)) }));
  const tambahTingkat = () => {
    const kunci = kunciBaru();
    setIsian((x) => ({ ...x, tingkat: [...x.tingkat, { kunci, kode: null, nama: "", minBelanja: "", diskonPersen: "0" }] }));
  };
  const hapusTingkat = (i: number) => setIsian((x) => ({ ...x, tingkat: x.tingkat.filter((_, j) => j !== i) }));

  const kirim = () => {
    if (!sah) return;
    mulai(async () => {
      try {
        const r = await simpanAturanMemberSpg(sah);
        if (!r.ok) {
          toast.error(td(`err.${r.code}`));
          return;
        }
        toast.success(t("tersimpan"));
        router.refresh();
      } catch {
        toast.error(t("err.GAGAL"));
      }
    });
  };
  const simpan = () => {
    if (!sah) return;
    if (menyalakanDiskon) setKonfirmasi(true);
    else kirim();
  };

  const saklar = (id: string, judul: string, keterangan: string, nyala: boolean, ganti: (v: boolean) => void) => (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <Label htmlFor={id} className="cursor-pointer">
        <span className="block">{judul}</span>
        <span className="block text-xs font-normal text-muted-foreground">{keterangan}</span>
      </Label>
      <Switch id={id} checked={nyala} disabled={nonaktif} onCheckedChange={ganti} />
    </div>
  );

  const angka = (
    id: string,
    label: string,
    nilaiTeks: string,
    ganti: (v: string) => void,
    keliru: boolean,
    bantu: string,
    pesanSalah: string,
    inputMode: "numeric" | "decimal" = "numeric",
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode={inputMode} value={nilaiTeks} disabled={nonaktif} aria-invalid={keliru} onChange={(e) => ganti(e.target.value)} />
      <p className={keliru ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{keliru ? pesanSalah : bantu}</p>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BadgeCheck className="h-5 w-5" />
          {t("judul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {saklar("member-aktif", t("aktif"), isian.aktif ? t("aktifYa") : t("aktifTidak"), isian.aktif, (v) => ubah({ aktif: v }))}

        <div className="space-y-2">
          <p className="text-sm font-medium">{t("tingkatJudul")}</p>
          <p className="text-xs text-muted-foreground">{t("tingkatBantu")}</p>
          <div className="space-y-2">
            <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.7fr)_2.5rem] gap-2 text-xs font-medium text-muted-foreground md:grid">
              <span>{t("kolomNama")}</span>
              <span>{t("kolomMin")}</span>
              <span>{t("kolomDiskon")}</span>
              <span className="sr-only">{t("hapus")}</span>
            </div>
            {isian.tingkat.map((b, i) => {
              const keliru = salah.tingkat.has(i);
              const kode = aturan.tingkat[i]?.kode ?? "";
              return (
                <div
                  key={b.kunci}
                  className={cn(
                    "grid grid-cols-2 gap-2 rounded-md border p-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.7fr)_2.5rem] md:items-start md:border-0 md:p-0",
                    keliru && "border-destructive/60",
                  )}
                >
                  <div className="col-span-2 space-y-1 md:col-span-1">
                    <Label htmlFor={`tingkat-nama-${b.kunci}`} className="text-xs md:sr-only">
                      {t("kolomNama")}
                    </Label>
                    <Input
                      id={`tingkat-nama-${b.kunci}`}
                      value={b.nama}
                      maxLength={30}
                      disabled={nonaktif}
                      aria-invalid={keliru && !aturan.tingkat[i]?.nama}
                      onChange={(e) => ubahTingkat(i, { nama: e.target.value })}
                    />
                    {kode ? <p className="text-xs text-muted-foreground">{t("kode", { kode })}</p> : null}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`tingkat-min-${b.kunci}`} className="text-xs md:sr-only">
                      {t("kolomMin")}
                    </Label>
                    <Input
                      id={`tingkat-min-${b.kunci}`}
                      inputMode="numeric"
                      value={i === 0 ? "0" : b.minBelanja}
                      disabled={nonaktif || i === 0}
                      aria-invalid={keliru}
                      onChange={(e) => ubahTingkat(i, { minBelanja: e.target.value })}
                    />
                    {i === 0 ? <p className="text-xs text-muted-foreground">{t("minPertama")}</p> : null}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`tingkat-diskon-${b.kunci}`} className="text-xs md:sr-only">
                      {t("kolomDiskon")}
                    </Label>
                    <Input
                      id={`tingkat-diskon-${b.kunci}`}
                      inputMode="decimal"
                      value={b.diskonPersen}
                      disabled={nonaktif}
                      aria-invalid={keliru}
                      onChange={(e) => ubahTingkat(i, { diskonPersen: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2 flex justify-end md:col-span-1">
                    {i > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={nonaktif}
                        onClick={() => hapusTingkat(i)}
                        aria-label={t("hapusTingkat", { nama: b.nama || t("tanpaNama") })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {salah.tingkat.size > 0 ? <p className="text-xs text-destructive">{t("tingkatSalah")}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={tambahTingkat} disabled={nonaktif || isian.tingkat.length >= MAKS_TINGKAT}>
              <Plus className="h-4 w-4" />
              {t("tambahTingkat")}
            </Button>
            {isian.tingkat.length >= MAKS_TINGKAT ? <span className="text-xs text-muted-foreground">{t("maksTingkat", { n: MAKS_TINGKAT })}</span> : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {angka("member-periode", t("periode"), isian.periodeBulan, (v) => ubah({ periodeBulan: v }), salah.periodeBulan, t("periodeBantu"), t("periodeSalah"))}
          {angka("member-tidur", t("hariTidur"), isian.hariTidur, (v) => ubah({ hariTidur: v }), salah.hariTidur, t("hariTidurBantu"), t("hariTidurSalah"))}
        </div>

        {saklar("member-diskon", t("diskonAktif"), isian.diskonAktif ? t("diskonAktifYa") : t("diskonAktifTidak"), isian.diskonAktif, (v) => ubah({ diskonAktif: v }))}
        {isian.diskonAktif ? (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t("diskonPeringatan")}
          </p>
        ) : null}
        {saklar("member-gabung", t("gabungPromo"), isian.gabungPromo ? t("gabungPromoYa") : t("gabungPromoTidak"), isian.gabungPromo, (v) => ubah({ gabungPromo: v }))}

        <div className="grid gap-4 sm:grid-cols-2">
          {angka(
            "member-toko",
            t("bagianToko"),
            isian.bagianTokoPersen,
            (v) => ubah({ bagianTokoPersen: v }),
            salah.bagianTokoPersen,
            t("bagianTokoBantu"),
            t("bagianTokoSalah"),
            "decimal",
          )}
          {angka(
            "member-min-daftar",
            t("minDaftar"),
            isian.minBelanjaDaftar,
            (v) => ubah({ minBelanjaDaftar: v }),
            salah.minBelanjaDaftar,
            t("minDaftarBantu"),
            t("minDaftarSalah"),
          )}
        </div>

        <p className="text-sm text-muted-foreground">{t("urutan")}</p>

        {!bolehUbah ? <p className="text-sm text-amber-700 dark:text-amber-400">{t("hanyaLihat")}</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => setIsian(isianDariAturan(MEMBER_BAWAAN))} disabled={nonaktif}>
            {t("pakaiBawaan")}
          </Button>
          <Button onClick={simpan} disabled={nonaktif || !berubah || !sah}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t("simpan")}
          </Button>
        </div>
        {berubah && !sah && bolehUbah ? <p className="text-right text-xs text-destructive">{t("isianSalah")}</p> : null}
      </CardContent>

      <AlertDialog open={konfirmasi} onOpenChange={setKonfirmasi}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("konfirmasiJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("konfirmasiIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setKonfirmasi(false);
                kirim();
              }}
            >
              {t("konfirmasiYa")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

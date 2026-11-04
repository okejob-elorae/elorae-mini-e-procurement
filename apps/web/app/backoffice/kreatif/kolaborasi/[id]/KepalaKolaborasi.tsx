"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, ArrowRight, ChevronDown, Copy, LogOut, MapPin, Pencil, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { TombolWa } from "@/components/kreatif/TombolWa";
import { angkaTitik, feeBruto, rupiahTeks } from "@/lib/creative/angka-konten";
import type { PilihanCampaign } from "@/lib/creative/campaign-queries";
import type { DetailKolaborasi, PilihanPengguna } from "@/lib/creative/kolaborasi-queries";
import { alamatLengkap, teksAlamatKirim } from "@/lib/creative/kolaborasi-tampil";
import { feeDiakui, isJalurKeluar, jenisPindah, tahapBerikut, tujuanPindah, type Tahap } from "@/lib/creative/tahap";
import { formatDisplayDate, parseDateOnly } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import { cn } from "@/lib/utils";
import { TeksRoas } from "../../campaign/BarBudget";
import { DialogAlasanPindah } from "../DialogAlasanPindah";
import { DialogKolaborasi, type AwalKolaborasi } from "../DialogKolaborasi";
import { KartuAngka, PilTahap, subKol } from "../bagian";
import { usePindahTahap } from "../usePindahTahap";

/** Belum dibayar baru merah sesudah fee-nya diakui (konten tayang); sebelum itu belum ada utang. */
const NADA_BAYAR = { TIDAK_PERLU: "inactive", BELUM: "attention", SEBAGIAN: "waiting", LUNAS: "settled" } as const;

export function keAwalKolaborasi(d: DetailKolaborasi): AwalKolaborasi {
  return {
    id: d.id,
    docNo: d.docNo,
    tahap: d.tahap,
    kol: { id: d.kol.id, name: d.kol.name, handle: d.kol.handle, platform: d.kol.platform, followers: 0, city: d.kol.city, diblokir: d.kol.diblokir },
    campaignId: d.campaign?.id ?? null,
    jenis: d.jenis,
    fee: d.fee,
    commissionPct: d.commissionPct,
    picId: d.pic?.id ?? null,
    plannedLiveAt: d.plannedLiveAt,
    briefText: d.briefText,
    doList: d.doList,
    dontList: d.dontList,
    deliverables: d.deliverables.map((x) => ({ platform: x.platform, format: x.format, qty: x.qty })),
    sampel: d.rencanaSampel.map((s) => ({ itemId: s.itemId, itemName: s.itemName, variantSku: s.variantSku, qty: s.qty })),
  };
}

/**
 * Kepala rincian kolaborasi: tahap + tombol langkah berikutnya, 4 angka
 * (views, order, GMV, ROAS), tenggat, alamat kirim dengan "Salin alamat", dan
 * WhatsApp. Maju langsung disimpan; mundur, keluar, dan buka lagi meminta
 * alasan.
 */
export function KepalaKolaborasi({
  d,
  hariIni,
  campaigns,
  pics,
  bolehMengelola,
}: {
  d: DetailKolaborasi;
  hariIni: string;
  campaigns: PilihanCampaign[];
  pics: PilihanPengguna[];
  bolehMengelola: boolean;
}) {
  const t = useTranslations("kreatifRuang");
  const tk = dinamis(t);
  const locale = useLocale();
  const pindah = usePindahTahap(d);
  const [ubah, setUbah] = useState(false);
  const tahap = pindah.tahapDari(d.id, d.tahap);
  const sasaran = { id: d.id, tahap, kolNama: d.kol.name };
  const berikut = tahapBerikut(tahap);
  const tujuan = tujuanPindah(tahap);
  const keluar = tujuan.filter((x) => isJalurKeluar(x));
  const lain = tujuan.filter((x) => !isJalurKeluar(x) && x !== berikut);
  const tanggal = (s: string | null) => (s ? formatDisplayDate(parseDateOnly(s), locale) : "—");
  const alamat = {
    name: d.kol.name,
    recipientName: d.kolLengkap.recipientName,
    phone: d.kolLengkap.phone,
    address: d.kolLengkap.address,
    city: d.kol.city,
    province: d.kolLengkap.province,
    postalCode: d.kolLengkap.postalCode,
  };
  const lengkap = alamatLengkap(alamat);
  const a = d.angka;
  const kurangKirim = d.kurangKirim.map((x) => tk(`kurang.${x}`)).join(", ");
  const tautanUkuran = `/backoffice/kreatif/kol/${d.kol.id}?tab=ukuran`;
  // "fee" = angka yang disepakati (neto bila gross-up, bruto bila dipotong); bila
  // gross-up, biaya bruto termasuk PPh selalu disebut di sampingnya.
  const jenisTeks = tk(`jenis.${d.jenis}`);
  const teksFee =
    d.fee <= 0
      ? t("kolaborasi.detail.metaJenis", { jenis: jenisTeks, fee: rupiahTeks(d.fee) })
      : d.modePajak === "GROSS_UP"
        ? a && a.biaya.pph > 0
          ? t("kolaborasi.detail.metaFeeGrossUp", { jenis: jenisTeks, fee: rupiahTeks(d.fee), bruto: rupiahTeks(feeBruto(a.biaya)) })
          : t("kolaborasi.detail.metaFeeNeto", { jenis: jenisTeks, fee: rupiahTeks(d.fee) })
        : t("kolaborasi.detail.metaFeeBruto", { jenis: jenisTeks, fee: rupiahTeks(d.fee) });

  const salin = async () => {
    try {
      await navigator.clipboard.writeText(teksAlamatKirim(alamat));
      toast.success(t("kolaborasi.detail.alamatDisalin"));
    } catch {
      toast.error(t("kolaborasi.detail.alamatGagalSalin"));
    }
  };

  const metaBaris = [
    d.docNo,
    d.campaign ? t("kolaborasi.detail.metaCampaign", { nama: d.campaign.name }) : t("kolaborasi.detail.tanpaCampaign"),
    d.pic ? t("kolaborasi.detail.metaPic", { nama: d.pic.name }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <Link href={`/backoffice/kreatif/kol/${d.kol.id}`} className="hover:underline">
            {d.kol.name}
          </Link>
        }
        meta={metaBaris}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/backoffice/kreatif/kolaborasi">
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("kolaborasi.detail.kembali")}
              </Link>
            </Button>
            <TombolWa kolId={d.kol.id} kolaborasiId={d.id} bolehMengelola={bolehMengelola} bentuk="tombol" />
            {bolehMengelola ? (
              <Button variant="outline" onClick={() => setUbah(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                {t("kolaborasi.detail.ubah")}
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="py-0">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <PilTahap tahap={tahap} />
            <span className="text-sm text-muted-foreground">
              {t("kolaborasi.detail.sejak", { tanggal: formatDisplayDate(d.tahapAt, locale), n: Math.max(0, d.umurHari) })}
            </span>
            <StatusPill tone={d.payStatus === "BELUM" && !feeDiakui(tahap) ? "inactive" : NADA_BAYAR[d.payStatus]}>{tk(`bayar.${d.payStatus}`)}</StatusPill>
            <span className="text-sm text-muted-foreground">
              {[
                teksFee,
                d.commissionPct ? t("kolaborasi.detail.metaKomisi", { n: d.commissionPct }) : null,
                subKol(d.kol) || null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {bolehMengelola ? (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {berikut && !d.kol.diblokir && jenisPindah(tahap, berikut) === "MAJU" ? (
                  <Button size="sm" onClick={() => pindah.minta([sasaran], berikut)} disabled={pindah.sedang}>
                    {t("kolaborasi.detail.maju", { tahap: tk(`tahap.${berikut}`) })}
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                ) : null}
                {lain.length && !isJalurKeluar(tahap) ? (
                  <MenuTahap label={t("kolaborasi.detail.pindahLain")} pilihan={lain} onPilih={(x) => pindah.minta([sasaran], x)} />
                ) : null}
                {keluar.length ? (
                  <MenuTahap
                    label={t("kolaborasi.detail.keluar")}
                    ikon={<LogOut className="mr-1 h-4 w-4" />}
                    pilihan={keluar}
                    merah
                    onPilih={(x) => pindah.minta([sasaran], x)}
                  />
                ) : null}
                {isJalurKeluar(tahap) ? (
                  <MenuTahap
                    label={t("kolaborasi.detail.bukaLagi")}
                    ikon={<RotateCcw className="mr-1 h-4 w-4" />}
                    pilihan={tujuan}
                    onPilih={(x) => pindah.minta([sasaran], x)}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
          {isJalurKeluar(tahap) && d.cancelReason ? (
            <p className="text-sm text-muted-foreground">{t("kolaborasi.detail.alasanKeluar", { alasan: d.cancelReason })}</p>
          ) : null}
          {d.kol.diblokir ? (
            <p className="flex items-start gap-2 rounded-md border border-red-600/25 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t("kolaborasi.detail.kolDiblokir", { alasan: d.kolLengkap.blockReason || "—" })}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KartuAngka label={t("kolaborasi.detail.stat.views")}>{angkaTitik(a?.angka.views ?? 0)}</KartuAngka>
        <KartuAngka label={t("kolaborasi.detail.stat.orders")}>{angkaTitik(a?.orders ?? 0)}</KartuAngka>
        <KartuAngka label={t("kolaborasi.detail.stat.gmv")}>
          <span className={(a?.gmv ?? 0) > 0 ? "text-emerald-700 dark:text-emerald-400" : undefined}>{rupiahTeks(a?.gmv ?? 0)}</span>
        </KartuAngka>
        <KartuAngka label={t("kolaborasi.detail.stat.roas")}>
          <TeksRoas roas={a?.roas ?? null} gmv={a?.gmv ?? 0} locale={locale} />
        </KartuAngka>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="py-0">
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-semibold">{t("kolaborasi.detail.tenggatJudul")}</p>
            {d.semuaTenggat.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("kolaborasi.detail.tenggatKosong")}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {d.semuaTenggat.map((x) => (
                  <li
                    key={`${x.jenis}-${x.refId ?? ""}-${x.tanggal}`}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                      x.lewat ? "border-red-600/30 bg-red-500/10 font-medium text-red-800 dark:text-red-300" : "bg-muted/40",
                    )}
                  >
                    {x.lewat ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> : null}
                    <span>{tk(`tenggat.${x.jenis}`)}</span>
                    <span className="tabular-nums">
                      {x.lewat
                        ? t("kolaborasi.tenggatLewat", { n: x.lewatHari })
                        : x.tanggal === hariIni
                          ? t("kolaborasi.tenggatHariIni")
                          : tanggal(x.tanggal)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="py-0">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <MapPin className="h-4 w-4" aria-hidden />
                {t("kolaborasi.detail.alamatJudul")}
              </p>
              {lengkap ? (
                <Button size="sm" variant="outline" onClick={salin}>
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  {t("kolaborasi.detail.salinAlamat")}
                </Button>
              ) : null}
            </div>
            {lengkap ? <p className="whitespace-pre-line text-sm">{teksAlamatKirim(alamat)}</p> : null}
            {d.kurangKirim.length > 0 ? (
              <div className="space-y-2 rounded-md border border-amber-600/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                <p>{t("kolaborasi.detail.dataKirimKurang", { daftar: kurangKirim })}</p>
                <Link href={tautanUkuran} className="font-medium underline">
                  {t("kolaborasi.detail.lengkapiProfil")}
                </Link>
              </div>
            ) : !lengkap ? (
              <p className="text-sm text-muted-foreground">{t("kolaborasi.detail.alamatKosong")}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <DialogAlasanPindah tertunda={pindah.tertunda} onBatal={pindah.batalTertunda} onLanjut={pindah.lanjutDenganAlasan} />
      {bolehMengelola ? (
        <DialogKolaborasi buka={ubah} onBuka={setUbah} campaigns={campaigns} pics={pics} awal={keAwalKolaborasi(d)} />
      ) : null}
    </div>
  );
}

function MenuTahap({
  label,
  pilihan,
  onPilih,
  ikon,
  merah,
}: {
  label: string;
  pilihan: Tahap[];
  onPilih: (x: Tahap) => void;
  ikon?: React.ReactNode;
  merah?: boolean;
}) {
  const tk = dinamis(useTranslations("kreatifRuang"));
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className={cn(merah && "text-destructive")}>
          {ikon}
          {label}
          <ChevronDown className="ml-1 h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        {pilihan.map((x) => (
          <DropdownMenuItem key={x} variant={isJalurKeluar(x) ? "destructive" : "default"} onSelect={() => onPilih(x)}>
            {tk(`tahap.${x}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Handshake, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { StatusPill } from "@/components/ui/status-pill";
import { angkaTitik, rupiahTeks } from "@/lib/creative/angka-konten";
import type { DetailCampaign, PilihanCampaign } from "@/lib/creative/campaign-queries";
import { alamatKolaborasi, PARAM_KOLABORASI_AWAL } from "@/lib/creative/kolaborasi-param";
import type { DaftarKolaborasi, PilihanPengguna } from "@/lib/creative/kolaborasi-queries";
import { DialogAlasanPindah } from "../../kolaborasi/DialogAlasanPindah";
import { DialogKolaborasi } from "../../kolaborasi/DialogKolaborasi";
import { KartuAngka } from "../../kolaborasi/bagian";
import { TabelKolaborasi } from "../../kolaborasi/TabelKolaborasi";
import { usePindahTahap } from "../../kolaborasi/usePindahTahap";
import { BarBudget, TeksRoas } from "../BarBudget";
import { keAwalCampaign, usePeriodeTeks } from "../CampaignClient";
import { FormCampaign } from "../FormCampaign";

/** Target sebagai bar kemajuan "n dari target"; tanpa target hanya angkanya. */
function BarisTarget({ label, n, target }: { label: string; n: number; target: number | null }) {
  const t = useTranslations("kreatifRuang.campaign.detail");
  const persen = target ? Math.min(100, (n / target) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {target ? t("dariTarget", { n, target }) : t("tanpaTarget", { n })}
        </span>
      </div>
      {target ? <Progress value={persen} aria-label={label} /> : null}
    </div>
  );
}

/**
 * Rincian satu campaign: budget, target, angka hasil, brief induk, dan
 * kolaborasi di dalamnya (tabel yang sama dengan daftar Kolaborasi, tahap bisa
 * diubah langsung).
 */
export function DetailCampaignClient({
  campaign,
  kolaborasi,
  campaigns,
  pics,
  hariIni,
  bolehMengelola,
  userId,
}: {
  campaign: DetailCampaign;
  kolaborasi: DaftarKolaborasi;
  campaigns: PilihanCampaign[];
  pics: PilihanPengguna[];
  hariIni: string;
  bolehMengelola: boolean;
  userId: string;
}) {
  const t = useTranslations("kreatifRuang.campaign");
  const locale = useLocale();
  const periode = usePeriodeTeks();
  const pindah = usePindahTahap(kolaborasi);
  const [ubah, setUbah] = useState(false);
  const [tambah, setTambah] = useState(false);
  const c = campaign;
  const tautanDaftar = alamatKolaborasi({ ...PARAM_KOLABORASI_AWAL, campaign: c.id });

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {c.name}
            {c.arsip ? <StatusPill tone="inactive">{t("arsip")}</StatusPill> : null}
          </span>
        }
        meta={[c.brand, c.product, periode(c.startDate, c.endDate)].filter((x) => x && x !== "—").join(" · ") || undefined}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/backoffice/kreatif/campaign">
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("detail.kembali")}
              </Link>
            </Button>
            {bolehMengelola ? (
              <Button variant="outline" onClick={() => setUbah(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                {t("ubah")}
              </Button>
            ) : null}
            {bolehMengelola && !c.arsip ? (
              <Button onClick={() => setTambah(true)}>
                <Plus className="mr-1 h-4 w-4" />
                {t("detail.tambahKolaborasi")}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KartuAngka label={t("detail.stat.terpakai")} bawah={<BarBudget budget={c.budget} />}>
          {rupiahTeks(c.terpakai)}
          {c.anggaran ? <span className="ml-1 text-sm font-normal text-muted-foreground">/ {rupiahTeks(c.anggaran)}</span> : null}
        </KartuAngka>
        <KartuAngka label={t("detail.stat.gmv")}>
          <span className={c.gmv > 0 ? "text-emerald-700 dark:text-emerald-400" : undefined}>{rupiahTeks(c.gmv)}</span>
        </KartuAngka>
        <KartuAngka label={t("detail.stat.roas")}>
          <TeksRoas roas={c.roas} gmv={c.gmv} locale={locale} />
        </KartuAngka>
        <KartuAngka label={t("detail.stat.views")}>{angkaTitik(c.views)}</KartuAngka>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="py-0 lg:col-span-1">
          <CardContent className="space-y-4 p-4">
            <p className="text-sm font-semibold">{t("detail.target")}</p>
            <BarisTarget label={t("detail.targetKol")} n={c.jumlahKol} target={c.targetKol} />
            <BarisTarget label={t("detail.targetKonten")} n={c.jumlahKonten} target={c.targetContent} />
            {c.objective ? (
              <div className="space-y-0.5 text-sm">
                <p className="text-xs text-muted-foreground">{t("detail.tujuan")}</p>
                <p>{c.objective}</p>
              </div>
            ) : null}
            {c.note ? (
              <div className="space-y-0.5 text-sm">
                <p className="text-xs text-muted-foreground">{t("detail.catatan")}</p>
                <p className="whitespace-pre-line">{c.note}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card className="py-0 lg:col-span-2">
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-semibold">{t("detail.brief")}</p>
            {c.brief ? (
              <p className="whitespace-pre-line text-sm">{c.brief}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("detail.briefKosong")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Handshake className="h-5 w-5" aria-hidden />
            {t("detail.kolaborasi")}
            <span className="text-sm font-normal tabular-nums text-muted-foreground">{kolaborasi.jumlah.semua}</span>
          </CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href={tautanDaftar}>{t("detail.bukaDaftar")}</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {kolaborasi.baris.length === 0 ? (
            <EmptyState icon={Handshake} title={t("detail.kosong")} />
          ) : (
            <>
              <TabelKolaborasi
                baris={kolaborasi.baris}
                hariIni={hariIni}
                bolehMengelola={bolehMengelola}
                tahapDari={pindah.tahapDari}
                onPindah={pindah.minta}
                tampilCampaign={false}
              />
              {kolaborasi.total > kolaborasi.baris.length ? (
                <p className="pt-3 text-sm text-muted-foreground">
                  <Link href={tautanDaftar} className="underline">
                    {t("detail.lebihDari")}
                  </Link>
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <DialogAlasanPindah tertunda={pindah.tertunda} onBatal={pindah.batalTertunda} onLanjut={pindah.lanjutDenganAlasan} />
      {bolehMengelola ? (
        <>
          <FormCampaign buka={ubah} onBuka={setUbah} awal={keAwalCampaign(c)} />
          <DialogKolaborasi buka={tambah} onBuka={setTambah} campaigns={campaigns} pics={pics} campaignAwal={c.id} picAwal={userId} />
        </>
      ) : null}
    </div>
  );
}

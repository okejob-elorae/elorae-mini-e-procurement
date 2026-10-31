"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Flag, Handshake, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { angkaTitik, rupiahTeks } from "@/lib/creative/angka-konten";
import { SEMUA_STATUS_CAMPAIGN, type RingkasanDaftarCampaign, type StatusCampaignKol } from "@/lib/creative/campaign-aturan";
import type { BarisCampaign, StatusCampaign } from "@/lib/creative/campaign-queries";
import { alamatKolaborasi, PARAM_KOLABORASI_AWAL } from "@/lib/creative/kolaborasi-param";
import { formatDisplayDate, parseDateOnly } from "@/lib/date-only";
import { cn } from "@/lib/utils";
import { KartuAngka } from "../kolaborasi/bagian";
import { ringkasAngka } from "../kol/format-kol";
import { BarBudget, TeksRoas } from "./BarBudget";
import { FormCampaign, type AwalCampaign } from "./FormCampaign";

const STATUS: readonly StatusCampaign[] = ["semua", "aktif", "arsip"];

/** `?status=` = saringan arsip (aktif/arsip); `?keadaan=` = status campaign (DRAFT/BERJALAN/SELESAI/BATAL). */
export function alamatCampaign(status: StatusCampaign, keadaan: StatusCampaignKol | "" = ""): string {
  const p = new URLSearchParams();
  if (status !== "semua") p.set("status", status);
  if (keadaan) p.set("keadaan", keadaan);
  const q = p.toString();
  return q ? `/backoffice/kreatif/campaign?${q}` : "/backoffice/kreatif/campaign";
}

/** Nada pil status campaign: berjalan menonjol, selesai tenang, batal dan draft redup. */
export const NADA_STATUS_CAMPAIGN: Record<StatusCampaignKol, StatusTone> = {
  DRAFT: "waiting",
  BERJALAN: "progress",
  SELESAI: "settled",
  BATAL: "inactive",
};

export function PilStatusCampaign({ status }: { status: StatusCampaignKol }) {
  const t = useTranslations("kreatifRuang.campaign");
  return <StatusPill tone={NADA_STATUS_CAMPAIGN[status]}>{t(`keadaan.${status}`)}</StatusPill>;
}

export function keAwalCampaign(c: BarisCampaign & { brief?: string | null; note?: string | null }): AwalCampaign {
  return {
    id: c.id,
    name: c.name,
    brand: c.brand,
    product: c.product,
    objective: c.objective,
    startDate: c.startDate,
    endDate: c.endDate,
    anggaran: c.anggaran,
    targetKol: c.targetKol,
    targetContent: c.targetContent,
    targetViews: c.targetViews,
    status: c.status,
    brief: c.brief ?? null,
    note: c.note ?? null,
    arsip: c.arsip,
  };
}

/** "1 Okt 2026 → 31 Okt 2026", atau satu ujungnya saja. */
export function usePeriodeTeks() {
  const t = useTranslations("kreatifRuang.campaign");
  const locale = useLocale();
  return (dari: string | null, sampai: string | null) => {
    const f = (s: string) => formatDisplayDate(parseDateOnly(s), locale);
    if (dari && sampai) return t("periode", { dari: f(dari), sampai: f(sampai) });
    if (dari) return t("periodeDari", { dari: f(dari) });
    if (sampai) return t("periodeSampai", { sampai: f(sampai) });
    return "—";
  };
}

/** "n/target" dengan target abu; tanpa target hanya n. */
export function AngkaTarget({ n, target }: { n: number; target: number | null }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {n}
      {target ? <span className="text-muted-foreground">/{target}</span> : null}
    </span>
  );
}

/**
 * Daftar campaign: yang diarsip di bawah, saringan Semua/Aktif/Arsip ber-angka.
 * Terpakai, GMV, dan ROAS dari `angkaKolaborasi`; bar budget hijau/kuning/merah.
 */
export function CampaignClient({
  baris,
  jumlah,
  jumlahStatus,
  status,
  keadaan,
  ringkasan,
  bolehMengelola,
}: {
  baris: BarisCampaign[];
  jumlah: Record<StatusCampaign, number>;
  jumlahStatus: Record<StatusCampaignKol, number>;
  status: StatusCampaign;
  keadaan: StatusCampaignKol | "";
  /** Ringkasan atas — tidak ikut saringan (`ringkasanDaftarCampaign`). */
  ringkasan: RingkasanDaftarCampaign;
  bolehMengelola: boolean;
}) {
  const t = useTranslations("kreatifRuang.campaign");
  const th = useTranslations("kreatifRuang.halaman");
  const locale = useLocale();
  const router = useRouter();
  const [berpindah, mulai] = useTransition();
  const [form, setForm] = useState<{ awal: AwalCampaign | null } | null>(null);
  const periode = usePeriodeTeks();

  return (
    <div className="space-y-6">
      <PageHeader
        title={th("campaign")}
        meta={t("meta", { n: jumlah.semua })}
        actions={
          bolehMengelola ? (
            <Button onClick={() => setForm({ awal: null })}>
              <Plus className="mr-1 h-4 w-4" />
              {t("baru")}
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
        <KartuAngka label={t("ringkasan.kol")}>{angkaTitik(ringkasan.jumlahKol)}</KartuAngka>
        <KartuAngka label={t("ringkasan.pengikut")}>
          <span title={angkaTitik(ringkasan.totalPengikut)}>{ringkasAngka(ringkasan.totalPengikut)}</span>
        </KartuAngka>
        <KartuAngka label={t("ringkasan.berjalan")}>{angkaTitik(ringkasan.berjalan)}</KartuAngka>
        <KartuAngka label={t("ringkasan.budget")}>{rupiahTeks(ringkasan.budget)}</KartuAngka>
        <KartuAngka label={t("ringkasan.terpakai")}>{rupiahTeks(ringkasan.terpakai)}</KartuAngka>
        <KartuAngka label={t("ringkasan.views")}>
          <span title={angkaTitik(ringkasan.views)}>{ringkasAngka(ringkasan.views)}</span>
        </KartuAngka>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("saringLabel")}>
          {STATUS.map((s) => {
            const aktif = s === status;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={aktif}
                onClick={() => mulai(() => router.replace(alamatCampaign(s, keadaan), { scroll: false }))}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  aktif ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                )}
              >
                {t(`saring.${s}`)}
                <span className={cn("text-xs tabular-nums", aktif ? "opacity-90" : "text-muted-foreground")}>{jumlah[s]}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("saringStatusLabel")}>
          {(["", ...SEMUA_STATUS_CAMPAIGN] as const).map((k) => {
            const aktif = k === keadaan;
            return (
              <button
                key={k || "semua"}
                type="button"
                aria-pressed={aktif}
                onClick={() => mulai(() => router.replace(alamatCampaign(status, k), { scroll: false }))}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  aktif ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                )}
              >
                {k ? t(`keadaan.${k}`) : t("saringStatusSemua")}
                {k ? (
                  <span className={cn("text-xs tabular-nums", aktif ? "opacity-90" : "text-muted-foreground")}>{jumlahStatus[k]}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flag className="h-5 w-5" aria-hidden />
            {t("kartuJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent className={cn(berpindah && "opacity-60 transition-opacity")}>
          {baris.length === 0 ? (
            <EmptyState
              icon={Flag}
              title={
                keadaan && jumlah.semua > 0
                  ? t("kosongStatus", { status: t(`keadaan.${keadaan}`) })
                  : status === "arsip"
                    ? t("kosongArsip")
                    : status === "aktif" && jumlah.semua > 0
                      ? t("kosongAktif")
                      : t("kosongJudul")
              }
              description={jumlah.semua === 0 ? t("kosongIsi") : undefined}
              action={
                bolehMengelola && status !== "arsip" ? (
                  <Button onClick={() => setForm({ awal: null })}>
                    <Plus className="mr-1 h-4 w-4" />
                    {t("baru")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">{t("kolom.campaign")}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t("kolom.periode")}</TableHead>
                    <TableHead className="text-right">{t("kolom.kol")}</TableHead>
                    <TableHead className="text-right">{t("kolom.konten")}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{t("kolom.views")}</TableHead>
                    <TableHead className="text-right">{t("kolom.terpakai")}</TableHead>
                    <TableHead className="min-w-[130px]">{t("kolom.budget")}</TableHead>
                    <TableHead className="text-right">{t("kolom.gmv")}</TableHead>
                    <TableHead className="text-right">{t("kolom.roas")}</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">{t("kolom.aksi")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="baris-berurutan">
                  {baris.map((c) => (
                    <TableRow key={c.id} className={cn(c.arsip && "text-muted-foreground")}>
                      <TableCell className="whitespace-normal">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link href={`/backoffice/kreatif/campaign/${c.id}`} className="font-medium text-foreground hover:underline">
                            {c.name}
                          </Link>
                          <PilStatusCampaign status={c.status} />
                          {c.arsip ? <StatusPill tone="inactive">{t("arsip")}</StatusPill> : null}
                        </div>
                        {c.brand || c.product ? (
                          <p className="text-xs text-muted-foreground">{[c.brand, c.product].filter(Boolean).join(" · ")}</p>
                        ) : null}
                        <p className="text-xs text-muted-foreground xl:hidden">{periode(c.startDate, c.endDate)}</p>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-sm xl:table-cell">{periode(c.startDate, c.endDate)}</TableCell>
                      <TableCell className="text-right">
                        <AngkaTarget n={c.jumlahKol} target={c.targetKol} />
                      </TableCell>
                      <TableCell className="text-right">
                        <AngkaTarget n={c.jumlahKonten} target={c.targetContent} />
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{angkaTitik(c.views)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{rupiahTeks(c.terpakai)}</TableCell>
                      <TableCell>
                        <BarBudget budget={c.budget} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{rupiahTeks(c.gmv)}</TableCell>
                      <TableCell className="text-right">
                        <TeksRoas roas={c.roas} gmv={c.gmv} locale={locale} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button asChild variant="ghost" size="sm" title={t("lihatKolaborasi")}>
                            <Link href={alamatKolaborasi({ ...PARAM_KOLABORASI_AWAL, campaign: c.id })}>
                              <Handshake className="h-4 w-4 2xl:mr-1" />
                              <span className="sr-only 2xl:not-sr-only">{t("lihatKolaborasi")}</span>
                            </Link>
                          </Button>
                          {bolehMengelola ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("ubahAria", { nama: c.name })}
                              title={t("ubah")}
                              onClick={() => setForm({ awal: keAwalCampaign(c) })}
                            >
                              <Pencil className="h-4 w-4" />
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

      {bolehMengelola ? <FormCampaign buka={form !== null} onBuka={(b) => !b && setForm(null)} awal={form?.awal} /> : null}
    </div>
  );
}

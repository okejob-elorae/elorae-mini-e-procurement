"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, List, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDisplayDate } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import type { StatusLangkah } from "@/lib/production/jadwal";
import { SARINGAN_FOLLOW_UP, UKURAN_HALAMAN_FOLLOW_UP, type SaringanFollowUp } from "@/lib/production/jadwal-jejak";
import type { ChipKalenderProduksi, FollowUpBaris, FollowUpProduksi } from "@/lib/production/jadwal-queries";
import type { TanggalMerah } from "@/lib/production/hari-kerja";
import { cn } from "@/lib/utils";
import {
  alamatFollowUp,
  bacaBulan,
  geserBulan,
  NADA_KEADAAN,
  NADA_STATUS,
  pesanWaFollowUp,
  RUANG_KERJA_TAHAP,
  selisihHari,
  statusBerikutnya,
  tautanWaFollowUp,
  type ParamFollowUp,
  type TampilanFollowUp,
} from "./follow-up";
import { KalenderFollowUp } from "./KalenderFollowUp";
import type { PilihanPemasok } from "./pemasok";
import { UbahStatusDialog, type LangkahDialog } from "./UbahStatusDialog";

/** Kunci `FollowUpProduksi.jumlah` untuk setiap tab. */
const KUNCI_JUMLAH: Record<SaringanFollowUp, keyof FollowUpProduksi["jumlah"]> = {
  "hari-ini": "hariIni",
  terlambat: "terlambat",
  "minggu-ini": "mingguIni",
  semua: "semua",
};

/** Nilai pilihan "semua pemasok" di kotak pemasok (bukan id sungguhan). */
const SEMUA_PEMASOK = "__semua__";

type Props = {
  param: ParamFollowUp;
  hariIni: string;
  data: FollowUpProduksi;
  pemasok: PilihanPemasok[];
  hariKerja: number[];
  tanggalMerah: TanggalMerah[];
  bolehUbah: boolean;
};

/**
 * Follow-up produksi: langkah jadwal yang belum selesai lintas tahap, untuk
 * ditanyakan ke pemasok setiap hari. Semua keadaan (tab, pemasok, halaman,
 * tampilan, bulan) ada di alamat — ganti tab memakai `router.replace`, jadi
 * tombol Kembali tidak berjalan mundur melewati setiap tab.
 */
export function FollowUpClient({ param, hariIni, data, pemasok, hariKerja, tanggalMerah, bolehUbah }: Props) {
  const t = useTranslations("jadwalProduksi");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [berpindah, mulaiPindah] = useTransition();
  const [dipilih, setDipilih] = useState<{ langkah: LangkahDialog; awal: StatusLangkah } | null>(null);
  const [muatUlang, setMuatUlang] = useState(0);

  const pergi = (ubah: Partial<ParamFollowUp>) =>
    mulaiPindah(() => router.replace(alamatFollowUp({ ...param, ...ubah }, hariIni), { scroll: false }));

  const bukaDialog = (langkah: LangkahDialog) => setDipilih({ langkah, awal: statusBerikutnya(langkah.status) });

  const sesudahSimpan = () => {
    setDipilih(null);
    setMuatUlang((n) => n + 1);
    router.refresh();
  };

  const opsiPemasok = [
    { value: SEMUA_PEMASOK, label: t("followUp.pemasok.semua") },
    ...pemasok.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("followUp.judul")} meta={t("followUp.meta", { n: data.jumlah.semua })} />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div role="group" aria-label={t("followUp.tampilan.label")} className="inline-flex w-fit rounded-md border p-0.5">
          {(["daftar", "kalender"] as const satisfies readonly TampilanFollowUp[]).map((v) => (
            <Button
              key={v}
              type="button"
              size="sm"
              variant={param.tampilan === v ? "secondary" : "ghost"}
              aria-pressed={param.tampilan === v}
              onClick={() => pergi({ tampilan: v, halaman: 1 })}
            >
              {v === "daftar" ? <List className="h-4 w-4" aria-hidden /> : <CalendarDays className="h-4 w-4" aria-hidden />}
              {td(`followUp.tampilan.${v}`)}
            </Button>
          ))}
        </div>
        <SearchableCombobox
          options={opsiPemasok}
          value={param.pemasok ?? SEMUA_PEMASOK}
          onValueChange={(v) => pergi({ pemasok: v && v !== SEMUA_PEMASOK ? v : null, halaman: 1 })}
          placeholder={t("followUp.pemasok.semua")}
          searchPlaceholder={t("followUp.pemasok.cari")}
          emptyMessage={t("followUp.pemasok.tidakAda")}
          className="w-full sm:w-64"
        />
        {param.tampilan === "kalender" ? (
          <NavigasiBulan bulan={param.bulan} hariIni={hariIni} onGanti={(bulan) => pergi({ bulan })} />
        ) : null}
      </div>

      {param.tampilan === "daftar" ? (
        <>
          <Tabs value={param.saring} onValueChange={(v) => pergi({ saring: v as SaringanFollowUp, halaman: 1 })}>
            <TabsList className="h-auto flex-wrap">
              {SARINGAN_FOLLOW_UP.map((s) => (
                <TabsTrigger key={s} value={s}>
                  {t("followUp.tabJumlah", { label: td(`followUp.tab.${s}`), n: data.jumlah[KUNCI_JUMLAH[s]] })}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5" aria-hidden />
                {td(`followUp.tab.${param.saring}`)}
              </CardTitle>
            </CardHeader>
            <CardContent className={cn(berpindah && "opacity-60 transition-opacity")}>
              {data.baris.length === 0 ? (
                <EmptyState
                  icon={ClipboardList}
                  title={param.pemasok ? t("followUp.kosong.pemasok") : td(`followUp.kosong.${param.saring}`)}
                  description={param.pemasok || data.jumlah.semua > 0 ? undefined : t("followUp.kosong.deskripsiTautan")}
                  action={
                    param.pemasok ? (
                      <Button variant="outline" onClick={() => pergi({ pemasok: null, halaman: 1 })}>
                        {t("followUp.kosong.semuaPemasok")}
                      </Button>
                    ) : data.jumlah.semua > 0 && param.saring !== "semua" ? (
                      <Button variant="outline" onClick={() => pergi({ saring: "semua", halaman: 1 })}>
                        {t("followUp.kosong.lihatSemua", { n: data.jumlah.semua })}
                      </Button>
                    ) : data.jumlah.semua === 0 ? (
                      // Tahap dibuka dari Plan Kerja tab Rincian plan, lalu ruang kerjanya.
                      <Button asChild variant="outline">
                        <Link href="/backoffice/production/planning?tab=rincian">{t("followUp.kosong.bukaPlan")}</Link>
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("followUp.kolom.target")}</TableHead>
                          <TableHead className="min-w-[160px]">{t("followUp.kolom.proses")}</TableHead>
                          <TableHead className="min-w-[180px]">{t("followUp.kolom.tahap")}</TableHead>
                          <TableHead className="min-w-[150px]">{t("followUp.kolom.pemasok")}</TableHead>
                          <TableHead>{t("followUp.kolom.status")}</TableHead>
                          <TableHead className="text-right">
                            <span className="sr-only">{t("followUp.kolom.aksi")}</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.baris.map((b) => (
                          <BarisFollowUp
                            key={b.stepId}
                            b={b}
                            hariIni={hariIni}
                            locale={locale}
                            bolehUbah={bolehUbah}
                            onUbah={() =>
                              bukaDialog({
                                stepId: b.stepId,
                                name: b.name,
                                status: b.status,
                                target: b.targetDate,
                                tahapId: b.tahap.id,
                                tahapName: b.tahap.name,
                              })
                            }
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {data.jumlahHalaman > 1 ? (
                    <Pagination
                      page={data.halaman}
                      totalPages={data.jumlahHalaman}
                      onPageChange={(halaman) => pergi({ halaman })}
                      totalCount={data.jumlah[KUNCI_JUMLAH[param.saring]]}
                      pageSize={UKURAN_HALAMAN_FOLLOW_UP}
                    />
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <KalenderFollowUp
          bulan={param.bulan}
          pemasokId={param.pemasok}
          hariIni={hariIni}
          hariKerja={hariKerja}
          tanggalMerah={tanggalMerah}
          muatUlang={muatUlang}
          onPilih={(c: ChipKalenderProduksi, tanggal: string) =>
            bukaDialog({
              stepId: c.stepId,
              name: c.name,
              status: c.status,
              target: tanggal,
              tahapId: c.tahapId,
              tahapName: c.tahapName,
            })
          }
        />
      )}

      <UbahStatusDialog
        langkah={dipilih?.langkah ?? null}
        awal={dipilih?.awal ?? "PROSES"}
        hariIni={hariIni}
        bolehUbah={bolehUbah}
        onTutup={() => setDipilih(null)}
        onBerhasil={sesudahSimpan}
      />
    </div>
  );
}

function BarisFollowUp({
  b,
  hariIni,
  locale,
  bolehUbah,
  onUbah,
}: {
  b: FollowUpBaris;
  hariIni: string;
  locale: string;
  bolehUbah: boolean;
  onUbah: () => void;
}) {
  const t = useTranslations("jadwalProduksi");
  const td = dinamis(t);
  const selisih = selisihHari(b.targetDate, hariIni);
  const relatif =
    selisih < 0
      ? t("followUp.relatif.telat", { n: -selisih })
      : selisih === 0
        ? t("followUp.relatif.hariIni")
        : selisih === 1
          ? t("followUp.relatif.besok")
          : t("followUp.relatif.lagi", { n: selisih });
  const tautanWa = b.pemasok
    ? tautanWaFollowUp(
        b.pemasok.wa,
        pesanWaFollowUp({ pemasok: b.pemasok.name, langkah: b.name, tahap: b.tahap.name, target: b.targetDate }),
      )
    : null;

  return (
    <TableRow>
      <TableCell className="align-top">
        <p className="whitespace-nowrap">{formatDisplayDate(b.targetDate, locale)}</p>
        <p
          className={cn(
            "text-xs",
            b.keadaan === "TELAT" ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground",
          )}
        >
          {relatif}
        </p>
      </TableCell>
      <TableCell className="whitespace-normal align-top">
        <p className="font-medium">{b.name}</p>
        <p className="text-xs text-muted-foreground">{t("followUp.lama", { n: b.durationDays })}</p>
        {b.note ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{b.note}</p> : null}
      </TableCell>
      <TableCell className="whitespace-normal align-top">
        <Link
          href={RUANG_KERJA_TAHAP(b.tahap.id)}
          className="font-medium text-tautan hover:underline"
          aria-label={t("followUp.bukaTahap", { tahap: b.tahap.name })}
        >
          {b.tahap.name}
        </Link>
        <p className="text-xs text-muted-foreground">
          {b.kategori.code} · {b.kategori.name} · {t("followUp.qty", { n: b.tahap.targetQty.toLocaleString("id-ID") })} ·{" "}
          {b.tahun}
        </p>
      </TableCell>
      <TableCell className="whitespace-normal align-top">
        {b.pemasok ? (
          <div className="flex items-start gap-1">
            <span className="min-w-0 flex-1 pt-1.5">{b.pemasok.name}</span>
            {tautanWa ? (
              <Button asChild variant="ghost" size="icon-sm" title={t("followUp.wa", { pemasok: b.pemasok.name })}>
                <a
                  href={tautanWa}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("followUp.wa", { pemasok: b.pemasok.name })}
                >
                  <MessageCircle className="h-4 w-4" />
                </a>
              </Button>
            ) : (
              <span className="sr-only">{t("followUp.waTanpaNomor", { pemasok: b.pemasok.name })}</span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">{t("followUp.tanpaPemasok")}</span>
        )}
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-col items-start gap-1">
          <StatusPill tone={NADA_STATUS[b.status]}>{td(`followUp.status.${b.status}`)}</StatusPill>
          {b.keadaan === "TELAT" || b.keadaan === "HARI_INI" ? (
            <StatusPill tone={NADA_KEADAAN[b.keadaan]}>{td(`followUp.keadaanLabel.${b.keadaan}`)}</StatusPill>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-right align-top">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onUbah}
          aria-label={t("followUp.ubahStatusUntuk", { proses: b.name })}
        >
          {bolehUbah ? t("followUp.ubahStatus") : t("followUp.lihat")}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function NavigasiBulan({
  bulan,
  hariIni,
  onGanti,
}: {
  bulan: string;
  hariIni: string;
  onGanti: (bulan: string) => void;
}) {
  const t = useTranslations("jadwalProduksi");
  const locale = useLocale();
  const b = bacaBulan(bulan);
  const label = b
    ? new Intl.DateTimeFormat(locale.startsWith("en") ? "en-GB" : "id-ID", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(b.tahun, b.bulan - 1, 15)))
    : bulan;
  const bulanIni = hariIni.slice(0, 7);
  return (
    <div className="flex items-center gap-1 sm:ml-auto">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={() => onGanti(geserBulan(bulan, -1))}
        aria-label={t("followUp.bulan.sebelum")}
        title={t("followUp.bulan.sebelum")}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-36 text-center text-sm font-medium capitalize" aria-live="polite">
        {label}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={() => onGanti(geserBulan(bulan, 1))}
        aria-label={t("followUp.bulan.sesudah")}
        title={t("followUp.bulan.sesudah")}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      {bulan !== bulanIni ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => onGanti(bulanIni)}>
          {t("followUp.bulan.ini")}
        </Button>
      ) : null}
    </div>
  );
}

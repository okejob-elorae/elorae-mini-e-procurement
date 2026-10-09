"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, ExternalLink, Loader2, Megaphone } from "lucide-react";
import { selesaiAgendaAction } from "@/app/actions/kreatif-agenda";
import { TombolWa } from "@/components/kreatif/TombolWa";
import { AngkaNaik } from "@/components/gerak/AngkaNaik";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { angkaTitik, feeBruto, rupiahTeks } from "@/lib/creative/angka-konten";
import type { KpiKreatif } from "@/lib/creative/tugas-queries";
import type { BarisTugas, KelompokTugas, KunciTugas } from "@/lib/creative/tugas";
import { dinamis } from "@/lib/i18n/dinamis";
import { geserHari, labelTanggal } from "@/lib/tanggal-isian";
import { cn } from "@/lib/utils";
import {
  alamatHariIni,
  BARIS_AWAL,
  lebarBar,
  nadaRoas,
  PILIHAN_PERIODE,
  pintasanTugas,
  tautanBuka,
  TERBUKA_SAMPAI,
  umurMerah,
  umurTugas,
  type ParamHariIni,
  type PilihanPeriode,
} from "./hari-ini";

type Props = {
  param: ParamHariIni;
  hariIni: string;
  kelompok: KelompokTugas[];
  kpi: KpiKreatif;
  campaign: { id: string; nama: string }[];
  umurMerahHari: number;
  bolehMengelola: boolean;
};

const SEMUA_CAMPAIGN = "__semua__";

/** "Rabu, 7 Oktober 2026" dalam bahasa layar, dari hari WIB. */
function tanggalPanjangLokal(hari: string, locale: string): string {
  const [th, bl, tg] = hari.split("-").map(Number);
  return new Intl.DateTimeFormat(locale.startsWith("en") ? "en-GB" : "id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(th, bl - 1, tg, 12)));
}

const linkAman = (url: string | null | undefined): string | null => (url && /^https?:\/\//i.test(url.trim()) ? url.trim() : null);

/**
 * Hari ini Ruang KOL. Periode dan campaign ditulis ke alamat dengan
 * `router.replace` (angkanya dihitung di server); membuka/menutup kelompok
 * hanya keadaan layar. Kelompok bernilai nol tidak ditampilkan, kelompok
 * dengan ≤ 5 baris terbuka sendiri (bug KOL Manager §6.19).
 */
export function HariIniClient({ param, hariIni, kelompok, kpi, campaign, umurMerahHari, bolehMengelola }: Props) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [berpindah, mulaiPindah] = useTransition();

  const pergi = (ubah: Partial<ParamHariIni>) =>
    mulaiPindah(() => router.replace(alamatHariIni({ ...param, ...ubah }), { scroll: false }));

  const pilihPeriode = (p: PilihanPeriode) => {
    if (p === "rentang") {
      // Rentang khusus langsung terisi 30 hari terakhir, siap digeser.
      const awal = param.periode === "rentang" ? param : { dari: geserHari(hariIni, -29), sampai: hariIni };
      pergi({ periode: "rentang", dari: awal.dari, sampai: awal.sampai });
    } else {
      pergi({ periode: p });
    }
  };

  const terisi = kelompok.filter((k) => k.jumlah > 0);
  const total = terisi.reduce((s, k) => s + k.jumlah, 0);
  const opsiCampaign = [{ value: SEMUA_CAMPAIGN, label: t("hariIni.campaign.semua") }, ...campaign.map((c) => ({ value: c.id, label: c.nama }))];

  return (
    <div className="space-y-6">
      <PageHeader title={t("halaman.hariIni")} meta={tanggalPanjangLokal(hariIni, locale)} />

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        <div role="group" aria-label={t("hariIni.periode.label")} className="flex flex-wrap gap-1.5">
          {PILIHAN_PERIODE.map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={param.periode === p ? "secondary" : "outline"}
              aria-pressed={param.periode === p}
              onClick={() => pilihPeriode(p)}
            >
              {td(`hariIni.periode.${p}`)}
            </Button>
          ))}
        </div>
        {param.periode === "rentang" ? (
          <RentangTanggalInput
            dari={param.dari}
            sampai={param.sampai}
            onChange={(r) => (r.dari && r.sampai ? pergi({ periode: "rentang", dari: r.dari, sampai: r.sampai }) : undefined)}
            max={hariIni}
            maksHari={366}
            required
            className="w-full sm:w-72"
            aria-label={t("hariIni.periode.rentang")}
          />
        ) : null}
        <SearchableCombobox
          options={opsiCampaign}
          value={param.campaign ?? SEMUA_CAMPAIGN}
          onValueChange={(v) => pergi({ campaign: v && v !== SEMUA_CAMPAIGN ? v : null })}
          placeholder={t("hariIni.campaign.semua")}
          searchPlaceholder={t("hariIni.campaign.cari")}
          emptyMessage={t("hariIni.campaign.tidakAda")}
          className="w-full sm:w-64"
        />
        {berpindah ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden /> : null}
      </div>

      <section aria-label={t("hariIni.kpi.label")} className={cn("grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6", berpindah && "opacity-60 transition-opacity")}>
        <KartuKpi judul={t("hariIni.kpi.kolBaru")} nilai={kpi.kolBaru} format={angkaTitik} sub={t("hariIni.kpi.kolBaruSub", { n: angkaTitik(kpi.kolTotal) })} />
        <KartuKpi
          judul={t("hariIni.kpi.berjalan")}
          nilai={kpi.berjalan}
          format={angkaTitik}
          sub={t("hariIni.kpi.berjalanSub")}
          nada="text-sky-700 dark:text-sky-300"
        />
        <KartuKpi
          judul={t("hariIni.kpi.gmv")}
          nilai={kpi.angka.gmv}
          format={rupiahTeks}
          uang
          sub={t("hariIni.kpi.gmvSub", { n: angkaTitik(kpi.angka.orders) })}
          nada="text-emerald-700 dark:text-emerald-300"
        />
        <KartuKpi judul={t("hariIni.kpi.views")} nilai={kpi.angka.angka.views} format={angkaTitik} sub={t("hariIni.kpi.viewsSub", { n: angkaTitik(kpi.angka.jumlahKonten) })} />
        <KartuKpi
          judul={t("hariIni.kpi.biaya")}
          nilai={kpi.angka.biaya.total}
          format={rupiahTeks}
          uang
          sub={
            kpi.angka.biaya.pph > 0
              ? t("hariIni.kpi.biayaSubGrossUp", { fee: rupiahTeks(kpi.angka.biaya.fee), bruto: rupiahTeks(feeBruto(kpi.angka.biaya)) })
              : t("hariIni.kpi.biayaSubFee", { fee: rupiahTeks(kpi.angka.biaya.fee) })
          }
        />
        <KartuRoas roas={kpi.angka.roas} judul={t("hariIni.kpi.roas")} sub={t("hariIni.kpi.roasSub")} kosong={t("hariIni.kpi.roasKosong")} />
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className={cn("gap-0 py-0", total > 0 && "border-red-500/40")}>
          {total > 0 ? (
            <>
              <CardHeader className="border-b py-4">
                <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-300">
                  <Megaphone className="h-5 w-5" aria-hidden />
                  {t("hariIni.tugas.judul", { n: total })}
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y p-0">
                {terisi.map((k) => (
                  <KelompokTugasView
                    key={k.kunci}
                    k={k}
                    hariIni={hariIni}
                    umurMerahHari={umurMerahHari}
                    bolehMengelola={bolehMengelola}
                    locale={locale}
                  />
                ))}
              </CardContent>
            </>
          ) : (
            <CardContent className="p-0">
              <EmptyState icon={CheckCircle2} title={t("hariIni.tugas.kosongJudul")} description={t("hariIni.tugas.kosongIsi")} />
            </CardContent>
          )}
        </Card>

        <PosisiPipeline posisi={kpi.posisi} />
      </div>
    </div>
  );
}

function KartuKpi({
  judul,
  nilai,
  format,
  sub,
  nada,
  uang,
}: {
  judul: string;
  nilai: number;
  format: (n: number) => string;
  sub: string;
  nada?: string;
  /** Rupiah tidak pernah dipatahkan ("Rp" lalu angka di baris berikutnya); hurufnya mengecil di HP. */
  uang?: boolean;
}) {
  return (
    <Card className="gap-1 px-4 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{judul}</p>
      <AngkaNaik
        nilai={nilai}
        format={format}
        className={cn("font-semibold tabular-nums", uang ? "whitespace-nowrap text-base sm:text-xl" : "text-xl break-words", nada)}
      />
      <p className="text-xs text-muted-foreground">{sub}</p>
    </Card>
  );
}

function KartuRoas({ roas, judul, sub, kosong }: { roas: number | null; judul: string; sub: string; kosong: string }) {
  const nada = nadaRoas(roas);
  return (
    <Card className="gap-1 px-4 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{judul}</p>
      {nada === "kosong" ? (
        <p className="text-xl font-semibold text-muted-foreground" aria-label={kosong}>
          —
        </p>
      ) : (
        <p
          className={cn(
            "text-xl font-semibold tabular-nums",
            nada === "baik" ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300",
          )}
        >
          {roas!.toFixed(2).replace(".", ",")}×
        </p>
      )}
      <p className="text-xs text-muted-foreground">{nada === "kosong" ? kosong : sub}</p>
    </Card>
  );
}

function KelompokTugasView({
  k,
  hariIni,
  umurMerahHari,
  bolehMengelola,
  locale,
}: {
  k: KelompokTugas;
  hariIni: string;
  umurMerahHari: number;
  bolehMengelola: boolean;
  locale: string;
}) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const [buka, setBuka] = useState(k.jumlah <= TERBUKA_SAMPAI);
  const [semua, setSemua] = useState(false);
  const baris = semua ? k.baris : k.baris.slice(0, BARIS_AWAL);
  const idIsi = `tugas-${k.kunci}`;

  return (
    <section>
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-start gap-3 rounded-none px-4 py-3 text-left font-normal hover:bg-muted/50"
        aria-expanded={buka}
        aria-controls={idIsi}
        onClick={() => setBuka((b) => !b)}
      >
        <span className="inline-flex min-w-7 shrink-0 justify-center rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white tabular-nums">
          {k.jumlah}
        </span>
        <span className="min-w-0 flex-1 whitespace-normal">
          <span className="block font-medium">{td(`tugas.${k.kunci}`)}</span>
          <span className="block text-xs text-muted-foreground">{td(`tugasSaran.${k.kunci}`)}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", buka && "rotate-180")} aria-hidden />
      </Button>
      {buka ? (
        <div id={idIsi} className="pb-2">
          <ul className="divide-y border-t">
            {baris.map((b) => (
              <BarisTugasView
                key={`${b.jenis}:${b.id}`}
                kunci={k.kunci}
                b={b}
                hariIni={hariIni}
                umurMerahHari={umurMerahHari}
                bolehMengelola={bolehMengelola}
                locale={locale}
              />
            ))}
          </ul>
          {k.baris.length > baris.length ? (
            <div className="flex flex-wrap items-center gap-3 px-4 pt-2 text-xs text-muted-foreground">
              <span>{t("hariIni.tugas.menampilkan", { x: baris.length, y: k.jumlah })}</span>
              <Button type="button" variant="outline" size="xs" onClick={() => setSemua(true)}>
                {t("hariIni.tugas.tampilkanSemua", { n: k.jumlah })}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function BarisTugasView({
  kunci,
  b,
  hariIni,
  umurMerahHari,
  bolehMengelola,
  locale,
}: {
  kunci: KunciTugas;
  b: BarisTugas;
  hariIni: string;
  umurMerahHari: number;
  bolehMengelola: boolean;
  locale: string;
}) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const router = useRouter();
  const [menyimpan, mulai] = useTransition();
  const umur = umurTugas(kunci, b, hariIni);
  const merah = umurMerah(umur, umurMerahHari);
  const pintasan = pintasanTugas(kunci, b);

  const tandaiSelesai = () =>
    mulai(async () => {
      const r = await selesaiAgendaAction({ id: b.id, selesai: true });
      if (r.ok) {
        toast.success(t("hariIni.tugas.okSelesai"));
        router.refresh();
      } else {
        toast.error(td(`kalender.err.${r.kode}`));
      }
    });

  const sub = [b.sub ? (b.jenis === "KOLABORASI" || b.jenis === "AKUN" || b.jenis === "FORMULIR" ? `@${b.sub.replace(/^@+/, "")}` : b.sub) : null, b.docNo, b.tahap ? td(`tahap.${b.tahap}`) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-medium">{b.judul}</p>
        {sub ? <p className="truncate text-xs text-muted-foreground">{sub}</p> : null}
        <InfoBaris kunci={kunci} b={b} locale={locale} />
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {umur ? (
          <span className={cn("whitespace-nowrap text-xs tabular-nums", merah ? "font-semibold text-red-700 dark:text-red-300" : "text-muted-foreground")}>
            {umur.jenis === "HARI_INI" ? t("hariIni.tugas.umur.HARI_INI") : td(`hariIni.tugas.umur.${umur.jenis}`, { n: umur.hari })}
          </span>
        ) : null}
        {b.jenis === "KOLABORASI" && b.kolId ? (
          <TombolWa
            kolId={b.kolId}
            kolaborasiId={b.id}
            bolehMengelola={bolehMengelola}
            label={t("hariIni.tugas.wa", { nama: b.judul })}
            templateAwal={TEMPLATE_TUGAS[kunci]}
          />
        ) : null}
        {b.jenis === "AGENDA" && bolehMengelola ? (
          <Button type="button" variant="outline" size="sm" onClick={tandaiSelesai} disabled={menyimpan}>
            {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
            {t("hariIni.tugas.selesai")}
          </Button>
        ) : null}
        {pintasan && bolehMengelola ? (
          <Button asChild variant="outline" size="sm">
            <Link href={pintasan.href}>{td(`hariIni.tugas.aksi.${pintasan.aksi}`)}</Link>
          </Button>
        ) : null}
        <Button asChild variant={pintasan && bolehMengelola ? "ghost" : "outline"} size="sm">
          <Link href={tautanBuka(b)}>
            {b.jenis === "AGENDA"
              ? t("hariIni.tugas.bukaKalender")
              : b.jenis === "CAMPAIGN"
                ? t("hariIni.tugas.bukaCampaign")
                : b.jenis === "AKUN" || b.jenis === "FORMULIR"
                  ? t("hariIni.tugas.bukaProfil")
                  : b.jenis === "PERANGKAT"
                    ? t("hariIni.tugas.bukaPemantauan")
                    : t("hariIni.tugas.buka")}
          </Link>
        </Button>
      </div>
    </li>
  );
}

/** Template WhatsApp yang paling cocok untuk setiap kelompok tugas (kunci `TEMPLATE_BAWAAN`). */
const TEMPLATE_TUGAS: Partial<Record<KunciTugas, string>> = {
  BELUM_DIBALAS: "follow-up",
  DEAL_BELUM_KIRIM: "alamat",
  DATA_KIRIM_KURANG: "alamat",
  RESI_NYANGKUT: "resi",
  DITERIMA_BELUM_TAYANG: "pengingat",
  JADWAL_TAYANG_LEWAT: "pengingat",
  ANGKA_BELUM_ADA: "minta-link",
};

function InfoBaris({ kunci, b, locale }: { kunci: KunciTugas; b: BarisTugas; locale: string }) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const i = b.info;
  const tgl = (x: string | null | undefined) => (x ? labelTanggal(x, locale) : "");
  const bagian: ReactNode[] = [];

  switch (kunci) {
    case "AGENDA":
      if (i.jam) bagian.push(t("hariIni.tugas.info.jam", { jam: i.jam }));
      if (i.adaPersiapanBelum) bagian.push(<span className="text-amber-700 dark:text-amber-300">{t("hariIni.tugas.info.persiapan")}</span>);
      break;
    case "RESI_NYANGKUT":
      if (i.resi || i.kurir) bagian.push(t("hariIni.tugas.info.resi", { kurir: i.kurir ?? "", resi: i.resi ?? "" }).trim());
      bagian.push(t("hariIni.tugas.info.tenggat", { tanggal: tgl(i.tanggal) }));
      break;
    case "DRAF_MENUNGGU": {
      const draf = linkAman(i.draftLink);
      if (draf) bagian.push(<TautanLuar href={draf} label={t("hariIni.tugas.lihatDraf")} />);
      bagian.push(t("hariIni.tugas.info.tenggat", { tanggal: tgl(i.tanggal) }));
      break;
    }
    case "JADWAL_TAYANG_LEWAT":
      bagian.push(t("hariIni.tugas.info.rencana", { tanggal: tgl(i.tanggal) }));
      break;
    case "ANGKA_BELUM_ADA": {
      if (i.titik) bagian.push(td(`tenggat.${i.titik}`));
      const konten = linkAman(i.link);
      if (konten) bagian.push(<TautanLuar href={konten} label={t("hariIni.tugas.lihatKonten")} />);
      break;
    }
    case "BELUM_DIBAYAR":
      // "Fee" selalu berarti fee kolaborasi utuh; jumlah satu termin ditulis "Termin …".
      if (i.fee) bagian.push(i.feeTermin ? t("hariIni.tugas.info.termin", { jumlah: rupiahTeks(i.fee) }) : t("hariIni.tugas.info.fee", { fee: rupiahTeks(i.fee) }));
      bagian.push(t("hariIni.tugas.info.tenggat", { tanggal: tgl(i.tanggal) }));
      break;
    case "BELUM_DIBALAS":
      bagian.push(t("hariIni.tugas.info.tenggat", { tanggal: tgl(i.tanggal) }));
      if (b.saranGhosting) bagian.push(<span className="font-medium text-red-700 dark:text-red-300">{t("hariIni.tugas.saranGhosting")}</span>);
      break;
    case "KIRIM_DOBEL":
      if (i.dobelDengan?.length) {
        bagian.push(
          <span>
            {t("hariIni.tugas.info.dobel")}{" "}
            {i.dobelDengan.map((d, n) => (
              <span key={d.id}>
                {n > 0 ? ", " : null}
                <Link href={`/backoffice/kreatif/kolaborasi/${encodeURIComponent(d.id)}`} className="text-tautan underline-offset-2 hover:underline">
                  {d.kolNama} · {d.docNo}
                </Link>
              </span>
            ))}
          </span>,
        );
      }
      break;
    case "DATA_KIRIM_KURANG":
      if (i.kurang?.length) bagian.push(t("hariIni.tugas.info.kurang", { daftar: i.kurang.map((x) => td(`kurang.${x}`)).join(", ") }));
      break;
    case "BUDGET_CAMPAIGN":
      if (i.persen !== null && i.persen !== undefined) bagian.push(t("hariIni.tugas.info.budgetPersen", { persen: String(i.persen).replace(".", ",") }));
      if (i.sisa !== null && i.sisa !== undefined) {
        bagian.push(
          i.lewatBudget ? (
            <span className="font-medium text-red-700 dark:text-red-300">{t("hariIni.tugas.info.budgetLewat", { sisa: rupiahTeks(Math.abs(i.sisa)) })}</span>
          ) : (
            t("hariIni.tugas.info.budgetSisa", { sisa: rupiahTeks(i.sisa) })
          ),
        );
      }
      break;
    case "DEAL_BELUM_KIRIM":
    case "DITERIMA_BELUM_TAYANG":
      bagian.push(t("hariIni.tugas.info.tenggat", { tanggal: tgl(i.tanggal) }));
      break;
    case "ANOMALI_AKUN": {
      const a = i.anomali;
      const persen = (n: number) => String(n).replace(".", ",");
      if (a?.pengikut) {
        bagian.push(
          <span className="font-medium text-amber-700 dark:text-amber-300">
            {t("hariIni.tugas.info.pengikutNaik", { dari: angkaTitik(a.pengikut.dari), ke: angkaTitik(a.pengikut.ke), persen: persen(a.pengikut.persen) })}
          </span>,
        );
      }
      if (a?.er) {
        bagian.push(
          <span className="font-medium text-red-700 dark:text-red-300">
            {t("hariIni.tugas.info.erTurun", { dari: persen(a.er.dari), ke: persen(a.er.ke), persen: persen(a.er.persen) })}
          </span>,
        );
      }
      break;
    }
    case "DATA_DARI_KOL": {
      const f = i.formulir;
      if (f) {
        bagian.push(t("hariIni.tugas.info.formulirDiisi", { n: f.jumlahKolom }));
        if (f.menimpa > 0) bagian.push(<span className="font-medium text-amber-700 dark:text-amber-300">{t("hariIni.tugas.info.formulirMenimpa", { n: f.menimpa })}</span>);
        if (f.npwpBaru) bagian.push(<span className="font-medium text-amber-700 dark:text-amber-300">{t("hariIni.tugas.info.formulirNpwp")}</span>);
      }
      break;
    }
    case "PERANGKAT_BERHENTI":
      if (i.alasanJeda) bagian.push(td(`pantau.alasanJeda.${i.alasanJeda}`));
      if (i.sampai) bagian.push(t("hariIni.tugas.info.jedaSampai", { jam: jamLokal(i.sampai, locale) }));
      break;
    default:
      break;
  }
  if (!bagian.length) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      {bagian.map((x, n) => (
        <span key={n} className="inline-flex items-center gap-2">
          {n > 0 ? <span aria-hidden>·</span> : null}
          {x}
        </span>
      ))}
    </p>
  );
}

/** "14.05" dari ISO, di WIB. */
function jamLokal(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale.startsWith("en") ? "en-GB" : "id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(iso));
}

function TautanLuar({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-tautan underline-offset-2 hover:underline">
      {label}
      <ExternalLink className="h-3 w-3" aria-hidden />
    </a>
  );
}

function PosisiPipeline({ posisi }: { posisi: KpiKreatif["posisi"] }) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const maks = useMemo(() => Math.max(0, ...posisi.map((p) => p.jumlah)), [posisi]);
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-base">{t("hariIni.posisi.judul")}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        {maks === 0 ? (
          <p className="text-sm text-muted-foreground">{t("hariIni.posisi.kosong")}</p>
        ) : (
          <ul className="space-y-1">
            {posisi.map((p) => (
              <li key={p.tahap}>
                <Link
                  href={`/backoffice/kreatif/kolaborasi?tahap=${p.tahap}`}
                  className="grid grid-cols-[7.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`${t("hariIni.posisi.lihat", { tahap: td(`tahap.${p.tahap}`) })}: ${p.jumlah}`}
                >
                  <span className="truncate text-muted-foreground">{td(`tahap.${p.tahap}`)}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${lebarBar(p.jumlah, maks)}%` }} />
                  </span>
                  <span className="text-right font-medium tabular-nums">{p.jumlah}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

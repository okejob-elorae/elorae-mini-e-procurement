"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Loader2, Plus, RotateCcw, Check } from "lucide-react";
import { centangAgendaAction, selesaiAgendaAction } from "@/app/actions/kreatif-agenda";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { jumlahBelum, type ButirChecklist } from "@/lib/creative/agenda-aturan";
import type { AgendaKalender, BarisKalender, GrupKalender, HariKalender, JenisKejadian, KalenderKreatif, OpsiAgenda } from "@/lib/creative/agenda-queries";
import { angkaTitik, rupiahTeks } from "@/lib/creative/angka-konten";
import type { JenisAgenda } from "@/lib/creative/tahap";
import type { JenisTenggat } from "@/lib/creative/tenggat";
import { dinamis } from "@/lib/i18n/dinamis";
import { labelTanggal } from "@/lib/tanggal-isian";
import { cn } from "@/lib/utils";
import { AgendaDialog, type BukaAgenda } from "./AgendaDialog";
import {
  agendaTerbuka,
  alamatKalender,
  barisSel,
  geserBulan,
  jumlahIsi,
  kisiBulan,
  kunciPreset,
  PRESET_KALENDER,
  bacaPreset,
  saringHari,
  type ParamKalender,
  type PresetKalender,
} from "./kalender";

type Props = {
  param: ParamKalender;
  data: KalenderKreatif;
  hariIni: string;
  opsi: OpsiAgenda;
  userId: string;
  bolehMengelola: boolean;
};

/** Garis kiri kartu agenda dan warna baris agenda di sel, per jenis. */
const WARNA_AGENDA: Record<JenisAgenda, { garis: string; teks: string }> = {
  TUGAS: { garis: "border-l-sky-500", teks: "text-sky-800 dark:text-sky-300" },
  MEETING: { garis: "border-l-violet-500", teks: "text-violet-800 dark:text-violet-300" },
  DEADLINE: { garis: "border-l-red-500", teks: "text-red-700 dark:text-red-300" },
  KIRIM: { garis: "border-l-amber-500", teks: "text-amber-800 dark:text-amber-300" },
  KONTEN: { garis: "border-l-sky-500", teks: "text-sky-800 dark:text-sky-300" },
  BAYAR: { garis: "border-l-emerald-500", teks: "text-emerald-800 dark:text-emerald-300" },
  LAINNYA: { garis: "border-l-muted-foreground/50", teks: "text-muted-foreground" },
};

const WARNA_KEJADIAN: Record<JenisKejadian, string> = {
  KIRIM: "text-amber-800 dark:text-amber-300",
  SAMPAI: "text-sky-800 dark:text-sky-300",
  RENCANA_TAYANG: "text-violet-800 dark:text-violet-300",
  TAYANG: "text-emerald-800 dark:text-emerald-300",
  DIBAYAR: "text-emerald-800 dark:text-emerald-300",
  CAMPAIGN_MULAI: "text-muted-foreground",
  CAMPAIGN_SELESAI: "text-muted-foreground",
};

function bacaSimpanan(userId: string): PresetKalender | null {
  try {
    return bacaPreset(window.localStorage.getItem(kunciPreset(userId)));
  } catch {
    return null;
  }
}

/** Preset tersimpan berubah di tab lain → kalender ini ikut. */
function langgananSimpanan(ubah: () => void): () => void {
  window.addEventListener("storage", ubah);
  return () => window.removeEventListener("storage", ubah);
}

function tulisSimpanan(userId: string, p: PresetKalender) {
  try {
    window.localStorage.setItem(kunciPreset(userId), p);
  } catch {
    // Penyimpanan peramban tidak tersedia: preset tetap berlaku sampai halaman ditutup.
  }
}

/** "Rabu, 7 Oktober 2026" dalam bahasa layar. */
function tanggalPanjang(hari: string, locale: string): string {
  const [th, bl, tg] = hari.split("-").map(Number);
  return new Intl.DateTimeFormat(locale.startsWith("en") ? "en-GB" : "id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(th, bl - 1, tg, 12)));
}

/**
 * Kalender Ruang KOL. Satu bacaan server per BULAN (pindah bulan = muat
 * ulang); memilih tanggal dan preset hanya mengganti panel di klien dan
 * menulis alamat lewat `history.replaceState` — tanpa membaca ulang bulannya
 * (bug KOL Manager §6.14). Preset diingat per orang di peramban.
 */
export function KalenderKreatifClient({ param, data, hariIni, opsi, userId, bolehMengelola }: Props) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [berpindah, mulaiPindah] = useTransition();
  const [tanggal, setTanggal] = useState(param.tanggal);
  // Urutan: pilihan di layar ini → preset di alamat → yang diingat → Semua.
  // Yang diingat dibaca lewat useSyncExternalStore: server dan hidrasi melihat
  // null (keluaran sama), sesudahnya nilai peramban.
  const [pilihan, setPilihan] = useState<PresetKalender | null>(param.jenis);
  const simpanan = useSyncExternalStore(langgananSimpanan, () => bacaSimpanan(userId), () => null);
  const preset: PresetKalender = pilihan ?? simpanan ?? "semua";
  const [dialog, setDialog] = useState<BukaAgenda | null>(() => {
    if (!param.agenda) return null;
    const a = Object.values(data.hari).flatMap((h) => h.agenda).find((x) => x.id === param.agenda);
    return a ? { mode: "ubah", agenda: a } : null;
  });

  const tulisAlamat = (ubah: { tanggal?: string; jenis?: PresetKalender }) => {
    const url = alamatKalender({ bulan: param.bulan, tanggal: ubah.tanggal ?? tanggal, jenis: ubah.jenis ?? preset });
    // `null`: Next menyelaraskan alamatnya ke router (dan `useSearchParams`) tanpa membaca ulang;
    // dengan state internal Next, refresh berikutnya mengembalikan alamat lama.
    window.history.replaceState(null, "", url);
  };

  const pilihTanggal = (tgl: string) => {
    setTanggal(tgl);
    tulisAlamat({ tanggal: tgl });
  };

  const pilihPreset = (p: PresetKalender) => {
    setPilihan(p);
    tulisSimpanan(userId, p);
    tulisAlamat({ jenis: p });
  };

  const keBulan = (bulan: string, tgl?: string) =>
    mulaiPindah(() => {
      const tujuan = tgl ?? (hariIni.slice(0, 7) === bulan ? hariIni : `${bulan}-01`);
      router.push(alamatKalender({ bulan, tanggal: tujuan, jenis: preset }), { scroll: false });
    });

  const sesudahSimpan = (tgl: string) => {
    setDialog(null);
    if (tgl.slice(0, 7) !== param.bulan) {
      keBulan(tgl.slice(0, 7), tgl);
      return;
    }
    setTanggal(tgl);
    tulisAlamat({ tanggal: tgl });
    router.refresh();
  };

  const kisi = useMemo(() => kisiBulan(param.bulan), [param.bulan]);
  const namaHari = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale.startsWith("en") ? "en-GB" : "id-ID", { weekday: "short", timeZone: "UTC" });
    // 28 Sep 2026 = Senin.
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2026, 8, 28 + i))));
  }, [locale]);
  const judulBulan = useMemo(() => {
    const [th, bl] = param.bulan.split("-").map(Number);
    return new Intl.DateTimeFormat(locale.startsWith("en") ? "en-GB" : "id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(th, bl - 1, 15)),
    );
  }, [param.bulan, locale]);

  const hariTersaring = (tgl: string): HariKalender => saringHari(data.hari[tgl], preset);
  const totalBulan = kisi.flat().filter((h) => h.diBulan).reduce((s, h) => s + jumlahIsi(hariTersaring(h.tanggal)), 0);

  const teksTenggat = (g: GrupKalender<JenisTenggat>) => t("kalender.tenggatSel", { n: g.jumlah, label: td(`tenggat.${g.jenis}`) });
  const teksKejadian = (g: GrupKalender<JenisKejadian>) => t("kalender.tenggatSel", { n: g.jumlah, label: td(`kalender.kejadian.${g.jenis}`).toLowerCase() });
  const contoh = (g: GrupKalender<string>) => g.baris.slice(0, 3).map((b) => b.judul).join(", ");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("halaman.kalender")}
        meta={t("kalender.meta", { n: totalBulan })}
        actions={
          bolehMengelola ? (
            <Button type="button" onClick={() => setDialog({ mode: "baru", tanggal })}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("kalender.panel.tambah")}
            </Button>
          ) : null
        }
      />

      <div role="group" aria-label={t("kalender.preset.label")} className="flex flex-wrap gap-1.5">
        {PRESET_KALENDER.map((p) => (
          <Button key={p} type="button" size="sm" variant={preset === p ? "secondary" : "outline"} aria-pressed={preset === p} onClick={() => pilihPreset(p)}>
            {td(`kalender.preset.${p}`)}
          </Button>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="gap-3 py-4">
          <CardContent className="space-y-3 px-3 sm:px-4">
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="outline" size="icon-sm" aria-label={t("kalender.bulanSebelum")} onClick={() => keBulan(geserBulan(param.bulan, -1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex min-w-0 flex-col items-center">
                <p className="text-base font-semibold capitalize">{judulBulan}</p>
                {berpindah ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    {t("kalender.memuat")}
                  </span>
                ) : param.bulan !== hariIni.slice(0, 7) ? (
                  <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={() => keBulan(hariIni.slice(0, 7), hariIni)}>
                    {t("kalender.bulanIni")}
                  </Button>
                ) : null}
              </div>
              <Button type="button" variant="outline" size="icon-sm" aria-label={t("kalender.bulanBerikut")} onClick={() => keBulan(geserBulan(param.bulan, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className={cn("grid grid-cols-7 gap-px overflow-hidden rounded-md border bg-border text-xs", berpindah && "opacity-60")}>
              {namaHari.map((h) => (
                <div key={h} className="bg-muted/60 px-1 py-1.5 text-center font-medium text-muted-foreground">
                  {h}
                </div>
              ))}
              {kisi.flat().map((h) => {
                const isi = hariTersaring(h.tanggal);
                const { tampil, sisa } = barisSel(isi);
                const terbuka = agendaTerbuka(isi);
                const dipilih = h.tanggal === tanggal;
                const hariIniSel = h.tanggal === hariIni;
                const adaTenggat = isi.tenggat.length > 0;
                // Merah + ⚠ hanya sesudah harinya lewat; hari ini kuning; yang akan datang netral.
                const nadaTenggat = h.tanggal < hariIni ? "lewat" : h.tanggal === hariIni ? "hariIni" : "nanti";
                const adaAgenda = isi.agenda.length > 0;
                const adaKejadian = isi.kejadian.length > 0;
                return (
                  <button
                    key={h.tanggal}
                    type="button"
                    onClick={() => pilihTanggal(h.tanggal)}
                    aria-pressed={dipilih}
                    aria-label={`${labelTanggal(h.tanggal, locale)}${jumlahIsi(isi) ? ` · ${jumlahIsi(isi)}` : ""}`}
                    className={cn(
                      "relative flex min-h-12 flex-col items-stretch gap-0.5 bg-background p-1 text-left align-top transition-colors hover:bg-muted/50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-24 md:p-1.5",
                      !h.diBulan && "bg-muted/30 text-muted-foreground",
                      hariIniSel && "ring-1 ring-inset ring-primary",
                      dipilih && "z-[1] ring-2 ring-inset ring-primary",
                    )}
                  >
                    <span className="flex items-center justify-between gap-1">
                      <span className={cn("text-xs font-medium tabular-nums", hariIniSel && "text-tautan font-semibold", !h.diBulan && "opacity-60")}>
                        {Number(h.tanggal.slice(8))}
                      </span>
                      {terbuka > 0 ? (
                        <span className="rounded-full bg-red-600 px-1.5 text-[10px] font-semibold leading-4 text-white tabular-nums" title={t("kalender.agendaTerbuka", { n: terbuka })}>
                          {terbuka}
                        </span>
                      ) : null}
                    </span>
                    {/* Layar sempit: titik penanda saja. */}
                    <span className="flex gap-0.5 md:hidden" aria-hidden>
                      {adaTenggat ? (
                        <span className={cn("h-1.5 w-1.5 rounded-full", nadaTenggat === "lewat" ? "bg-red-600" : nadaTenggat === "hariIni" ? "bg-amber-500" : "bg-muted-foreground")} />
                      ) : null}
                      {adaAgenda ? <span className="h-1.5 w-1.5 rounded-full bg-sky-600" /> : null}
                      {adaKejadian ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" /> : null}
                    </span>
                    <span className="hidden min-w-0 flex-col gap-0.5 md:flex">
                      {tampil.map((b) =>
                        b.macam === "tenggat" ? (
                          <span
                            key={`t:${b.grup.jenis}`}
                            className={cn(
                              "truncate text-[11px]",
                              nadaTenggat === "lewat"
                                ? "font-semibold text-red-700 dark:text-red-300"
                                : nadaTenggat === "hariIni"
                                  ? "font-semibold text-amber-800 dark:text-amber-300"
                                  : "font-medium text-foreground",
                            )}
                            title={contoh(b.grup)}
                          >
                            {nadaTenggat === "lewat" ? "⚠ " : ""}
                            {teksTenggat(b.grup)}
                          </span>
                        ) : b.macam === "agenda" ? (
                          <span
                            key={`a:${b.agenda.id}`}
                            className={cn("truncate text-[11px]", WARNA_AGENDA[b.agenda.jenis].teks, b.agenda.selesai && "line-through opacity-70")}
                            title={b.agenda.judul}
                          >
                            {b.agenda.jam ? <span className="tabular-nums">{b.agenda.jam} </span> : null}
                            {b.agenda.judul}
                          </span>
                        ) : (
                          <span key={`k:${b.grup.jenis}`} className={cn("truncate text-[11px]", WARNA_KEJADIAN[b.grup.jenis])} title={contoh(b.grup)}>
                            {teksKejadian(b.grup)}
                          </span>
                        ),
                      )}
                      {sisa > 0 ? <span className="text-[11px] text-muted-foreground">{t("kalender.lagi", { n: sisa })}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
            {totalBulan === 0 && !berpindah ? (
              <EmptyState
                icon={CalendarDays}
                title={t("kalender.kosongBulan")}
                className="py-6"
                action={
                  bolehMengelola ? (
                    <Button type="button" variant="outline" onClick={() => setDialog({ mode: "baru", tanggal })}>
                      <Plus className="h-4 w-4" aria-hidden />
                      {t("kalender.panel.tambah")}
                    </Button>
                  ) : undefined
                }
              />
            ) : null}
          </CardContent>
        </Card>

        <PanelHari
          tanggal={tanggal}
          hariIni={hariIni}
          isi={hariTersaring(tanggal)}
          dealBelumKirim={tanggal === hariIni && (preset === "semua" || preset === "logistik") ? data.dealBelumKirim : null}
          bolehMengelola={bolehMengelola}
          locale={locale}
          onTambah={() => setDialog({ mode: "baru", tanggal })}
          onUbah={(agenda) => setDialog({ mode: "ubah", agenda })}
          onBerubah={() => router.refresh()}
        />
      </div>

      <AgendaDialog buka={dialog} opsi={opsi} onTutup={() => setDialog(null)} onTersimpan={sesudahSimpan} />
    </div>
  );
}

function PanelHari({
  tanggal,
  hariIni,
  isi,
  dealBelumKirim,
  bolehMengelola,
  locale,
  onTambah,
  onUbah,
  onBerubah,
}: {
  tanggal: string;
  hariIni: string;
  isi: HariKalender;
  dealBelumKirim: KalenderKreatif["dealBelumKirim"] | null;
  bolehMengelola: boolean;
  locale: string;
  onTambah: () => void;
  onUbah: (a: AgendaKalender) => void;
  onBerubah: () => void;
}) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const jumlahKejadian = isi.kejadian.reduce((s, g) => s + g.jumlah, 0);
  const kosong = isi.tenggat.length === 0 && isi.kejadian.length === 0 && isi.agenda.length === 0;
  const jumlahTenggat = isi.tenggat.reduce((s, g) => s + g.jumlah, 0);
  const ringkas = kosong
    ? t("kalender.panel.kosongRingkas")
    : [
        jumlahTenggat > 0 ? t("kalender.panel.tenggatJumlah", { n: jumlahTenggat }) : null,
        t("kalender.panel.ringkas", { agenda: isi.agenda.length, kejadian: jumlahKejadian }),
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <Card className="gap-4 py-4 lg:sticky lg:top-4">
      <CardContent className="space-y-4 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">{tanggalPanjang(tanggal, locale)}</p>
            <p className="text-xs text-muted-foreground">
              {tanggal === hariIni ? `${t("kalender.panel.hariIni")} · ` : ""}
              {ringkas}
            </p>
          </div>
          {bolehMengelola ? (
            <Button type="button" size="sm" variant="outline" onClick={onTambah}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("kalender.panel.tambah")}
            </Button>
          ) : null}
        </div>

        {dealBelumKirim && dealBelumKirim.jumlah > 0 ? (
          <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            <p>{t("kalender.panel.dealBelumKirim", { n: dealBelumKirim.jumlah })}</p>
            <p className="mt-1">
              {dealBelumKirim.contoh.map((c, i) => (
                <span key={c.id}>
                  {i > 0 ? ", " : null}
                  <Link href={`/backoffice/kreatif/kolaborasi/${encodeURIComponent(c.id)}`} className="font-medium underline-offset-2 hover:underline">
                    {c.judul} ({c.docNo})
                  </Link>
                </span>
              ))}
              {dealBelumKirim.jumlah > dealBelumKirim.contoh.length ? ` ${t("kalender.panel.lagi", { n: dealBelumKirim.jumlah - dealBelumKirim.contoh.length })}` : null}
            </p>
            <Link href="/backoffice/kreatif/sampel?tab=perlu-dikirim" className="mt-1 inline-block font-medium underline underline-offset-2">
              {t("kalender.panel.bukaSampel")}
            </Link>
          </div>
        ) : null}

        {kosong ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("kalender.panel.kosong")}</p>
        ) : null}

        {isi.tenggat.length ? (
          <section className="space-y-2">
            <h2
              className={cn(
                "text-xs font-semibold uppercase tracking-wide",
                tanggal < hariIni ? "text-red-700 dark:text-red-300" : "text-muted-foreground",
              )}
            >
              {t("kalender.panel.perlu")}
            </h2>
            {isi.tenggat.map((g) => (
              <GrupPanel
                key={g.jenis}
                judul={td(`tenggat.${g.jenis}`)}
                g={g}
                peringatan={tanggal < hariIni}
                nilai={g.jenis === "JATUH_TEMPO_BAYAR" && g.nilai ? rupiahTeks(g.nilai) : null}
              />
            ))}
          </section>
        ) : null}

        {isi.agenda.length ? (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("kalender.panel.agenda")}</h2>
            {isi.agenda.map((a) => (
              // Kunci ikut keadaan server: data baru sesudah simpan/refresh memasang ulang kartunya.
              <KartuAgenda
                key={`${a.id}|${a.selesai ? 1 : 0}|${a.checklist.map((b) => (b.selesai ? 1 : 0)).join("")}|${a.checklist.length}`}
                a={a}
                bolehMengelola={bolehMengelola}
                onUbah={() => onUbah(a)}
                onBerubah={onBerubah}
              />
            ))}
          </section>
        ) : null}

        {isi.kejadian.length ? (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("kalender.panel.terjadi")}</h2>
            {isi.kejadian.map((g) => (
              <GrupPanel
                key={g.jenis}
                judul={td(`kalender.kejadian.${g.jenis}`)}
                g={g}
                nilai={
                  g.nilai === null
                    ? null
                    : g.jenis === "TAYANG"
                      ? t("kalender.nilaiViews", { n: angkaTitik(g.nilai) })
                      : rupiahTeks(g.nilai)
                }
              />
            ))}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

function GrupPanel({ judul, g, nilai, peringatan = false }: { judul: string; g: GrupKalender<string>; nilai: string | null; peringatan?: boolean }) {
  const t = useTranslations("kreatifRuang");
  const [buka, setBuka] = useState(g.jumlah <= 3);
  return (
    <div className="rounded-md border">
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-start gap-2 px-3 py-2 text-left font-normal"
        aria-expanded={buka}
        onClick={() => setBuka((b) => !b)}
      >
        {peringatan ? <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden /> : null}
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-semibold tabular-nums">{g.jumlah}</span> {judul}
        </span>
        {nilai ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{nilai}</span> : null}
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", buka && "rotate-180")} aria-hidden />
      </Button>
      {buka ? (
        <ul className="divide-y border-t">
          {g.baris.map((b) => (
            <BarisPanel key={b.id} b={b} peringatan={peringatan} />
          ))}
          {g.jumlah > g.baris.length ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">{t("kalender.panel.menampilkan", { x: g.baris.length, y: g.jumlah })}</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function BarisPanel({ b, peringatan }: { b: BarisKalender; peringatan: boolean }) {
  const t = useTranslations("kreatifRuang");
  const href = b.kolaborasiId
    ? `/backoffice/kreatif/kolaborasi/${encodeURIComponent(b.kolaborasiId)}`
    : b.campaignId
      ? `/backoffice/kreatif/campaign/${encodeURIComponent(b.campaignId)}`
      : null;
  const isi = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{b.judul}</span>
        {b.sub ? <span className="block truncate text-xs text-muted-foreground">{b.sub}</span> : null}
      </span>
      {peringatan && b.lewat ? <span className="shrink-0 text-xs font-medium text-red-700 dark:text-red-300">{t("kalender.panel.lewat")}</span> : null}
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {isi}
        </Link>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2">{isi}</div>
      )}
    </li>
  );
}

function KartuAgenda({
  a,
  bolehMengelola,
  onUbah,
  onBerubah,
}: {
  a: AgendaKalender;
  bolehMengelola: boolean;
  onUbah: () => void;
  onBerubah: () => void;
}) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const [butir, setButir] = useState<ButirChecklist[]>(a.checklist);
  const [selesai, setSelesai] = useState(a.selesai);
  const [sibuk, mulai] = useTransition();

  const centang = (indeks: number, nilai: boolean) => {
    const lama = butir;
    setButir((x) => x.map((b, i) => (i === indeks ? { ...b, selesai: nilai } : b)));
    mulai(async () => {
      const r = await centangAgendaAction({ id: a.id, indeks, selesai: nilai });
      if (r.ok) setButir(r.checklist);
      else {
        setButir(lama);
        toast.error(td(`kalender.err.${r.kode}`));
      }
    });
  };

  const balikSelesai = () => {
    const nilai = !selesai;
    setSelesai(nilai);
    mulai(async () => {
      const r = await selesaiAgendaAction({ id: a.id, selesai: nilai });
      if (r.ok) {
        toast.success(nilai ? t("kalender.agenda.okSelesai") : t("kalender.agenda.okBukaLagi"));
        onBerubah();
      } else {
        setSelesai(!nilai);
        toast.error(td(`kalender.err.${r.kode}`));
      }
    });
  };

  const belum = jumlahBelum(butir);
  const meta = [
    a.jam,
    td(`agenda.${a.jenis}`),
    a.kolNama,
    a.kolaborasiDocNo,
    a.campaignNama,
  ].filter(Boolean);

  return (
    <div className={cn("rounded-md border border-l-[3px] p-3", WARNA_AGENDA[a.jenis].garis, selesai && "opacity-75")}>
      <div className="flex items-start gap-2">
        <p className={cn("min-w-0 flex-1 text-sm font-medium", selesai && "line-through")}>{a.judul}</p>
        {bolehMengelola ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={balikSelesai}
              disabled={sibuk}
              aria-label={selesai ? t("kalender.agenda.bukaLagi") : t("kalender.agenda.tandaiSelesai")}
              title={selesai ? t("kalender.agenda.bukaLagi") : t("kalender.agenda.tandaiSelesai")}
            >
              {selesai ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onUbah}>
              {t("kalender.agenda.ubah")}
            </Button>
          </div>
        ) : null}
      </div>
      <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        {meta.map((m, i) => (
          <span key={i} className={i === 0 && a.jam ? "tabular-nums" : undefined}>
            {i > 0 ? "· " : ""}
            {m}
          </span>
        ))}
        {belum > 0 ? <span className="text-amber-700 dark:text-amber-300">· {t("kalender.agenda.persiapanBelum", { n: belum })}</span> : null}
      </p>
      {a.catatan ? <p className="mt-2 whitespace-pre-wrap text-sm">{a.catatan}</p> : null}
      {butir.length ? (
        <ul className="mt-2 space-y-1">
          {butir.map((b, i) => (
            <li key={i}>
              <label className={cn("flex items-start gap-2 text-sm", bolehMengelola ? "cursor-pointer" : "cursor-default")}>
                <Checkbox
                  checked={b.selesai}
                  disabled={!bolehMengelola}
                  onCheckedChange={(v) => centang(i, v === true)}
                  className="mt-0.5"
                />
                <span className={cn(b.selesai && "text-emerald-700 line-through dark:text-emerald-300")}>{b.teks}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ExternalLink, Loader2, RefreshCw, Search, TrendingUp } from "lucide-react";
import { cekSekarangAction } from "@/app/actions/kreatif-performa";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { angkaTitik } from "@/lib/creative/angka-konten";
import {
  alamatPerforma,
  JENIS_SARING_PERFORMA,
  PLATFORM_SARING_PERFORMA,
  URUTAN_PERFORMA,
  type JenisSaringPerforma,
  type ParamPerforma,
  type PlatformSaringPerforma,
  type StatusVideo,
  type UrutanPerforma,
} from "@/lib/creative/performa";
import type { KeadaanPemantau } from "@/lib/creative/cek-sekarang-writer";
import type { BarisPerforma, HasilPerforma } from "@/lib/creative/performa-queries";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import { cn } from "@/lib/utils";
import { bangunkanEkstensi } from "./bangunkan-ekstensi";
import { DialogTempelLink } from "./DialogTempelLink";

const RUTE_KOLABORASI = (id: string) => `/backoffice/kreatif/kolaborasi/${id}`;

const NADA_STATUS: Record<StatusVideo, StatusTone> = {
  MENUNGGU: "waiting",
  TERBACA: "settled",
  GAGAL: "attention",
  BELUM: "inactive",
};

function persen(n: number | null, locale: string): string {
  if (n === null) return "—";
  return `${new Intl.NumberFormat(locale.startsWith("en") ? "en-GB" : "id-ID", { maximumFractionDigits: 2 }).format(n)}%`;
}

const angka = (n: number | null | undefined) => (n === null || n === undefined ? "—" : angkaTitik(n));

export function PerformaClient({
  param,
  data,
  bolehMengelola,
  pemantau,
}: {
  param: ParamPerforma;
  data: HasilPerforma;
  bolehMengelola: boolean;
  pemantau: KeadaanPemantau;
}) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [memuat, startMuat] = useTransition();
  const [cari, setCari] = useState(param.cari);

  const pergi = (ubah: Partial<ParamPerforma>) => {
    const baru = { ...param, ...ubah };
    // Ganti saringan atau urutan → kembali ke halaman 1.
    if (ubah.halaman === undefined) baru.halaman = 1;
    startMuat(() => router.replace(alamatPerforma(baru), { scroll: false }));
  };

  // Pencarian ditulis ke alamat sesudah berhenti mengetik.
  const jeda = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (jeda.current) clearTimeout(jeda.current);
    },
    [],
  );
  const ketik = (v: string) => {
    setCari(v);
    if (jeda.current) clearTimeout(jeda.current);
    jeda.current = setTimeout(() => {
      if (v.trim() !== param.cari) pergi({ cari: v.trim() });
    }, 400);
  };

  const disaring = Boolean(param.cari || param.jenis !== "semua" || param.platform !== "semua" || param.dari || param.sampai);
  const r = data.ringkasan;
  const { cek, sedangDicek } = useCekSekarang();
  const idHalaman = data.baris.map((b) => b.kontenId);

  // Selama ada video yang menunggu ekstensi, segarkan angkanya sendiri (maks. ±10 menit, tidak saat tab disembunyikan).
  const adaMenunggu = data.baris.some((b) => b.status === "MENUNGGU");
  useEffect(() => {
    if (!adaMenunggu) return;
    let putaran = 0;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (++putaran > 40) return clearInterval(id);
      router.refresh();
    }, 15_000);
    return () => clearInterval(id);
  }, [adaMenunggu, router]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("halaman.performa")}
        meta={t("performa.meta", { n: angkaTitik(r.video) })}
        actions={
          bolehMengelola ? (
            <div className="flex flex-wrap gap-2">
              {idHalaman.length ? (
                <Button variant="outline" onClick={() => cek(idHalaman)} disabled={sedangDicek.size > 0}>
                  {sedangDicek.size > 0 ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                  {t("performa.cek.semua")}
                </Button>
              ) : null}
              <DialogTempelLink />
            </div>
          ) : null
        }
      />

      <section aria-label={t("performa.kpi.label")} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi judul={t("performa.kpi.video")} nilai={angkaTitik(r.video)} />
        <Kpi judul={t("performa.kpi.views")} nilai={angkaTitik(r.totalViews)} />
        <Kpi judul={t("performa.kpi.er")} nilai={persen(r.rataEr, locale)} />
        <Kpi judul={t("performa.kpi.dicek")} nilai={angkaTitik(r.dicekHariIni)} />
      </section>

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        <div className="relative w-full lg:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={cari} onChange={(e) => ketik(e.target.value)} placeholder={t("performa.cari")} aria-label={t("performa.cari")} className="pl-9" />
        </div>
        <Select value={param.jenis} onValueChange={(v) => pergi({ jenis: v as JenisSaringPerforma })}>
          <SelectTrigger className="w-full lg:w-[160px]" aria-label={t("performa.jenis.label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {JENIS_SARING_PERFORMA.map((j) => (
              <SelectItem key={j} value={j}>
                {td(`performa.jenis.${j}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={param.platform} onValueChange={(v) => pergi({ platform: v as PlatformSaringPerforma })}>
          <SelectTrigger className="w-full lg:w-[160px]" aria-label={t("performa.platform.label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLATFORM_SARING_PERFORMA.map((p) => (
              <SelectItem key={p} value={p}>
                {td(`performa.platform.${p}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <RentangTanggalInput
          dari={param.dari ?? ""}
          sampai={param.sampai ?? ""}
          onChange={({ dari, sampai }) => pergi({ dari: dari || null, sampai: sampai || null })}
          placeholder={t("performa.periode")}
          aria-label={t("performa.periode")}
          className="w-full lg:w-[260px]"
        />
        <Select value={param.urut} onValueChange={(v) => pergi({ urut: v as UrutanPerforma })}>
          <SelectTrigger className="w-full lg:w-[200px]" aria-label={t("performa.urut.label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {URUTAN_PERFORMA.map((u) => (
              <SelectItem key={u} value={u}>
                {td(`performa.urut.${u}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className={cn("transition-opacity", memuat && "opacity-60")} aria-busy={memuat}>
        <Card className="py-0">
          <CardContent className={cn("px-0", data.baris.length === 0 && "p-0")}>
            {data.baris.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title={disaring ? t("performa.kosong.saring") : t("performa.kosong.judul")}
                description={disaring ? undefined : t("performa.kosong.isi")}
              />
            ) : (
              <>
                {adaMenunggu ? (
                  pemantau.keadaan === "SIAP" ? (
                    <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("performa.cek.menunggu")}</p>
                  ) : (
                    // Video yang "Menunggu cek" tidak akan bergerak selama ekstensinya tidak berjalan — katakan sebabnya.
                    <p role="status" className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-900 dark:text-amber-200">
                      <span>{teksKeadaan(pemantau, td, locale)}</span>
                      {pemantau.keadaan === "DIJEDA" || pemantau.keadaan === "NONAKTIF" ? (
                        <Link href="/backoffice/kreatif/pemantauan" className="font-medium underline underline-offset-2">
                          {t("performa.cek.bukaPemantauan")}
                        </Link>
                      ) : null}
                    </p>
                  )
                ) : null}
                <TabelPerforma baris={data.baris} bolehMengelola={bolehMengelola} cek={cek} sedangDicek={sedangDicek} />
              </>
            )}
            {data.total > data.perHalaman ? (
              <div className="border-t px-4 pb-4">
                <Pagination
                  page={data.halaman}
                  totalPages={Math.max(1, Math.ceil(data.total / data.perHalaman))}
                  onPageChange={(halaman) => pergi({ halaman })}
                  totalCount={data.total}
                  pageSize={data.perHalaman}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** "Cek sekarang": antrekan video, lalu kabarkan kapan ekstensi kira-kira mengerjakannya. */
/** "12.27" — jam WIB. */
/** Satu kalimat keadaan ekstensi pemantau — dipakai toast "Cek sekarang" dan baris "Menunggu cek". */
function teksKeadaan(p: KeadaanPemantau, td: ReturnType<typeof dinamis>, locale: string): string {
  if (p.keadaan !== "DIJEDA") return td(`performa.cek.keadaan.${p.keadaan}`);
  const jam = jamWib(p.sampai, locale);
  if (p.alasan === "CAPTCHA" || p.alasan === "LOGIN" || p.alasan === "MANUAL" || p.alasan === "DIBLOKIR_TIKTOK") {
    return td(`performa.cek.keadaan.DIJEDA_${p.alasan}`, { jam });
  }
  return td("performa.cek.keadaan.DIJEDA", { jam });
}

function jamWib(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale.startsWith("en") ? "en-GB" : "id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(iso));
}

function useCekSekarang() {
  const t = useTranslations("kreatifRuang");
  const locale = useLocale();
  const td = dinamis(t);
  const router = useRouter();
  const [sedangDicek, setSedangDicek] = useState<Set<string>>(new Set());
  const cek = async (ids: string[]) => {
    setSedangDicek(new Set(ids));
    try {
      const r = await cekSekarangAction(ids);
      if (!r.ok) {
        toast.error(td(`performa.cek.err.${r.kode}`));
        return;
      }
      const bagian = [
        r.diantrekan ? t("performa.cek.diantrekan", { n: r.diantrekan }) : null,
        r.sudahAntre ? t("performa.cek.sudahAntre", { n: r.sudahAntre }) : null,
        r.dilewati ? t("performa.cek.dilewati", { n: r.dilewati }) : null,
      ].filter(Boolean);
      if (r.perangkatDilanjutkan) bagian.push(t("performa.cek.dilanjutkan"));
      const p = r.pemantau;
      const keadaan = p ? teksKeadaan(p, td, locale) : "";
      if (p && p.keadaan !== "SIAP") toast.warning([...bagian, keadaan].join(" "), { duration: 12_000 });
      else toast.success([...bagian, keadaan].join(" "));
      if (r.diantrekan || r.sudahAntre) bangunkanEkstensi();
      router.refresh();
    } catch {
      toast.error(t("performa.cek.err.GAGAL"));
    } finally {
      setSedangDicek(new Set());
    }
  };
  return { cek, sedangDicek };
}

function TabelPerforma({
  baris,
  bolehMengelola,
  cek,
  sedangDicek,
}: {
  baris: BarisPerforma[];
  bolehMengelola: boolean;
  cek: (ids: string[]) => void;
  sedangDicek: Set<string>;
}) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const ada = (k: string) => t.has(k as never);
  const locale = useLocale();
  const router = useRouter();
  const buka = (b: BarisPerforma) => router.push(RUTE_KOLABORASI(b.kolaborasiId));

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("performa.kolom.orang")}</TableHead>
            <TableHead>{t("performa.kolom.tayang")}</TableHead>
            <TableHead className="text-right">{t("performa.kolom.views")}</TableHead>
            <TableHead className="text-right">{t("performa.kolom.like")}</TableHead>
            <TableHead className="text-right">{t("performa.kolom.komentar")}</TableHead>
            <TableHead className="text-right">{t("performa.kolom.share")}</TableHead>
            <TableHead className="text-right">{t("performa.kolom.simpan")}</TableHead>
            <TableHead className="text-right">{t("performa.kolom.er")}</TableHead>
            <TableHead className="text-right">{t("performa.kolom.naik")}</TableHead>
            <TableHead>{t("performa.kolom.dicek")}</TableHead>
            <TableHead>{t("performa.kolom.status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="baris-berurutan">
          {baris.map((b) => (
            <TableRow
              key={b.kontenId}
              className="cursor-pointer"
              onClick={() => buka(b)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  buka(b);
                }
              }}
              tabIndex={0}
              aria-label={t("performa.bukaKolaborasi", { nama: b.nama })}
            >
              <TableCell className="whitespace-normal">
                <div className="min-w-0 max-w-60">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link href={RUTE_KOLABORASI(b.kolaborasiId)} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                      {b.nama}
                    </Link>
                    <Badge variant={b.afiliasi ? "secondary" : "outline"} className="h-5 px-1.5 text-[11px]">
                      {b.afiliasi ? t("performa.badge.afiliasi") : t("performa.badge.kol")}
                    </Badge>
                    {b.terdeteksi ? (
                      <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
                        {t("performa.badge.deteksi")}
                      </Badge>
                    ) : null}
                  </div>
                  {b.handle && `@${b.handle}` !== b.nama ? <p className="truncate text-xs text-muted-foreground">@{b.handle}</p> : null}
                </div>
              </TableCell>
              <TableCell className="text-sm">
                <span className="tabular-nums">{b.tayangAt ? formatDisplayDate(b.tayangAt, locale) : "—"}</span>
                <a
                  href={b.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-tautan hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {td(`performa.bukaDi.${b.platform}`)}
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              </TableCell>
              <TableCell className="text-right text-sm font-medium tabular-nums">{angka(b.angka?.views)}</TableCell>
              <TableCell className="text-right text-sm tabular-nums">{angka(b.angka?.likes)}</TableCell>
              <TableCell className="text-right text-sm tabular-nums">{angka(b.angka?.comments)}</TableCell>
              <TableCell className="text-right text-sm tabular-nums">{angka(b.angka?.shares)}</TableCell>
              <TableCell className="text-right text-sm tabular-nums">{angka(b.angka?.saves)}</TableCell>
              <TableCell className="text-right text-sm tabular-nums">{persen(b.er, locale)}</TableCell>
              <TableCell
                className={cn(
                  "text-right text-sm tabular-nums",
                  b.naik !== null && b.naik > 0 && "text-emerald-700 dark:text-emerald-300",
                  b.naik !== null && b.naik < 0 && "text-red-700 dark:text-red-300",
                )}
              >
                {b.naik === null ? "—" : b.naik > 0 ? `+${angkaTitik(b.naik)}` : angkaTitik(b.naik)}
              </TableCell>
              <TableCell className="text-sm">
                {b.dicekAt ? (
                  <>
                    <span className="block whitespace-nowrap tabular-nums">{formatDisplayDateTime(b.dicekAt, locale)}</span>
                    <span className="text-xs text-muted-foreground">
                      {b.sumber === "ekstensi" ? t("performa.sumber.ekstensi") : t("performa.sumber.manual")}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <StatusPill
                    tone={NADA_STATUS[b.status]}
                    detail={b.status === "GAGAL" && b.alasanGagal ? labelAlasan(td, ada, b.alasanGagal) : undefined}
                  >
                    {td(`performa.status.${b.status}`)}
                  </StatusPill>
                  {bolehMengelola && b.status !== "MENUNGGU" ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      title={t("performa.cek.satuJudul")}
                      aria-label={`${t("performa.cek.satu")}: ${b.nama}`}
                      disabled={sedangDicek.has(b.kontenId)}
                      onClick={(e) => {
                        e.stopPropagation();
                        cek([b.kontenId]);
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {sedangDicek.has(b.kontenId) ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Kode galat cek terakhir (dari ekstensi pemantau); kode yang tidak dikenal tampil apa adanya. */
function labelAlasan(td: ReturnType<typeof dinamis>, ada: (k: string) => boolean, kode: string): string {
  if (ada(`pantau.kode.${kode}`)) return td(`pantau.kode.${kode}`);
  if (ada(`pantau.err.${kode}`)) return td(`pantau.err.${kode}`);
  return kode;
}

function Kpi({ judul, nilai }: { judul: string; nilai: string }) {
  return (
    <Card className="gap-1 px-4 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{judul}</p>
      <p className="text-xl font-semibold tabular-nums">{nilai}</p>
    </Card>
  );
}

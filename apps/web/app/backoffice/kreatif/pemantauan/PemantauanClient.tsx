"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ListChecks, Loader2, MonitorSmartphone, Pause, Play, Plug, RefreshCw, Trash2 } from "lucide-react";
import {
  cabutPerangkatAction,
  jedaPerangkatAction,
  lanjutkanPerangkatAction,
  susunAntreanSekarangAction,
} from "@/app/actions/kreatif-pantau";
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
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { angkaTitik } from "@/lib/creative/angka-konten";
import type { BarisPerangkat, DataPemantauan, KeadaanPerangkat } from "@/lib/creative/pantau-queries";
import { formatDisplayDateTime } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import { cn } from "@/lib/utils";
import { DialogSambung } from "./DialogSambung";
import { KartuPengaturanPantau } from "./KartuPengaturanPantau";

const NADA_KEADAAN: Record<KeadaanPerangkat, StatusTone> = {
  BELUM_TERSAMBUNG: "progress",
  KODE_KEDALUWARSA: "inactive",
  AKTIF: "settled",
  DIJEDA: "waiting",
  DICABUT: "inactive",
};

/** "14.05" WIB dari ISO. */
function jam(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale.startsWith("en") ? "en-GB" : "id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(
    new Date(iso),
  );
}

export function PemantauanClient({ data, bolehMengelola }: { data: DataPemantauan; bolehMengelola: boolean }) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [menyusun, mulaiSusun] = useTransition();
  const [sambung, setSambung] = useState<{ perangkatId?: string; nama?: string } | null>(null);
  const h = data.hariIni;
  const pg = data.pengaturan;

  const susun = () =>
    mulaiSusun(async () => {
      const r = await susunAntreanSekarangAction();
      if (r.ok) {
        toast.success(t("pantau.okSusun", { dibuat: r.dibuat, dilewati: r.dilewati }));
        router.refresh();
      } else toast.error(td(`pantau.err.${r.kode}`));
    });

  const meta = [
    t("pantau.meta", { mulai: pg.jamMulai.replace(":", "."), selesai: pg.jamSelesai.replace(":", ".") }),
    !pg.aktif ? t("pantau.nonaktif") : !data.dalamJam ? t("pantau.diLuarJam") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const totalAntrean = (s: (typeof data.antrean)[number]) => s.profil + s.konten;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("halaman.pemantauan")}
        meta={meta}
        actions={
          bolehMengelola ? (
            <>
              <Button variant="outline" onClick={susun} disabled={menyusun}>
                {menyusun ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                {t("pantau.aksi.susun")}
              </Button>
              <Button onClick={() => setSambung({})}>
                <Plug className="h-4 w-4" aria-hidden />
                {t("pantau.aksi.sambungkan")}
              </Button>
            </>
          ) : null
        }
      />

      <section aria-label={t("pantau.kpi.label")} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi judul={t("pantau.kpi.selesai")} nilai={angkaTitik(h.selesai)} nada="text-emerald-700 dark:text-emerald-300" />
        <Kpi judul={t("pantau.kpi.gagal")} nilai={angkaTitik(h.gagal)} nada={h.gagal > 0 ? "text-red-700 dark:text-red-300" : undefined} />
        <Kpi judul={t("pantau.kpi.kuota")} nilai={angkaTitik(h.kuota)} />
        <Kpi judul={t("pantau.kpi.sisa")} nilai={angkaTitik(h.sisa)} sub={h.dipinjam > 0 ? t("pantau.kpi.dipinjam", { n: h.dipinjam }) : undefined} />
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5" aria-hidden />
              {t("pantau.antrean.judul")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pantau.antrean.status")}</TableHead>
                  <TableHead className="text-right">{t("pantau.antrean.profil")}</TableHead>
                  <TableHead className="text-right">{t("pantau.antrean.konten")}</TableHead>
                  <TableHead className="text-right">{t("pantau.antrean.total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.antrean.map((s) => (
                  <TableRow key={s.status}>
                    <TableCell>{td(`pantau.status.${s.status}`)}</TableCell>
                    <TableCell className="text-right tabular-nums">{angkaTitik(s.profil)}</TableCell>
                    <TableCell className="text-right tabular-nums">{angkaTitik(s.konten)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{angkaTitik(totalAntrean(s))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MonitorSmartphone className="h-5 w-5" aria-hidden />
              {t("pantau.perangkat.judul")}
            </CardTitle>
          </CardHeader>
          <CardContent className={data.perangkat.length ? "px-0 sm:px-6" : undefined}>
            {data.perangkat.length === 0 ? (
              <EmptyState
                icon={MonitorSmartphone}
                title={t("pantau.perangkat.kosong")}
                action={
                  bolehMengelola ? (
                    <Button size="sm" onClick={() => setSambung({})}>
                      <Plug className="h-4 w-4" aria-hidden />
                      {t("pantau.aksi.sambungkan")}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("pantau.perangkat.nama")}</TableHead>
                      <TableHead>{t("pantau.perangkat.status")}</TableHead>
                      <TableHead>{t("pantau.perangkat.terakhirLapor")}</TableHead>
                      {bolehMengelola ? <TableHead className="text-right">{t("pantau.perangkat.aksi")}</TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.perangkat.map((p) => (
                      <BarisPerangkatView
                        key={p.id}
                        p={p}
                        locale={locale}
                        bolehMengelola={bolehMengelola}
                        onKodeBaru={() => setSambung({ perangkatId: p.id, nama: p.nama })}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" aria-hidden />
            {t("pantau.masalah.judul")}
          </CardTitle>
        </CardHeader>
        <CardContent className={data.masalah.length ? "px-0 sm:px-6" : undefined}>
          {data.masalah.length === 0 ? (
            <EmptyState icon={AlertTriangle} title={t("pantau.masalah.kosong")} />
          ) : (
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("pantau.masalah.waktu")}</TableHead>
                    <TableHead>{t("pantau.masalah.perangkat")}</TableHead>
                    <TableHead>{t("pantau.masalah.masalah")}</TableHead>
                    <TableHead>{t("pantau.masalah.kol")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("pantau.masalah.pesan")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.masalah.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="tabular-nums">{formatDisplayDateTime(m.waktu, locale)}</TableCell>
                      <TableCell>{m.perangkat ?? "—"}</TableCell>
                      <TableCell>
                        {m.jenis === "JEDA" ? (
                          <StatusPill tone="waiting">{t("pantau.masalah.dijeda", { alasan: labelKode(td, (k) => t.has(k as never), m.kode) })}</StatusPill>
                        ) : (
                          labelKode(td, (k) => t.has(k as never), m.kode)
                        )}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {m.tugas?.kolId ? (
                          <Link href={`/backoffice/kreatif/kol/${encodeURIComponent(m.tugas.kolId)}?tab=pengikut`} className="text-tautan hover:underline">
                            {m.tugas.kolNama}
                          </Link>
                        ) : (
                          "—"
                        )}
                        {m.tugas ? <span className="block text-xs text-muted-foreground">{td(`pantau.jenisTugas.${m.tugas.jenis}`)}</span> : null}
                      </TableCell>
                      <TableCell className="hidden max-w-xs whitespace-normal break-words text-sm text-muted-foreground 2xl:table-cell">{m.pesan ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <KartuPengaturanPantau awal={pg} bolehMengelola={bolehMengelola} />

      {sambung ? (
        <DialogSambung
          perangkatId={sambung.perangkatId}
          nama={sambung.nama}
          onTutup={(berubah) => {
            setSambung(null);
            if (berubah) router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/** Label kode masalah/jeda; kode yang tidak dikenal tampil apa adanya. */
function labelKode(td: ReturnType<typeof dinamis>, ada: (k: string) => boolean, kode: string | null): string {
  if (!kode) return "—";
  if (ada(`pantau.kode.${kode}`)) return td(`pantau.kode.${kode}`);
  if (ada(`pantau.err.${kode}`)) return td(`pantau.err.${kode}`);
  return kode;
}

function Kpi({ judul, nilai, sub, nada }: { judul: string; nilai: string; sub?: string; nada?: string }) {
  return (
    <Card className="gap-1 px-4 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{judul}</p>
      <p className={cn("text-xl font-semibold tabular-nums", nada)}>{nilai}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </Card>
  );
}

function BarisPerangkatView({
  p,
  locale,
  bolehMengelola,
  onKodeBaru,
}: {
  p: BarisPerangkat;
  locale: string;
  bolehMengelola: boolean;
  onKodeBaru: () => void;
}) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [bukaCabut, setBukaCabut] = useState(false);

  const jalankan = (fn: () => Promise<{ ok: boolean; kode?: string }>, ok: string) =>
    mulai(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        setBukaCabut(false);
        router.refresh();
      } else toast.error(td(`pantau.err.${r.kode ?? "GAGAL"}`));
    });

  const detail =
    p.keadaan === "DIJEDA"
      ? [p.alasanJeda ? td(`pantau.alasanJeda.${p.alasanJeda}`) : null, p.dijedaSampai ? t("pantau.perangkat.sampai", { jam: jam(p.dijedaSampai, locale) }) : t("pantau.perangkat.sampaiDilanjutkan")]
          .filter(Boolean)
          .join(" · ")
      : p.keadaan === "BELUM_TERSAMBUNG" && p.kodeBerlakuSampai
        ? t("pantau.perangkat.kodeSampai", { jam: jam(p.kodeBerlakuSampai, locale) })
        : p.versi
          ? t("pantau.perangkat.versi", { versi: p.versi })
          : null;

  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        <span className="font-medium">{p.nama}</span>
        {p.dibuatOleh ? <span className="block text-xs text-muted-foreground">{t("pantau.perangkat.oleh", { nama: p.dibuatOleh })}</span> : null}
      </TableCell>
      <TableCell>
        <StatusPill tone={NADA_KEADAAN[p.keadaan]} detail={detail ?? undefined}>
          {td(`pantau.keadaan.${p.keadaan}`)}
        </StatusPill>
      </TableCell>
      <TableCell className="tabular-nums">{p.terakhirLaporAt ? formatDisplayDateTime(p.terakhirLaporAt, locale) : t("pantau.perangkat.belumLapor")}</TableCell>
      {bolehMengelola ? (
        <TableCell className="text-right">
          {p.keadaan === "DICABUT" ? null : (
            <div className="flex flex-wrap justify-end gap-1.5">
              {p.keadaan === "AKTIF" ? (
                <Button size="sm" variant="outline" disabled={sibuk} onClick={() => jalankan(() => jedaPerangkatAction(p.id), t("pantau.okJeda"))}>
                  <Pause className="h-4 w-4" aria-hidden />
                  {t("pantau.aksi.jeda")}
                </Button>
              ) : null}
              {p.keadaan === "DIJEDA" ? (
                <Button size="sm" variant="outline" disabled={sibuk} onClick={() => jalankan(() => lanjutkanPerangkatAction(p.id), t("pantau.okLanjut"))}>
                  <Play className="h-4 w-4" aria-hidden />
                  {t("pantau.aksi.lanjutkan")}
                </Button>
              ) : null}
              <Button size="sm" variant="outline" disabled={sibuk} onClick={onKodeBaru}>
                <Plug className="h-4 w-4" aria-hidden />
                {t("pantau.aksi.kodeBaru")}
              </Button>
              <Button size="sm" variant="ghost" disabled={sibuk} onClick={() => setBukaCabut(true)} aria-label={t("pantau.aksi.cabutNama", { nama: p.nama })}>
                <Trash2 className="h-4 w-4" aria-hidden />
                {t("pantau.aksi.cabut")}
              </Button>
            </div>
          )}
          <AlertDialog open={bukaCabut} onOpenChange={(b) => !sibuk && setBukaCabut(b)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("pantau.cabut.judul", { nama: p.nama })}</AlertDialogTitle>
                <AlertDialogDescription>{t("pantau.cabut.isi")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={sibuk}>{t("pantau.cabut.batal")}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={sibuk}
                  onClick={(e) => {
                    e.preventDefault();
                    jalankan(() => cabutPerangkatAction(p.id), t("pantau.okCabut"));
                  }}
                >
                  {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  {t("pantau.aksi.cabut")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TableCell>
      ) : null}
    </TableRow>
  );
}

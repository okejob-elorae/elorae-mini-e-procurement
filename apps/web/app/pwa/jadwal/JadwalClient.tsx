"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, CircleCheck, CircleX, Route, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";
import type { RingkasJadwal, StatusJadwal } from "@/lib/salesman/jadwal";
import { cn } from "@/lib/utils";

import { TautanKembali } from "@/app/pwa/TautanKembali";
export type DataJadwal = {
  tanggal: string;
  hariIni: string;
  /** Sudah diformat di server. */
  rentang: string;
  mingguIni: boolean;
  /** Tautan minggu tetangga; null = di luar jangkauan. */
  sebelum: string | null;
  sesudah: string | null;
  ringkas: RingkasJadwal;
  hari: {
    dayKey: string;
    hariPendek: string;
    tanggalAngka: string;
    labelPanjang: string;
    href: string;
    ringkas: RingkasJadwal;
    toko: {
      storeId: string;
      nama: string;
      alamat: string | null;
      area: string | null;
      catatan: string | null;
      status: StatusJadwal;
    }[];
  }[];
};

const NADA: Record<StatusJadwal, string> = {
  DIKUNJUNGI: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  TERLEWAT: "bg-destructive/10 text-destructive",
  MENUNGGU: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  IZIN: "bg-muted text-muted-foreground",
};

/**
 * Jadwal minggu ini dari kantor. Hari yang dipilih paling atas (bawaan hari
 * ini), lalu hari sesudahnya, lalu yang sudah lewat — yang dicari salesman
 * adalah "hari ini ke mana", bukan urutan kalender.
 */
export function JadwalClient({ data }: { data: DataJadwal }) {
  const t = useTranslations("pwa.jadwal");
  const td = dinamis(t);

  const i = Math.max(0, data.hari.findIndex((h) => h.dayKey === data.tanggal));
  const urut = [...data.hari.slice(i), ...data.hari.slice(0, i)];
  const tampil = urut.filter((h) => h.dayKey === data.tanggal || h.toko.length > 0);

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa" />
      </Button>

      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <div className="flex items-center justify-between gap-2">
        {data.sebelum ? (
          <Button asChild variant="outline" size="icon" aria-label={t("weekPrev")}>
            <Link href={data.sebelum} replace>
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        ) : (
          <span className="h-11 w-11" aria-hidden />
        )}
        <div className="text-center">
          <p className="font-semibold tabular-nums">{data.rentang}</p>
          {data.mingguIni ? (
            <p className="text-xs text-muted-foreground">{t("thisWeek")}</p>
          ) : (
            <Link href="/pwa/jadwal" className="text-xs font-medium underline decoration-primary decoration-2 underline-offset-4">
              {t("backToThisWeek")}
            </Link>
          )}
        </div>
        {data.sesudah ? (
          <Button asChild variant="outline" size="icon" aria-label={t("weekNext")}>
            <Link href={data.sesudah} replace>
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        ) : (
          <span className="h-11 w-11" aria-hidden />
        )}
      </div>

      {/* Hari sebagai tautan: alamatnya sama dengan tautan kabar jadwal. */}
      <nav aria-label={t("dayPicker")}>
        <ul className="grid grid-cols-7 gap-1">
          {data.hari.map((h) => {
            const aktif = h.dayKey === data.tanggal;
            return (
              <li key={h.dayKey}>
                <Link
                  href={h.href}
                  replace
                  aria-current={aktif ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center rounded-lg border px-0.5 py-1 text-center transition-colors",
                    aktif ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted/60",
                  )}
                >
                  <span className={cn("text-[11px] leading-tight", !aktif && "text-muted-foreground")}>
                    {h.dayKey === data.hariIni ? t("todayShort") : h.hariPendek}
                  </span>
                  <span className="text-base font-semibold leading-tight tabular-nums">{h.tanggalAngka}</span>
                  <span className={cn("text-[10px] leading-tight tabular-nums", !aktif && "text-muted-foreground")}>
                    {h.toko.length > 0 ? t("countShort", { count: h.toko.length }) : "·"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {data.ringkas.direncanakan === 0 ? (
        <section className="beranda-kartu space-y-2 text-sm">
          <p className="font-medium">{t("emptyWeek")}</p>
          <p className="text-muted-foreground">{t("emptyWeekHint")}</p>
        </section>
      ) : (
        tampil.map((h) => {
          const lewat = h.dayKey < data.hariIni;
          const hariIni = h.dayKey === data.hariIni;
          return (
            <section key={h.dayKey} className={cn("beranda-kartu beranda-kartu-daftar", lewat && "opacity-90")}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 px-4 pt-3">
                <h2 className="beranda-judul">
                  {h.labelPanjang}
                  {hariIni ? <Badge className="ml-2 align-middle">{t("todayShort")}</Badge> : null}
                </h2>
                {h.toko.length > 0 ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {lewat || hariIni
                      ? t("progress", { dikunjungi: h.ringkas.dikunjungi, direncanakan: h.ringkas.direncanakan })
                      : t("count", { count: h.toko.length })}
                  </span>
                ) : null}
              </div>
              {h.toko.length === 0 ? (
                <p className="px-4 pb-3 pt-1 text-sm text-muted-foreground">{t("emptyDay")}</p>
              ) : (
                <ul className="mt-2 divide-y border-t">
                  {h.toko.map((x) => (
                    <li key={x.storeId}>
                      <Link
                        href={`/pwa/stores/${x.storeId}`}
                        className="flex min-h-14 items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
                      >
                        <span
                          className={cn(
                            "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                            x.status === "DIKUNJUNGI"
                              ? "bg-emerald-600 text-white dark:bg-emerald-500"
                              : "bg-primary text-primary-foreground",
                          )}
                        >
                          {x.status === "DIKUNJUNGI" ? (
                            <CircleCheck className="h-4 w-4" aria-hidden />
                          ) : x.status === "TERLEWAT" && lewat ? (
                            <CircleX className="h-4 w-4" aria-hidden />
                          ) : (
                            <Store className="h-4 w-4" aria-hidden />
                          )}
                        </span>
                        <span className="min-w-0 flex-1 space-y-1">
                          <span className="block truncate font-medium leading-tight">{x.nama}</span>
                          {x.alamat ? <span className="block truncate text-xs text-muted-foreground">{x.alamat}</span> : null}
                          {x.catatan ? (
                            <span className="block text-xs leading-snug text-foreground">
                              <span className="font-medium">{t("officeNote")}</span> {x.catatan}
                            </span>
                          ) : null}
                          {lewat || hariIni ? (
                            <Badge variant="outline" className={cn("border-transparent", NADA[x.status])}>
                              {td(`status.${x.status}`)}
                            </Badge>
                          ) : null}
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {hariIni && h.ringkas.menunggu > 0 ? (
                <div className="border-t p-3">
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/pwa/rute">
                      <Route className="h-4 w-4" aria-hidden />
                      {t("openRoute")}
                    </Link>
                  </Button>
                </div>
              ) : null}
            </section>
          );
        })
      )}
    </div>
  );
}

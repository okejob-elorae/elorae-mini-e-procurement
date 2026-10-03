"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, Megaphone, Pin } from "lucide-react";
import type { DataKartuPengumuman } from "@/lib/pengumuman/queries";
import { cn } from "@/lib/utils";
import { LencanaKonfirmasi } from "@/app/pwa/pengumuman/LencanaKonfirmasi";

/**
 * Kartu "Pengumuman" di beranda salesman dan SPG: yang tersemat, menunggu
 * "Saya mengerti", atau belum dibaca — paling banyak tiga, dengan jumlah belum
 * dibaca. Data dari `kartuPengumumanBeranda` (null = tidak ada yang perlu
 * dilihat, kartunya tidak tampil).
 */
export function KartuPengumuman({ data }: { data: DataKartuPengumuman | null }) {
  const t = useTranslations("pwa.pengumuman");
  if (!data || data.baris.length === 0) return null;

  return (
    <section className="beranda-kartu beranda-kartu-daftar" aria-labelledby="kartu-pengumuman-judul">
      <div className="flex items-baseline justify-between gap-2 px-4 pb-1 pt-3">
        <h2 id="kartu-pengumuman-judul" className="beranda-judul flex items-center gap-2">
          {t("kartuJudul")}
          {data.belumDibaca > 0 ? (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground tabular-nums">
              <span className="sr-only">{t("belumDibacaN", { count: data.belumDibaca })}</span>
              <span aria-hidden>{data.belumDibaca}</span>
            </span>
          ) : null}
        </h2>
        <Link
          href="/pwa/pengumuman"
          className="-my-2 inline-flex min-h-11 items-center text-xs font-medium underline decoration-primary decoration-2 underline-offset-4"
        >
          {data.lainnya > 0 ? t("lihatSemuaLainnya", { n: data.lainnya }) : t("lihatSemua")}
        </Link>
      </div>
      <ul className="divide-y">
        {data.baris.map((b) => (
          <li key={b.id}>
            <Link
              href={`/pwa/pengumuman/${b.id}`}
              className="flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                {b.pinned ? <Pin className="h-4 w-4" aria-hidden /> : <Megaphone className="h-4 w-4" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate leading-tight", b.dibaca ? "font-medium" : "font-semibold")}>
                  {!b.dibaca ? <span className="sr-only">{t("belumDibaca")}: </span> : null}
                  {b.title}
                </span>
                <span className="mt-0.5 line-clamp-1 block text-sm text-muted-foreground">{b.cuplikan}</span>
                {b.perluKonfirmasi ? (
                  <span className="mt-1 block text-xs">
                    <LencanaKonfirmasi perlu sudah={false} />
                  </span>
                ) : null}
              </span>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

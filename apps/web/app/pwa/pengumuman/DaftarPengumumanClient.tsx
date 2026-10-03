"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, Megaphone, Pin } from "lucide-react";
import type { BarisPengumumanHp } from "@/lib/pengumuman/queries";
import { cn } from "@/lib/utils";
import { LencanaKonfirmasi } from "./LencanaKonfirmasi";

export function DaftarPengumumanClient({ baris }: { baris: BarisPengumumanHp[] }) {
  const t = useTranslations("pwa.pengumuman");
  const belum = baris.filter((b) => !b.dibaca).length;

  return (
    <div className="space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("judul")}</h1>
        <p className="text-sm text-muted-foreground">{t("subjudul")}</p>
      </header>

      {baris.length === 0 ? (
        <section className="beranda-kartu flex flex-col items-center gap-2 py-8 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <Megaphone className="h-6 w-6" aria-hidden />
          </span>
          <p className="font-semibold">{t("kosong")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("kosongHint")}</p>
        </section>
      ) : (
        <>
          <p className="text-sm font-medium" aria-live="polite">
            {belum > 0 ? t("belumDibacaN", { count: belum }) : t("semuaDibaca")}
          </p>
          <section className="beranda-kartu beranda-kartu-daftar" aria-label={t("judul")}>
            <ul className="divide-y">
              {baris.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/pwa/pengumuman/${b.id}`}
                    className="flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
                  >
                    <span
                      className={cn(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                        b.dibaca ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
                      )}
                    >
                      {b.pinned ? <Pin className="h-4 w-4" aria-hidden /> : <Megaphone className="h-4 w-4" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block leading-tight", b.dibaca ? "font-medium" : "font-semibold")}>
                        {!b.dibaca ? <span className="sr-only">{t("belumDibaca")}: </span> : null}
                        {b.pinned ? <span className="sr-only">{t("disematkan")}: </span> : null}
                        {b.title}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{b.cuplikan}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="tabular-nums">{b.terbit}</span>
                        <LencanaKonfirmasi perlu={b.perluKonfirmasi} sudah={b.dikonfirmasi} />
                      </span>
                    </span>
                    {!b.dibaca ? <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-hidden /> : null}
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

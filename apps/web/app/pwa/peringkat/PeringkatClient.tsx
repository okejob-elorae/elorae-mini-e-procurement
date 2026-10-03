"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, Coins, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import { formatPersen, namaBulan } from "@/lib/salesman/komisi";
import { cn } from "@/lib/utils";

import { TautanKembali } from "@/app/pwa/TautanKembali";
export type BarisPeringkatJson = {
  peringkat: number;
  posisi: number;
  /** null = disembunyikan pengaturan pemilik. */
  nama: string | null;
  persen: number | null;
  /** Hanya terisi untuk diri sendiri. */
  omzet: number | null;
  adaTarget: boolean;
  diriSendiri: boolean;
};

/** Tiga teratas diberi warna piala; sisanya netral. */
const NADA_JUARA: Record<number, string> = {
  1: "bg-amber-400 text-amber-950",
  2: "bg-slate-300 text-slate-900",
  3: "bg-orange-300 text-orange-950",
};

function Baris({ b, label, persen }: { b: BarisPeringkatJson; label: string; persen: (n: number) => string }) {
  const t = useTranslations("pwa.peringkat");
  const lebar = b.persen === null ? 0 : Math.min(100, b.persen);
  return (
    <li
      className={cn("flex min-h-14 items-center gap-3 px-4 py-2.5", b.diriSendiri && "bg-primary/10")}
      aria-current={b.diriSendiri ? "true" : undefined}
    >
      <span
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums",
          NADA_JUARA[b.peringkat] ?? "bg-muted text-muted-foreground",
        )}
        aria-label={t("rankLabel", { rank: b.peringkat })}
      >
        {b.peringkat}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5">
          <span className={cn("truncate leading-tight", b.diriSendiri ? "font-semibold" : "font-medium")}>{label}</span>
          {b.diriSendiri ? (
            <Badge className="shrink-0 border-0 bg-primary px-1.5 py-0 text-[10px] text-primary-foreground">{t("you")}</Badge>
          ) : null}
        </p>
        {b.adaTarget ? (
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-primary" style={{ width: `${lebar}%` }} />
          </div>
        ) : b.diriSendiri && b.omzet !== null ? (
          <p className="text-xs text-muted-foreground tabular-nums">{t("yourSales", { amount: formatIDR(b.omzet) })}</p>
        ) : null}
      </div>
      <span className="shrink-0 text-right text-sm font-semibold tabular-nums">
        {b.persen !== null ? `${persen(b.persen)}%` : <span className="text-xs font-normal text-muted-foreground">{t("noTargetShort")}</span>}
      </span>
    </li>
  );
}

/**
 * Papan peringkat. Yang bertarget diurutkan menurut capaian; yang belum punya
 * target di bagian terpisah di bawah, diurutkan menurut omzet — omzetnya
 * sendiri tidak ditampilkan kecuali milik penonton.
 */
export function PeringkatClient({ bulan, baris }: { bulan: string; baris: BarisPeringkatJson[] }) {
  const t = useTranslations("pwa.peringkat");
  const tBulan = dinamis(useTranslations("komisiSalesman"));
  const locale = useLocale();
  const persen = (n: number) => formatPersen(n, locale);
  const label = (b: BarisPeringkatJson) => b.nama ?? t("anonymous", { n: b.posisi });

  const bertarget = baris.filter((b) => b.adaTarget);
  const tanpaTarget = baris.filter((b) => !b.adaTarget);
  const saya = baris.find((b) => b.diriSendiri) ?? null;

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa" />
      </Button>

      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle", { month: namaBulan(tBulan, bulan, "panjang") })}</p>
      </header>

      {saya ? (
        <section className="beranda-kartu beranda-kartu-utama">
          <h2 className="beranda-judul">{t("youTitle")}</h2>
          <p className="mt-1 flex items-baseline gap-2">
            <Trophy className="h-6 w-6 self-center" aria-hidden />
            <span className="text-3xl font-semibold tabular-nums">#{saya.peringkat}</span>
            <span className="text-sm opacity-80">{t("ofTotal", { total: baris.length })}</span>
          </p>
          <p className="mt-1 text-sm tabular-nums opacity-90">
            {saya.persen !== null ? t("yourAchievement", { pct: persen(saya.persen) }) : t("yourNoTarget")}
          </p>
        </section>
      ) : null}

      {baris.length === 0 ? (
        <section className="beranda-kartu">
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        </section>
      ) : null}

      {bertarget.length > 0 ? (
        <section className="beranda-kartu beranda-kartu-daftar" aria-label={t("withTargetTitle")}>
          <h2 className="beranda-judul px-4 pt-4">{t("withTargetTitle")}</h2>
          <ul className="mt-2 divide-y">
            {bertarget.map((b) => (
              <Baris key={b.posisi} b={b} label={label(b)} persen={persen} />
            ))}
          </ul>
        </section>
      ) : null}

      {tanpaTarget.length > 0 ? (
        <section className="beranda-kartu beranda-kartu-daftar" aria-label={t("noTargetTitle")}>
          <h2 className="beranda-judul px-4 pt-4">{t("noTargetTitle")}</h2>
          <p className="px-4 text-xs text-muted-foreground">{t("noTargetHint")}</p>
          <ul className="mt-2 divide-y">
            {tanpaTarget.map((b) => (
              <Baris key={b.posisi} b={b} label={label(b)} persen={persen} />
            ))}
          </ul>
        </section>
      ) : null}

      <nav className="beranda-kartu beranda-kartu-daftar" aria-label={t("moreLabel")}>
        <Link href="/pwa/insentif" className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/60">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Coins className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium leading-tight">{t("incentiveLink")}</span>
            <span className="block text-xs text-muted-foreground">{t("incentiveHint")}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      </nav>
    </div>
  );
}

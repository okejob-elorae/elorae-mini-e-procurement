"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, Target, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import { namaBulan } from "@/lib/salesman/komisi";
import { cn } from "@/lib/utils";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

export type BarisPeringkatSpgJson = {
  peringkat: number;
  posisi: number;
  /** null = disembunyikan pengaturan pemilik. */
  nama: string | null;
  /** Toko rekan — hanya bila namanya terlihat. */
  toko: string | null;
  /** Hanya terisi untuk diri sendiri. */
  omzet: number | null;
  pcs: number | null;
  diriSendiri: boolean;
};

const NADA_JUARA: Record<number, string> = {
  1: "bg-amber-400 text-amber-950",
  2: "bg-slate-300 text-slate-900",
  3: "bg-orange-300 text-orange-950",
};

/**
 * Papan peringkat SPG: diurutkan menurut penjualan bersih bulan ini (nota
 * dikurangi retur pembeli). Rupiah rekan tidak pernah sampai ke HP — yang
 * terlihat hanya urutannya; angka sendiri ada di kartu "Posisi Anda".
 */
export function PeringkatSpgClient({ bulan, baris }: { bulan: string; baris: BarisPeringkatSpgJson[] }) {
  const t = useTranslations("pwa.peringkatSpg");
  const tUmum = useTranslations("pwa.peringkat");
  const tBulan = dinamis(useTranslations("komisiSalesman"));
  const saya = baris.find((b) => b.diriSendiri) ?? null;
  const label = (b: BarisPeringkatSpgJson) => b.nama ?? t("anonim", { n: b.posisi });

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa" />
      </Button>

      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{tUmum("title")}</h1>
          <TombolBantuanHp judul={tUmum("title")} />
        </div>
        <p className="text-sm text-muted-foreground">{t("subjudul", { month: namaBulan(tBulan, bulan, "panjang") })}</p>
      </header>

      {saya ? (
        <section className="beranda-kartu beranda-kartu-utama">
          <h2 className="beranda-judul">{tUmum("youTitle")}</h2>
          <p className="mt-1 flex items-baseline gap-2">
            <Trophy className="h-6 w-6 self-center" aria-hidden />
            <span className="text-3xl font-semibold tabular-nums">#{saya.peringkat}</span>
            <span className="text-sm opacity-80">{t("dariTotal", { total: baris.length })}</span>
          </p>
          {saya.omzet !== null ? (
            <p className="mt-1 text-sm tabular-nums opacity-90">{t("penjualanAnda", { amount: formatIDR(saya.omzet) })}</p>
          ) : null}
          {saya.pcs !== null ? <p className="text-sm tabular-nums opacity-90">{t("pcsAnda", { n: saya.pcs })}</p> : null}
        </section>
      ) : null}

      {baris.length === 0 ? (
        <section className="beranda-kartu">
          <p className="text-sm text-muted-foreground">{t("kosong")}</p>
        </section>
      ) : (
        <section className="beranda-kartu beranda-kartu-daftar" aria-label={t("daftarJudul")}>
          <h2 className="beranda-judul px-4 pt-4">{t("daftarJudul")}</h2>
          <ul className="mt-2 divide-y">
            {baris.map((b) => (
              <li
                key={b.posisi}
                className={cn("flex min-h-14 items-center gap-3 px-4 py-2.5", b.diriSendiri && "bg-primary/10")}
                aria-current={b.diriSendiri ? "true" : undefined}
              >
                <span
                  className={cn(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums",
                    NADA_JUARA[b.peringkat] ?? "bg-muted text-muted-foreground",
                  )}
                  aria-label={tUmum("rankLabel", { rank: b.peringkat })}
                >
                  {b.peringkat}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5">
                    <span className={cn("truncate leading-tight", b.diriSendiri ? "font-semibold" : "font-medium")}>
                      {label(b)}
                    </span>
                    {b.diriSendiri ? (
                      <Badge className="shrink-0 border-0 bg-primary px-1.5 py-0 text-[10px] text-primary-foreground">
                        {tUmum("you")}
                      </Badge>
                    ) : null}
                  </p>
                  {b.toko ? <p className="truncate text-xs text-muted-foreground">{b.toko}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="beranda-kartu beranda-kartu-daftar" aria-label={tUmum("moreLabel")}>
        <Link href="/pwa/target" className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/60">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Target className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium leading-tight">{t("targetLink")}</span>
            <span className="block text-xs text-muted-foreground">{t("targetHint")}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      </nav>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, Lightbulb } from "lucide-react";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { NADA_STATUS_REKOMENDASI } from "@/app/pwa/rekomendasi/tampilan";
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";
import type { BarisDaftarRekomendasi } from "@/lib/salesman/rekomendasi-queries";
import { cn } from "@/lib/utils";

/** Daftar rekomendasi barang dari sales untuk toko SPG ini. Tanpa harga. */
export function RekomendasiSpgClient({ namaToko, baris, menunggu }: { namaToko: string; baris: BarisDaftarRekomendasi[]; menunggu: number }) {
  const t = useTranslations("spgRekomendasi");
  const td = dinamis(useTranslations("pwaRekomendasi"));

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan="/pwa/spg/lainnya" />
      </Button>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("judul")}</h1>
        <p className="truncate text-sm text-muted-foreground">{namaToko}</p>
        <p className="text-sm text-muted-foreground">{menunggu > 0 ? t("menunggu", { n: menunggu }) : t("tidakMenunggu")}</p>
      </header>

      {baris.length === 0 ? (
        <section className="beranda-kartu flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Lightbulb className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold leading-tight">{t("kosongJudul")}</h2>
            <p className="text-sm text-muted-foreground">{t("kosongIsi")}</p>
          </div>
        </section>
      ) : (
        <section className="beranda-kartu beranda-kartu-daftar" aria-label={t("judul")}>
          <ul className="divide-y">
            {baris.map((b) => (
              <li key={b.id}>
                <Link href={`/pwa/spg/rekomendasi/${b.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Lightbulb className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block font-medium leading-tight">{b.orang ? t("dari", { nama: b.orang }) : t("dariSales")}</span>
                    <span className="block text-xs text-muted-foreground">
                      {b.dibuat} · {t("isi", { baris: b.baris, pcs: b.pcs })}
                    </span>
                    <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", NADA_STATUS_REKOMENDASI[b.status])}>
                      {b.status === "TERKIRIM" ? t("perluDijawab") : td(`status.${b.status}`)}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="px-1 text-xs text-muted-foreground">{t("petunjuk")}</p>
    </div>
  );
}

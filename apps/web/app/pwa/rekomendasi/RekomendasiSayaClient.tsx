"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, Lightbulb, Store } from "lucide-react";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";
import { FILTER_REKOMENDASI, type FilterRekomendasi } from "@/lib/salesman/rekomendasi-aturan";
import type { BarisDaftarRekomendasi } from "@/lib/salesman/rekomendasi-queries";
import { cn } from "@/lib/utils";
import { NADA_STATUS_REKOMENDASI } from "./tampilan";

/**
 * Daftar rekomendasi milik salesman. Saringan status di alamat (`?status=`),
 * berpindah dengan `replace` supaya "Kembali" tidak berjalan mundur melewati
 * setiap saringan.
 */
export function RekomendasiSayaClient({
  filter,
  baris,
  jumlah,
}: {
  filter: FilterRekomendasi;
  baris: BarisDaftarRekomendasi[];
  jumlah: Record<FilterRekomendasi, number>;
}) {
  const t = useTranslations("pwaRekomendasi");
  const td = dinamis(t);
  const router = useRouter();
  const [menunggu, mulai] = useTransition();

  const pilih = (f: FilterRekomendasi) => {
    if (f === filter) return;
    mulai(() => router.replace(f === "SEMUA" ? "/pwa/rekomendasi" : `/pwa/rekomendasi?status=${f}`, { scroll: false }));
  };

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan="/pwa/lainnya" />
      </Button>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("saya.judul")}</h1>
        <p className="text-sm text-muted-foreground">{t("saya.subjudul")}</p>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("saya.saring")}>
        {FILTER_REKOMENDASI.map((f) => (
          <Button
            key={f}
            type="button"
            size="sm"
            variant={f === filter ? "default" : "outline"}
            aria-pressed={f === filter}
            disabled={menunggu}
            onClick={() => pilih(f)}
          >
            {f === "SEMUA" ? t("saya.semua") : td(`status.${f}`)}
            <span className="tabular-nums opacity-80">{jumlah[f]}</span>
          </Button>
        ))}
      </div>

      <div className={cn("transition-opacity", menunggu && "opacity-60")} aria-busy={menunggu}>
        {baris.length === 0 ? (
          <section className="beranda-kartu flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <Lightbulb className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold leading-tight">{filter === "SEMUA" ? t("saya.kosongJudul") : t("saya.kosongSaring")}</h2>
              <p className="text-sm text-muted-foreground">{t("saya.kosongIsi")}</p>
            </div>
          </section>
        ) : (
          <section className="beranda-kartu beranda-kartu-daftar" aria-label={t("saya.judul")}>
            <ul className="divide-y">
              {baris.map((b) => (
                <li key={b.id}>
                  <Link href={`/pwa/rekomendasi/${b.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Store className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="block font-medium leading-tight">{b.toko}</span>
                      <span className="block text-xs text-muted-foreground">
                        {b.dibuat} · {t("isi", { baris: b.baris, pcs: b.pcs })}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", NADA_STATUS_REKOMENDASI[b.status])}>
                          {td(`status.${b.status}`)}
                        </span>
                        {b.status === "DITERIMA" ? <span className="text-xs font-medium">{t("saya.siapDipesan")}</span> : null}
                        {b.orang ? <span className="text-xs text-muted-foreground">{t("saya.dijawabOleh", { nama: b.orang })}</span> : null}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <p className="px-1 text-xs text-muted-foreground">{t("saya.petunjuk")}</p>
    </div>
  );
}

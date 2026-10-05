"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BellRing, ChevronRight, PackageCheck, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { dinamis } from "@/lib/i18n/dinamis";
import type { BarisTitipHp, DaftarTitipHp } from "@/lib/spg/titip-queries";
import { cn } from "@/lib/utils";
import { nadaKelompokTitip } from "./tampilan";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

export type TabTitip = "datang" | "dikabari" | "menunggu";

/**
 * Titip pesan dalam tiga kelompok. Tab berpindah dengan `replace`, supaya
 * "Kembali" tidak berjalan mundur melewati setiap tab yang dibuka.
 */
export function DaftarTitipClient({ namaToko, tab, data }: { namaToko: string; tab: TabTitip; data: DaftarTitipHp }) {
  const t = useTranslations("spgTitip");
  const td = dinamis(t);
  const bahasa = useLocale() === "en" ? "en" : "id";
  const router = useRouter();

  const tabs: { kunci: TabTitip; jumlah: number }[] = [
    { kunci: "datang", jumlah: data.datang.length },
    { kunci: "dikabari", jumlah: data.dikabari.length },
    { kunci: "menunggu", jumlah: data.menunggu.length },
  ];
  const daftar = data[tab];

  const keteranganStok = (r: BarisTitipHp) => {
    if (r.kelompok === "dikabari") return r.lewat ? t("lewatMasaSimpan") : r.sampai ? t("disimpanSampai", { tanggal: r.sampai[bahasa] }) : null;
    if (r.stok === null) return t("stokBebas");
    return r.stok > 0 ? t("stokAda", { n: r.stok }) : t("stokBelum");
  };

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan="/pwa/spg/lainnya" />
      </Button>
      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("judul")}</h1>
          <TombolBantuanHp judul={t("judul")} />
        </div>
        <p className="truncate text-sm text-muted-foreground">{namaToko}</p>
      </header>

      <Button asChild size="lg" className="w-full">
        <Link href="/pwa/spg/titip/baru">
          <Plus className="h-4 w-4" aria-hidden />
          {t("baru")}
        </Link>
      </Button>

      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label={t("judul")}>
        {tabs.map((x) => (
          <Button
            key={x.kunci}
            type="button"
            role="tab"
            aria-selected={tab === x.kunci}
            variant={tab === x.kunci ? "default" : "outline"}
            className="h-auto flex-col gap-0 whitespace-normal px-2 py-2"
            onClick={() => router.replace(`/pwa/spg/titip?tab=${x.kunci}`, { scroll: false })}
          >
            <span className="text-sm font-medium">{td(`kelompok.${x.kunci}`)}</span>
            <span className="text-xs tabular-nums opacity-80">{x.jumlah}</span>
          </Button>
        ))}
      </div>

      {daftar.length === 0 ? (
        <section className="beranda-kartu flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <BellRing className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold leading-tight">{td(`kosong.${tab}.judul`)}</h2>
            <p className="text-sm text-muted-foreground">{td(`kosong.${tab}.isi`)}</p>
          </div>
        </section>
      ) : (
        <section className="beranda-kartu beranda-kartu-daftar">
          <ul className="divide-y">
            {daftar.map((r) => {
              const Ikon = r.kelompok === "datang" ? PackageCheck : r.kelompok === "dikabari" ? Send : BellRing;
              const ket = keteranganStok(r);
              return (
                <li key={r.id}>
                  <Link href={`/pwa/spg/titip/${r.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Ikon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="block break-words font-medium leading-tight">{r.keterangan}</span>
                      <span className="block break-words text-xs text-muted-foreground">{t("untuk", { nama: r.pembeli, qty: r.qty })}</span>
                      <span className="block text-xs text-muted-foreground">{t("dicatat", { tanggal: r.dibuat[bahasa] })}</span>
                      {ket ? (
                        <span
                          className={cn(
                            "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                            r.lewat ? "bg-destructive/10 text-destructive" : nadaKelompokTitip(r.kelompok, r.status),
                          )}
                        >
                          {ket}
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

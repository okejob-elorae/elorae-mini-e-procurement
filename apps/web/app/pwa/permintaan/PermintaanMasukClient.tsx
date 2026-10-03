"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, Inbox, X } from "lucide-react";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";
import type { StatusPermintaan } from "@/lib/spg/kantor-queries";
import { STATUS_PERMINTAAN } from "@/lib/spg/saran-minta";
import type { PermintaanMasuk } from "@/lib/spg/permintaan-salesman";
import { cn } from "@/lib/utils";
import { nadaStatusPermintaan } from "./tampilan";

export type PermintaanMasukTampil = PermintaanMasuk & { dibuatLabel: string };

/**
 * Daftar permintaan SPG di toko yang dipegang salesman, per status. Tab dan
 * saringan toko berpindah dengan `replace`, supaya "Kembali" tidak berjalan
 * mundur melewati setiap tab yang dibuka.
 */
export function PermintaanMasukClient({
  status,
  hitung,
  toko,
  tokoDitolak,
  daftar,
}: {
  status: StatusPermintaan;
  hitung: Record<StatusPermintaan, number>;
  toko: { id: string; nama: string } | null;
  tokoDitolak: boolean;
  daftar: PermintaanMasukTampil[];
}) {
  const t = useTranslations("pwaPermintaanSpg");
  const td = dinamis(t);
  const router = useRouter();

  const alamat = (s: StatusPermintaan, tokoId: string | null) => {
    const q = new URLSearchParams({ status: s });
    if (tokoId) q.set("toko", tokoId);
    return `/pwa/permintaan?${q.toString()}`;
  };

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan="/pwa/lainnya" />
      </Button>

      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {toko ? (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
          <span className="min-w-0 flex-1 truncate">{t("storeFilter", { store: toko.nama })}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("clearStore")}
            onClick={() => router.replace(alamat(status, null), { scroll: false })}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      ) : null}
      {tokoDitolak ? <p className="beranda-kartu text-sm text-muted-foreground">{t("storeNotYours")}</p> : null}

      <div className="grid grid-cols-4 gap-2" role="tablist" aria-label={t("title")}>
        {STATUS_PERMINTAAN.map((s) => (
          <Button
            key={s}
            type="button"
            role="tab"
            aria-selected={status === s}
            variant={status === s ? "default" : "outline"}
            className="h-auto flex-col gap-0 whitespace-normal px-1 py-2"
            onClick={() => router.replace(alamat(s, toko?.id ?? null), { scroll: false })}
          >
            <span className="text-xs font-medium leading-tight">{td(`status.${s}`)}</span>
            <span className="text-xs tabular-nums opacity-80">{hitung[s]}</span>
          </Button>
        ))}
      </div>

      {daftar.length === 0 ? (
        <section className="beranda-kartu flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Inbox className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold leading-tight">{td(`empty.${status}.title`)}</h2>
            <p className="text-sm text-muted-foreground">{td(`empty.${status}.body`)}</p>
          </div>
        </section>
      ) : (
        <section className="beranda-kartu beranda-kartu-daftar">
          <ul className="divide-y">
            {daftar.map((p) => (
              <li key={p.id}>
                <Link href={`/pwa/permintaan/${p.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Inbox className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block font-medium leading-tight">{p.toko.nama}</span>
                    <span className="block text-xs text-muted-foreground">{t("meta", { name: p.peminta, when: p.dibuatLabel })}</span>
                    <span className="block text-xs text-muted-foreground">{t("size", { count: p.jumlahBaris, pcs: p.totalQty })}</span>
                    {p.contoh.length > 0 ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.contoh.join(", ")}
                        {p.jumlahBaris > p.contoh.length ? ` ${t("andMore", { count: p.jumlahBaris - p.contoh.length })}` : ""}
                      </span>
                    ) : null}
                    <span className="flex flex-wrap gap-1.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", nadaStatusPermintaan(p.status))}>
                        {td(`status.${p.status}`)}
                      </span>
                      {p.pesanan ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{t("orderBadge", { orderNo: p.pesanan.orderNo })}</span>
                      ) : null}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="px-1 text-xs text-muted-foreground">{t("footnote")}</p>
    </div>
  );
}

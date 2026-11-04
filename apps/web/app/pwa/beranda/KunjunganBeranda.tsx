"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CloudOff, MapPin, ShoppingBag, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { kunjunganLokalSah } from "@/lib/pwa/offline/luring-kunjungan";
import { useKunjunganLokal } from "@/lib/pwa/offline/luring-kunjungan-hook";
import { CheckOutButton } from "../stores/[id]/CheckOutButton";
import { KunjunganLuring } from "../stores/[id]/KunjunganLuring";

/** Jam diformat di klien dengan sengaja: datanya dari HP (IndexedDB), tidak pernah dirender server. */
const JAM_WIB = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

/**
 * Kartu "kunjungan berjalan" di beranda salesman, termasuk check-in yang dicatat
 * TANPA sinyal. Beranda dari cache (atau sebelum check-in itu sampai) tidak tahu
 * kunjungan itu dari server — tanpa kartu ini salesman tidak menemukan jalan ke
 * katalog dan check-out kunjungannya sendiri.
 *
 * - Kunjungan di HP yang lebih baru dari kunjungan server: kartu HP-lah yang
 *   tampil (check-in itu akan menutup kunjungan lama saat terkirim).
 * - Check-in di HP yang DITOLAK server: alasannya, dengan Coba lagi / Hapus.
 * - Selain itu: `kartuServer` (kartu kunjungan dari server, bila ada).
 */
export function KunjunganBeranda({ checkinServerMs, kartuServer }: { checkinServerMs: number | null; kartuServer: ReactNode }) {
  const t = useTranslations("pwaLuring.checkIn");
  const tKunjungan = useTranslations("pwa.kunjunganBerjalan");
  const tBeranda = useTranslations("pwa.beranda");
  const { siap, kunjungan } = useKunjunganLokal(null, { segarkanSaatTerkirim: true });

  const lebihBaru = kunjungan !== null && (checkinServerMs === null || kunjungan.waktu >= checkinServerMs);
  if (!siap || !kunjungan || !lebihBaru) return <>{kartuServer}</>;

  if (kunjungan.keadaan === "ditolak") {
    return (
      <>
        {kartuServer}
        <section className="beranda-kartu space-y-3">
          <KunjunganLuring kunjungan={kunjungan} storeId={kunjungan.storeId} />
        </section>
      </>
    );
  }
  if (!kunjunganLokalSah(kunjungan)) return <>{kartuServer}</>;

  const nama = kunjungan.storeName ?? t("tokoIni");
  return (
    <section className="beranda-kartu space-y-3" style={{ borderColor: "var(--primary)", borderWidth: 2 }}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="beranda-judul">{tBeranda("activeVisit")}</h2>
        <span className="text-sm text-muted-foreground">{t("sejak", { jam: JAM_WIB.format(kunjungan.waktu) })}</span>
      </div>
      <Link href={`/pwa/stores/${kunjungan.storeId}`} className="flex items-start gap-2">
        <MapPin className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <span className="block text-lg font-semibold leading-tight">{nama}</span>
      </Link>
      <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
        <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{kunjungan.keadaan === "antre" ? t("antreIsi") : t("terkirimIsi")}</span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button asChild className="h-auto min-h-11 whitespace-normal py-2">
          <Link href={`/pwa/stores/${kunjungan.storeId}/catalog`}>
            <ShoppingBag className="h-4 w-4" />
            {tKunjungan("buatPesanan")}
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal py-2">
          <Link href={`/pwa/stores/${kunjungan.storeId}`}>
            <Store className="h-4 w-4" />
            {tKunjungan("halamanToko")}
          </Link>
        </Button>
      </div>
      <CheckOutButton
        visitId={kunjungan.keadaan === "terkirim" ? kunjungan.visitId : null}
        visitClientId={kunjungan.keadaan === "antre" ? kunjungan.clientId : null}
        storeId={kunjungan.storeId}
        storeName={kunjungan.storeName}
        sejakMs={kunjungan.waktu}
      />
    </section>
  );
}

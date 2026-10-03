"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowLeftRight,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ChevronRight,
  ClipboardList,
  CloudUpload,
  Coins,
  Megaphone,
  Palette,
  Receipt,
  Route,
  Scale,
  Store,
  Target,
  Trophy,
  Truck,
  Undo2,
  BarChart3,
  Inbox,
  Lightbulb,
} from "lucide-react";
import { hitungBelumTerkirim } from "@/lib/pwa/offline/hitung";
import { TombolKeluar } from "../TombolKeluar";

/**
 * Tab "Lainnya": layar yang jarang dibuka tapi harus bisa dicapai tanpa
 * mengetik alamat — retur, jual van, usulan toko baru, beban, kiriman tertahan,
 * tampilan, keluar.
 */
/*
 * Dikelompokkan menurut pekerjaan, bukan satu daftar panjang: lima belas baris
 * datar berhenti dibaca, orang menghafal posisi lalu tersesat begitu ada yang
 * bergeser. Urutan grup = urutan hari kerja: hari ini, jualan, uang, aplikasi.
 */
const GRUP = [
  {
    kunci: "hariIni",
    baris: [
      { href: "/pwa/pengumuman", ikon: Megaphone, kunci: "pengumuman" },
      { href: "/pwa/hari-ini", ikon: CalendarDays, kunci: "hariIni" },
      { href: "/pwa/jadwal", ikon: CalendarRange, kunci: "jadwal" },
      { href: "/pwa/rute", ikon: Route, kunci: "rute" },
      { href: "/pwa/absen", ikon: CalendarCheck, kunci: "absen" },
    ],
  },
  {
    kunci: "jualan",
    baris: [
      { href: "/pwa/orders", ikon: ClipboardList, kunci: "pesananSaya" },
      { href: "/pwa/retur", ikon: Undo2, kunci: "retur" },
      { href: "/pwa/tukar", ikon: ArrowLeftRight, kunci: "tukar" },
      { href: "/pwa/van", ikon: Truck, kunci: "van" },
      { href: "/pwa/stores/usulan", ikon: Store, kunci: "usulanToko" },
    ],
  },
  {
    kunci: "uang",
    baris: [
      { href: "/pwa/penjualan", ikon: BarChart3, kunci: "riwayatPenjualan" },
      { href: "/pwa/permintaan", ikon: Inbox, kunci: "permintaanSpg" },
      { href: "/pwa/rekomendasi", ikon: Lightbulb, kunci: "rekomendasiSaya" },
      { href: "/pwa/insentif", ikon: Coins, kunci: "insentif" },
      { href: "/pwa/target", ikon: Target, kunci: "target" },
      { href: "/pwa/peringkat", ikon: Trophy, kunci: "peringkat" },
      { href: "/pwa/biaya", ikon: Receipt, kunci: "biaya" },
      { href: "/pwa/beban", ikon: Scale, kunci: "beban" },
    ],
  },
  {
    kunci: "aplikasi",
    baris: [
      { href: "/pwa/orders/pending", ikon: CloudUpload, kunci: "unsynced" },
      { href: "/pwa/tampilan", ikon: Palette, kunci: "appearance" },
    ],
  },
] as const;

export function LainnyaClient({ nama, onLogout }: { nama: string; onLogout: () => Promise<void> }) {
  const t = useTranslations("pwa.lainnya");
  const [tertahan, setTertahan] = useState(0);

  useEffect(() => {
    hitungBelumTerkirim().then(setTertahan, () => undefined);
  }, []);

  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("signedInAs", { name: nama })}</p>
      </header>

      <nav className="space-y-4" aria-label={t("title")}>
        {GRUP.map((g) => (
          <section key={g.kunci} className="space-y-1.5" aria-labelledby={`lainnya-${g.kunci}`}>
            <h2 id={`lainnya-${g.kunci}`} className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`grup.${g.kunci}`)}
            </h2>
            <ul className="beranda-kartu beranda-kartu-daftar divide-y">
              {g.baris.map(({ href, ikon: Ikon, kunci }) => (
                <li key={href}>
                  <Link href={href} className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/60">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Ikon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-tight">{t(`${kunci}.label`)}</span>
                      <span className="block text-xs text-muted-foreground">{t(`${kunci}.hint`)}</span>
                    </span>
                    {kunci === "unsynced" && tertahan > 0 ? (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-800 dark:text-amber-300">
                        {tertahan}
                      </span>
                    ) : null}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>

      <div className="beranda-kartu beranda-kartu-daftar">
        <TombolKeluar onLogout={onLogout} tampilan="baris" />
      </div>
    </div>
  );
}

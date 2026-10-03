"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowLeftRight,
  CalendarCheck,
  ChevronRight,
  ClipboardList,
  Megaphone,
  PackageCheck,
  Palette,
  SearchX,
  Store as StoreIcon,
  Target,
  Trophy,
  Truck,
  Undo2,
  Wallet,
  BarChart3,
  Lightbulb,
  Users,
  BellRing,
  MoonStar,
  CalendarClock,
  Shirt,
  CloudOff,
  Footprints,
  Scale,
} from "lucide-react";
import { TombolKeluar } from "../../TombolKeluar";

/**
 * Tab "Lainnya" SPG: pekerjaan yang tidak setiap jam, DIKELOMPOKKAN — 25 baris
 * tanpa judul sulit dicari (2026-10-03). Urutan kelompok mengikuti hari kerja:
 * konter (pembeli & promo), stok toko, hari kerja, lalu saya.
 */
type BarisLainnya = { href: string; ikon: typeof Megaphone; kunci: string };

function kelompokLainnya(tokoId: string): { kunci: string; baris: BarisLainnya[] }[] {
  return [
    {
      kunci: "grupKonter",
      baris: [
        { href: "/pwa/spg/pelanggan", ikon: Users, kunci: "pelanggan" },
        { href: "/pwa/spg/titip", ikon: BellRing, kunci: "titip" },
        { href: "/pwa/spg/produk", ikon: Shirt, kunci: "produk" },
        { href: "/pwa/spg/pengunjung", ikon: Footprints, kunci: "pengunjung" },
        { href: "/pwa/spg/dicari", ikon: SearchX, kunci: "lost" },
        { href: "/pwa/spg/antrean", ikon: CloudOff, kunci: "antrean" },
      ],
    },
    {
      kunci: "grupStok",
      baris: [
        { href: "/pwa/spg/terima", ikon: PackageCheck, kunci: "receive" },
        { href: "/pwa/spg/opname", ikon: ClipboardList, kunci: "count" },
        { href: "/pwa/spg/stok/minta", ikon: Truck, kunci: "request" },
        { href: "/pwa/spg/mutasi", ikon: ArrowLeftRight, kunci: "mutasi" },
        { href: "/pwa/retur", ikon: Undo2, kunci: "retur" },
        { href: "/pwa/spg/analisa", ikon: BarChart3, kunci: "analisa" },
        { href: "/pwa/spg/rekomendasi", ikon: Lightbulb, kunci: "rekomendasi" },
      ],
    },
    {
      kunci: "grupHariKerja",
      baris: [
        { href: "/pwa/spg/tutup", ikon: MoonStar, kunci: "tutupHari" },
        { href: "/pwa/spg/jadwal", ikon: CalendarClock, kunci: "jadwal" },
        { href: "/pwa/absen", ikon: CalendarCheck, kunci: "absen" },
        { href: "/pwa/pengumuman", ikon: Megaphone, kunci: "pengumuman" },
        { href: `/pwa/stores/${tokoId}`, ikon: StoreIcon, kunci: "tokoSaya" },
      ],
    },
    {
      kunci: "grupSaya",
      baris: [
        { href: "/pwa/target", ikon: Target, kunci: "target" },
        { href: "/pwa/peringkat", ikon: Trophy, kunci: "peringkat" },
        { href: "/pwa/spg/gaji", ikon: Wallet, kunci: "pay" },
        { href: "/pwa/beban", ikon: Scale, kunci: "beban" },
        { href: "/pwa/tampilan", ikon: Palette, kunci: "appearance" },
      ],
    },
  ];
}

export function LainnyaSpgClient({
  nama,
  toko,
  tokoId,
  onLogout,
}: {
  nama: string;
  toko: string;
  tokoId: string;
  onLogout: () => Promise<void>;
}) {
  const t = useTranslations("pwa.spgLainnya");
  const KELOMPOK = kelompokLainnya(tokoId);
  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("signedInAs", { name: nama, store: toko })}</p>
      </header>

      {KELOMPOK.map((k) => (
        <section key={k.kunci} className="space-y-2" aria-labelledby={`lainnya-${k.kunci}`}>
          <h2 id={`lainnya-${k.kunci}`} className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(k.kunci)}
          </h2>
          <nav className="beranda-kartu beranda-kartu-daftar" aria-labelledby={`lainnya-${k.kunci}`}>
            <ul className="divide-y">
              {k.baris.map(({ href, ikon: Ikon, kunci }) => (
                <li key={kunci}>
                  <Link href={href} className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/60">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Ikon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-tight">{t(`${kunci}.label`)}</span>
                      <span className="block text-xs text-muted-foreground">{t(`${kunci}.hint`)}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </section>
      ))}

      <div className="beranda-kartu beranda-kartu-daftar">
        <TombolKeluar onLogout={onLogout} tampilan="baris" />
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowLeftRight,
  CalendarCheck,
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
  BookOpen,
} from "lucide-react";
import { hitungBelumTerkirim } from "@/lib/pwa/offline/hitung";
import { TombolKeluar } from "../../TombolKeluar";
import { TombolBantuanHp } from "../../TombolBantuanHp";
import { KisiMenuLainnya } from "../../KisiMenuLainnya";

/**
 * Tab "Lainnya" SPG: pekerjaan yang tidak setiap jam, DIKELOMPOKKAN — 25 baris
 * tanpa judul sulit dicari (2026-10-03). Urutan kelompok mengikuti hari kerja:
 * konter (pembeli & promo), stok toko, hari kerja, lalu saya.
 *
 * Bentuknya (kisi ikon) di `KisiMenuLainnya`, sama dengan Lainnya salesman.
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
        { href: "/pwa/bantuan", ikon: BookOpen, kunci: "bantuan" },
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
  const [tertahan, setTertahan] = useState(0);

  // Angka di ikon "Belum terkirim": semua antrean HP — penjualan, terima, opname, retur.
  useEffect(() => {
    hitungBelumTerkirim().then(setTertahan, () => undefined);
  }, []);

  return (
    <div className="space-y-4 p-4">
      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
        <p className="text-sm text-muted-foreground">{t("signedInAs", { name: nama, store: toko })}</p>
      </header>

      <KisiMenuLainnya
        kelompok={KELOMPOK.map((k) => ({
          kunci: k.kunci,
          judul: t(k.kunci),
          item: k.baris.map(({ href, ikon, kunci }) => ({
            href,
            ikon,
            label: t(`${kunci}.label`),
            hint: t(`${kunci}.hint`),
            lencana: kunci === "antrean" ? tertahan : undefined,
          })),
        }))}
      />

      <div className="beranda-kartu beranda-kartu-daftar">
        <TombolKeluar onLogout={onLogout} tampilan="baris" />
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowLeftRight,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
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
  BookOpen,
  Inbox,
  Lightbulb,
} from "lucide-react";
import { hitungBelumTerkirim } from "@/lib/pwa/offline/hitung";
import { TombolKeluar } from "../TombolKeluar";
import { TombolBantuanHp } from "../TombolBantuanHp";
import { KisiMenuLainnya } from "../KisiMenuLainnya";

/**
 * Tab "Lainnya": layar yang jarang dibuka tapi harus bisa dicapai tanpa
 * mengetik alamat — retur, jual van, usulan toko baru, beban, kiriman tertahan,
 * tampilan, keluar.
 */
/*
 * Dikelompokkan menurut pekerjaan, bukan satu daftar panjang: lima belas baris
 * datar berhenti dibaca, orang menghafal posisi lalu tersesat begitu ada yang
 * bergeser. Urutan grup = urutan hari kerja: hari ini, jualan, kinerja & uang,
 * aplikasi.
 *
 * Bentuknya (kisi ikon) di `KisiMenuLainnya`, sama dengan Lainnya SPG.
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
      { href: "/pwa/permintaan", ikon: Inbox, kunci: "permintaanSpg" },
      { href: "/pwa/rekomendasi", ikon: Lightbulb, kunci: "rekomendasiSaya" },
    ],
  },
  {
    kunci: "uang",
    baris: [
      { href: "/pwa/penjualan", ikon: BarChart3, kunci: "riwayatPenjualan" },
      { href: "/pwa/target", ikon: Target, kunci: "target" },
      { href: "/pwa/insentif", ikon: Coins, kunci: "insentif" },
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
      { href: "/pwa/bantuan", ikon: BookOpen, kunci: "bantuan" },
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
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
        <p className="text-sm text-muted-foreground">{t("signedInAs", { name: nama })}</p>
      </header>

      <KisiMenuLainnya
        kelompok={GRUP.map((g) => ({
          kunci: g.kunci,
          judul: t(`grup.${g.kunci}`),
          item: g.baris.map(({ href, ikon, kunci }) => ({
            href,
            ikon,
            label: t(`${kunci}.label`),
            hint: t(`${kunci}.hint`),
            lencana: kunci === "unsynced" ? tertahan : undefined,
          })),
        }))}
      />

      <div className="beranda-kartu beranda-kartu-daftar">
        <TombolKeluar onLogout={onLogout} tampilan="baris" />
      </div>
    </div>
  );
}

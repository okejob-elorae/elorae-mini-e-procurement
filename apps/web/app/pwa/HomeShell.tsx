"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CalendarRange, ClipboardCheck, Clock, CloudUpload, MapPin, ShoppingBag, Store, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { greetingKey } from "@/lib/auth/login-message";
import { hitungBelumTerkirim } from "@/lib/pwa/offline/hitung";
import { setupOrderSync } from "@/lib/pwa/offline/sync";
import type { Kemajuan, TitikSalesman } from "@/lib/salesman/dasbor";
import type { PesananSaya as DataPesanan, TokoTagih } from "@/lib/salesman/queries";
import { hitungTugasRencana, type TokoMenurun } from "@/lib/salesman/toko-menurun";
import { susunRencanaPerKelas } from "@/lib/stores/kelas-toko";
import { TombolKabar } from "@/app/pwa/kabar/TombolKabar";
import { KartuInsentifBeranda, type DataInsentifBeranda } from "@/app/pwa/insentif/KartuInsentifBeranda";
import { KartuBulanIni } from "./beranda/KartuBulanIni";
import { PerluDitagih } from "./beranda/PerluDitagih";
import { PesananSaya } from "./beranda/PesananSaya";
import { RencanaKunjungan, type JadwalBerandaJson, type TokoRencanaJson } from "./beranda/RencanaKunjungan";
import { KartuPengumuman } from "./beranda/KartuPengumuman";
import type { DataKartuPengumuman } from "@/lib/pengumuman/queries";
import { TugasHariIni, type Tugas } from "./beranda/TugasHariIni";
import { KartuAbsen } from "./beranda/KartuAbsen";
import type { DataKartuAbsen } from "@/lib/salesman/absensi";
import { CheckOutButton } from "./stores/[id]/CheckOutButton";
import { KunjunganBeranda } from "./beranda/KunjunganBeranda";

/**
 * Beranda salesman: rencana kerja hari ini, bukan sekadar pintu ke daftar toko.
 *
 * Menjawab tiga pertanyaan setiap pagi — ke mana saya hari ini (rencana
 * kunjungan), uang siapa yang harus saya tagih (perlu ditagih), dan sejauh apa
 * saya dari target (bulan ini). Kartu, judul, dan angkanya memakai komponen
 * beranda backoffice yang sama, supaya dua aplikasi ini terasa satu produk.
 * Semua angka milik salesman yang sedang login saja.
 */

type PermState = "prompt" | "granted" | "denied" | "unknown";

export type DataBerandaSalesman = {
  bulanIni: { putus: number; konsi: number; van: number; total: number };
  kemajuan: Kemajuan | null;
  tren: TitikSalesman[];
  pesanan: DataPesanan;
  rencana: TokoRencanaJson[];
  tagih: TokoTagih[];
  /** Toko saya yang mulai jarang pesan, paling terlambat dulu. */
  menurun: TokoMenurun[];
  batas: { hari: number; diatur: boolean };
  /** Perkiraan komisi bulan ini; null = komisi dimatikan kantor (kartunya tidak tampil). */
  insentif: DataInsentifBeranda | null;
  /** Kartu absen hari ini; null = absensi dimatikan kantor dan hari ini belum tercatat. */
  absen: DataKartuAbsen | null;
  /** Tugas tagih dari kantor yang masih perlu ditagih; `terlambat` = lewat tenggat. */
  tugasTagih: { perluDitagih: number; terlambat: number };
  /** Kantor mengatur target per kategori/barang bulan ini. */
  adaTargetRinci: boolean;
  /** Toko yang dijadwalkan kantor untuk hari ini — paling atas di "Rencana kunjungan". */
  jadwal: JadwalBerandaJson[];
  /** Pengumuman kantor yang perlu dilihat; null = tidak ada. */
  pengumuman: DataKartuPengumuman | null;
  /** storeId → catatan toko tersemat (dipendekkan), untuk baris rencana kunjungan. */
  catatanTersemat: Record<string, string>;
};

type Props = {
  userName: string;
  dimuatPada: string;
  activeVisit: {
    id: string;
    storeId: string;
    storeName: string;
    storeTermsType: "PUTUS" | "KONSI";
    checkinAt: string;
  } | null;
  data: DataBerandaSalesman;
};

export function HomeShell({ userName, dimuatPada, activeVisit, data }: Props) {
  const t = useTranslations("pwa.nearest");
  const tBeranda = useTranslations("pwa.beranda");
  const tAuth = useTranslations("auth");
  const tKunjungan = useTranslations("pwa.kunjunganBerjalan");
  const locale = useLocale();
  const [perm, setPerm] = useState<PermState>("unknown");
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Semua antrean — pesanan, foto kunjungan, pelunasan, retur — bukan pesanan saja.
    const refresh = () => {
      hitungBelumTerkirim().then(
        n => {
          if (!cancelled) setPendingCount(n);
        },
        () => undefined,
      );
    };
    refresh();
    const cleanup = setupOrderSync(refresh);
    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions) {
      setPerm("prompt");
      return;
    }
    navigator.permissions.query({ name: "geolocation" as PermissionName }).then(
      status => {
        setPerm(status.state as PermState);
        status.onchange = () => setPerm(status.state as PermState);
      },
      () => setPerm("prompt"),
    );
  }, []);

  useEffect(() => {
    if (perm !== "granted") { setOrigin(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setOrigin(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, [perm]);

  function requestPermission() {
    navigator.geolocation.getCurrentPosition(
      () => setPerm("granted"),
      () => setPerm("denied"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  // Setiap toko dihitung sekali, di baris paling mendesaknya: yang bertagihan
  // sudah di baris "lewat janji bayar", yang menurun di barisnya sendiri, sisanya
  // "perlu dikunjungi". Susunannya sama dengan kartu rencana kunjungan.
  // Toko yang dijadwalkan kantor dihitung di baris "jadwal", bukan lagi di "rencana" — tidak dobel.
  const terjadwal = useMemo(() => new Set(data.jadwal.map((j) => j.storeId)), [data.jadwal]);
  const jumlahRencana = useMemo(
    () =>
      hitungTugasRencana(
        susunRencanaPerKelas(
          data.rencana.map(x => ({ ...x, kunjunganTerakhir: x.kunjunganTerakhir ? new Date(x.kunjunganTerakhir) : null })),
          data.menurun,
          { batasHari: data.batas.hari, hariIni: new Date(dimuatPada) },
        ).filter((b) => !terjadwal.has(b.storeId)),
      ),
    [data.rencana, data.menurun, data.batas.hari, dimuatPada, terjadwal],
  );

  const tTugas = useTranslations("pwa.tugas");
  const tTugasTagih = useTranslations("pwa.tugasTagih");
  const tugas: Tugas[] = [
    {
      kunci: "tugasTagih",
      jumlah: data.tugasTagih.perluDitagih,
      href: "/pwa/piutang",
      label: tTugasTagih("berandaBaris"),
      ikon: ClipboardCheck,
      mendesak: data.tugasTagih.terlambat > 0,
    },
    // Toko lewat janji bayar TIDAK jadi baris di sini: kartu "Perlu ditagih" di
    // bawah rencana kunjungan menampilkan toko yang sama, lengkap dengan tombol
    // telepon. Dulu toko yang sama tampil tiga kali di beranda.
    {
      kunci: "jadwal",
      jumlah: data.jadwal.filter((j) => !j.dikunjungi).length,
      href: "/pwa/jadwal",
      label: tTugas("jadwal"),
      ikon: CalendarRange,
    },
    { kunci: "menurun", jumlah: jumlahRencana.menurun, href: "#rencana", label: tTugas("menurun"), ikon: TrendingDown },
    { kunci: "rencana", jumlah: jumlahRencana.kunjungan, href: "#rencana", label: tTugas("rencana"), ikon: MapPin },
    { kunci: "sinkron", jumlah: pendingCount, href: "/pwa/orders/pending", label: tTugas("belumSinkron"), ikon: CloudUpload },
  ];

  const tanggal = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Jakarta",
  }).format(new Date(dimuatPada));

  return (
    <div className="viz space-y-4 p-4 pb-6">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight" suppressHydrationWarning>
            {tAuth(`greeting.${greetingKey()}`)}, {userName}
          </h1>
          <p className="text-sm text-muted-foreground">{tanggal}</p>
        </div>
        {/* Hanya lonceng. Tema dan Keluar ada di Lainnya: keduanya jarang dipakai,
            dan tombol keluar di sebelah lonceng mudah tersentuh tanpa sengaja. */}
        <div className="-mr-2 flex shrink-0 items-center">
          <TombolKabar />
        </div>
      </header>

      {/* Kunjungan berjalan PALING ATAS — dari server, atau check-in yang dicatat
          tanpa sinyal di HP. Selama berdiri di toko yang dicari adalah tombol
          pesan dan check-out, bukan omzet bulan ini. Tanpa kunjungan kartu ini
          kosong dan omzet tetap yang pertama terlihat. */}
      <KunjunganBeranda
        checkinServerMs={activeVisit ? Date.parse(activeVisit.checkinAt) : null}
        kartuServer={activeVisit ? (
          <section className="beranda-kartu" style={{ borderColor: "var(--primary)", borderWidth: 2 }}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="beranda-judul">{tBeranda("activeVisit")}</h2>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" aria-hidden />
                {new Date(activeVisit.checkinAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })}
              </span>
            </div>
            <Link href={`/pwa/stores/${activeVisit.storeId}`} className="mt-2 flex items-start gap-2">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <span>
                <span className="block text-lg font-semibold leading-tight">{activeVisit.storeName}</span>
                <span className="block text-xs text-muted-foreground">{t("activeStoreLabel")}</span>
              </span>
            </Link>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button asChild>
                <Link href={`/pwa/stores/${activeVisit.storeId}/catalog`}>
                  <ShoppingBag className="h-4 w-4" />
                  {tKunjungan("buatPesanan")}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/pwa/stores/${activeVisit.storeId}`}>
                  <Store className="h-4 w-4" />
                  {tKunjungan("halamanToko")}
                </Link>
              </Button>
            </div>
            <div className="mt-2">
              <CheckOutButton visitId={activeVisit.id} />
            </div>
          </section>
        ) : null}
      />

      {/* Omzet bulan ini: angka yang dicari sales setiap membuka aplikasi. */}
      <KartuBulanIni bulanIni={data.bulanIni} kemajuan={data.kemajuan} tren={data.tren} adaTargetRinci={data.adaTargetRinci} />
      {data.absen ? <KartuAbsen data={data.absen} /> : null}

      {/* Urutan kerja lapangan: pesan kantor, yang harus dikerjakan, dan ke mana
          pergi lebih dulu; angka bulanan sesudahnya. */}
      <KartuPengumuman data={data.pengumuman} />
      <TugasHariIni judul={(n) => tTugas("title", { count: n })} tugas={tugas} />
      <RencanaKunjungan
        toko={data.rencana}
        menurun={data.menurun}
        batas={data.batas}
        hariIni={dimuatPada}
        posisi={origin}
        izinLokasi={perm}
        mintaLokasi={requestPermission}
        jadwal={data.jadwal}
        catatanTersemat={data.catatanTersemat}
      />
      <PerluDitagih toko={data.tagih} namaSales={userName} />
      {data.insentif ? <KartuInsentifBeranda data={data.insentif} /> : null}
      <PesananSaya data={data.pesanan} />
    </div>
  );
}

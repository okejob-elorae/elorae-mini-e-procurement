"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  BellRing,
  Boxes,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Clock,
  CloudOff,
  ExternalLink,
  MapPin,
  MoonStar,
  PackageCheck,
  ScanLine,
  Store as StoreIcon,
  Wallet,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { hitungBelumTerkirim, PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { pwaDb } from "@/lib/pwa/offline/db";
import {
  hariWib,
  kirimanBelumDipegang,
  kirimanLepasDariHp,
  kunciKiriman,
  labelMasuk,
  labelMasukUntuk,
  tataKunjunganBeranda,
  type LabelMasuk,
} from "@/lib/spg/beranda-spg";
import { PenghitungPengunjungMini } from "@/components/spg/PenghitungPengunjungMini";
import type { AwalPengunjung } from "@/components/spg/usePenghitungPengunjung";
import { AngkaNaik } from "@/components/gerak/AngkaNaik";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatIDR } from "@/lib/sales-orders/format";
import { CheckInButton } from "./stores/[id]/CheckInButton";
import { kunjunganLokalSah } from "@/lib/pwa/offline/luring-kunjungan";
import { useKunjunganLokal } from "@/lib/pwa/offline/luring-kunjungan-hook";
import { CheckOutButton } from "./stores/[id]/CheckOutButton";
import { TugasHariIni, type Tugas } from "./beranda/TugasHariIni";
import { KartuPengumuman } from "./beranda/KartuPengumuman";
import type { DataKartuPengumuman } from "@/lib/pengumuman/queries";
import { TombolKeluar } from "./TombolKeluar";
import { TombolKabar } from "./kabar/TombolKabar";
import { TombolBantuanHp } from "./TombolBantuanHp";

/**
 * Beranda SPG — satu toko tetap, disusun menurut hari kerjanya: angka bulan
 * ini, absen, tombol JUAL tepat di bawahnya, apa yang harus dikerjakan (kiriman
 * datang, pesanan untuk toko, stok menipis), angka-angka pribadinya (terlaris,
 * nota hari ini, gaji & komisi), lalu check-out PALING BAWAH — jauh dari tombol
 * Jual, supaya salah ketuk tidak pernah menutup kunjungan. Semua jam dan tanggal
 * dari server sudah diformat di server.
 */

export type DataBerandaSpg = {
  /** Pengumuman kantor yang perlu dilihat; null = tidak ada. */
  pengumuman: DataKartuPengumuman | null;
  toko: { id: string; name: string; code: string; address: string | null; mapsUrl: string | null };
  /**
   * `lama`: check-in dari hari sebelumnya yang belum di-check-out (menurut
   * server saat halaman dibuat). `masuk`: jam check-in dalam dua bentuk — HP
   * menilai ulang "hari lain" menurut harinya sendiri, karena halaman dari
   * cache bisa dibuka keesokan harinya.
   */
  kunjungan: { id: string; jamMasuk: string; lama?: boolean; masuk?: LabelMasuk; diLuarRadius: boolean; jarak: number | null } | null;
  /** Hari WIB saat halaman dibuat di server. */
  hariKunci?: string;
  tokoLainTerbuka: string | null;
  hariIniLabel: string;
  hariIni: { nota: number; total: number; barang: number };
  bulanIni: { total: number; target: number | null; persen: number | null };
  hariMasuk: number;
  terlaris: { kunci: string; nama: string; qty: number }[];
  hampirHabis: number;
  stokDilacak: boolean;
  kirimanMenunggu: number;
  /** `jenis:id` kiriman yang menunggu; yang tanda terimanya sudah di HP dikurangkan dari `kirimanMenunggu`. */
  kirimanMenungguKunci?: string[];
  /** Pesanan untuk toko ini yang masih diproses kantor (belum berangkat). */
  pesananDiproses: number;
  notaHariIni: { id: string; docNo: string; jam: string; total: number; jumlahBarang: number }[];
  gaji: {
    perkiraan: { totalToko: number; bagianSaya: number } | null;
    terakhir: { periode: string; total: number; dibayar: boolean } | null;
  };
  /** Shift hari ini dari jadwal kantor; null = belum dijadwalkan. */
  shift: { jenis: "KERJA"; label: string; mulai: string; selesai: string } | { jenis: "LIBUR" } | null;
  /** Titip pesan yang barangnya sudah ada di toko — tinggal dikabari. */
  titipDatang: number;
  /** Ajuan tukar shift dari rekan yang menunggu jawaban saya. */
  tukarMasuk: number;
  /** Sudah berjualan, sudah sore, dan laporan tutup hari belum dikirim. */
  tutupPerlu: boolean;
  pengunjung: AwalPengunjung | null;
  userId: string;
};

/**
 * Hari WIB menurut HP. Render pertama memakai hari server (hidrasi sama
 * persis), sesudahnya hari HP — halaman dari cache yang dibuka keesokan
 * harinya tidak menyebut check-in kemarin sebagai "pukul 19.16" saja.
 */
function useHariIniWib(hariServer: string | undefined): string | undefined {
  const [hari, setHari] = useState(hariServer);
  useEffect(() => {
    const segarkan = () => setHari(hariWib(Date.now()));
    segarkan();
    document.addEventListener("visibilitychange", segarkan);
    return () => document.removeEventListener("visibilitychange", segarkan);
  }, []);
  return hari;
}

type TerimaDiHp = { storeId: string; sourceType: string; sourceId: string };

/**
 * Kiriman menunggu yang tanda terimanya BELUM tersimpan di HP ini. Tanpa
 * kunci dari server (halaman lama) angka server dipakai apa adanya.
 */
function useKirimanMenunggu(storeId: string, jumlahServer: number, kunci: string[] | undefined): number {
  const router = useRouter();
  const [diHp, setDiHp] = useState<TerimaDiHp[]>([]);
  const dipegang = useRef<Set<string> | null>(null);
  useEffect(() => {
    let hidup = true;
    const muat = () => {
      pwaDb.pendingStoreReceipts.toArray().then(
        (baris) => {
          if (!hidup) return;
          const kini = new Set(baris.filter((b) => !b.storeId || b.storeId === storeId).map((b) => kunciKiriman(b.sourceType, b.sourceId)));
          const sebelum = dipegang.current;
          dipegang.current = kini;
          setDiHp(baris.map((b) => ({ storeId: b.storeId, sourceType: b.sourceType, sourceId: b.sourceId })));
          // Tanda terima yang tadi di HP sudah terkirim: angka server di halaman ini
          // masih menghitung kirimannya — muat ulang, jangan biarkan angkanya naik lagi.
          if (kunci && kirimanLepasDariHp(sebelum, kini, kunci) && navigator.onLine) router.refresh();
        },
        () => undefined,
      );
    };
    muat();
    window.addEventListener(PERISTIWA_ANTREAN, muat);
    return () => {
      hidup = false;
      window.removeEventListener(PERISTIWA_ANTREAN, muat);
    };
  }, [storeId, kunci, router]);
  return kunci ? kirimanBelumDipegang(kunci, diHp, storeId) : jumlahServer;
}

/** Nota/laporan yang masih di antrean HP (tanpa sinyal) — dibaca di HP, bukan di server. */
function useBelumTerkirim(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let batal = false;
    const hitung = () => {
      hitungBelumTerkirim().then(
        (x) => {
          if (!batal) setN(x);
        },
        () => undefined,
      );
    };
    hitung();
    window.addEventListener(PERISTIWA_ANTREAN, hitung);
    return () => {
      batal = true;
      window.removeEventListener(PERISTIWA_ANTREAN, hitung);
    };
  }, []);
  return n;
}

export function SpgHomeShell({
  userName,
  data,
  kembali = null,
}: {
  userName: string;
  data: DataBerandaSpg;
  /** Layar asal yang meminta check-in; sesudah check-in SPG dikembalikan ke sana. */
  kembali?: string | null;
}) {
  const t = useTranslations("pwa.spgBeranda");
  const tMenu = useTranslations("pwaMenu");
  const { toko, kunjungan } = data;
  // Check-in yang dicatat tanpa sinyal (masih di HP) juga membuka layar jual:
  // nota di kunjungan itu ikut antrean dan terkirim sesudah check-in-nya.
  const { kunjungan: kunjunganLokal } = useKunjunganLokal(toko.id, { segarkanSaatTerkirim: true });
  const lokalSah = kunjunganLokalSah(kunjunganLokal) ? kunjunganLokal : null;
  const hariIni = useHariIniWib(data.hariKunci);
  // Jam masuk: jam saja untuk check-in hari ini (WIB), selain itu dengan tanggalnya.
  const masukServer = kunjungan
    ? kunjungan.masuk && hariIni
      ? labelMasukUntuk(kunjungan.masuk, hariIni)
      : { lama: kunjungan.lama === true, teks: kunjungan.jamMasuk }
    : null;
  const masukLokal = lokalSah ? labelMasukUntuk(labelMasuk(lokalSah.waktu), hariIni ?? hariWib(lokalSah.waktu)) : null;
  // Check-in dari hari lain (server, atau tanpa sinyal tanpa kunjungan server): kartu
  // absen menyuruh check-out lalu check-in lagi, jadi tombol Jual TIDAK ditawarkan dan
  // tombol kunjungannya tetap di kartu itu — sekali saja (`tataKunjunganBeranda`).
  const { bisaJual, tombolDiKartu, tombolDiBawah } = tataKunjunganBeranda({
    server: masukServer ? { lama: masukServer.lama } : null,
    lokal: masukLokal ? { lama: masukLokal.lama } : null,
  });
  // Satu tombol kunjungan: check-in selagi belum bisa menjual (di kartu absen),
  // check-out sesudahnya (paling bawah). Check-in tanpa sinyal yang sah dirender
  // `CheckInButton` sebagai kartu kunjungan di HP, lengkap dengan check-out-nya.
  const tombolKunjungan = kunjungan ? (
    <CheckOutButton visitId={kunjungan.id} />
  ) : (
    <CheckInButton storeId={toko.id} storeName={toko.name} autoCloseStoreName={data.tokoLainTerbuka} kembali={kembali} />
  );

  const belumTerkirim = useBelumTerkirim();
  const kirimanMenunggu = useKirimanMenunggu(toko.id, data.kirimanMenunggu, data.kirimanMenungguKunci);
  const tugas: Tugas[] = [
    { kunci: "antrean", jumlah: belumTerkirim, href: "/pwa/spg/antrean", label: t("taskQueue"), ikon: CloudOff, mendesak: true },
    { kunci: "titip", jumlah: data.titipDatang, href: "/pwa/spg/titip", label: t("taskHoldArrived"), ikon: BellRing },
    { kunci: "terima", jumlah: kirimanMenunggu, href: "/pwa/spg/terima", label: t("taskReceive"), ikon: PackageCheck },
    { kunci: "pesanan", jumlah: data.pesananDiproses, href: "/pwa/spg/terima#pesanan-toko", label: t("taskOrdersComing"), ikon: ClipboardList },
    { kunci: "tukar", jumlah: data.tukarMasuk, href: "/pwa/spg/jadwal", label: t("taskSwap"), ikon: CalendarClock },
    { kunci: "tutup", jumlah: data.tutupPerlu ? 1 : 0, href: "/pwa/spg/tutup", label: t("taskClose"), ikon: MoonStar },
    { kunci: "habis", jumlah: data.stokDilacak ? data.hampirHabis : 0, href: "/pwa/spg/stok?saring=habis", label: t("taskLowStock"), ikon: Boxes },
  ];

  const persen = data.bulanIni.persen;

  return (
    <div className="viz space-y-4 p-4 pb-6">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">
            {t("greeting")}, {userName}
          </h1>
          <p className="text-sm text-muted-foreground">{data.hariIniLabel}</p>
        </div>
        {/* Hanya ⓘ dan lonceng, sama dengan beranda salesman. Tema dan Keluar ada di
            Lainnya (menu bawah): empat ikon berdempet menjepit sapaan, dan tombol
            keluar di sebelah lonceng mudah tersentuh tanpa sengaja. */}
        <div className="-mr-2 flex shrink-0 items-center gap-1">
          <TombolBantuanHp judul={tMenu("beranda")} />
          <TombolKabar />
        </div>
      </header>

      {/* Bulan ini paling atas (permintaan pemilik, 2026-10-01): omzet pribadi vs target, dan hari ini. */}
      <section className="beranda-kartu beranda-kartu-utama">
        <h2 className="beranda-judul">{t("monthTitle")}</h2>
        <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
          <AngkaNaik nilai={data.bulanIni.total} format={formatIDR} />
        </p>
        {data.bulanIni.target && persen !== null ? (
          <>
            <p className="text-xs tabular-nums opacity-80">{t("targetOf", { target: formatIDR(data.bulanIni.target), pct: persen })}</p>
            <div
              className="mt-2 h-2.5 overflow-hidden rounded-full"
              style={{ background: "color-mix(in oklab, var(--primary-foreground) 15%, transparent)" }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, persen)}
              aria-label={t("monthTitle")}
            >
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, persen)}%`, background: "var(--primary-foreground)" }} />
            </div>
          </>
        ) : (
          <p className="text-xs opacity-80">{t("targetNotSet")}</p>
        )}
        <div className="mt-3 border-t pt-2.5 text-sm" style={{ borderColor: "color-mix(in oklab, var(--primary-foreground) 18%, transparent)" }}>
          <span className="opacity-80">{t("today")}</span>{" "}
          <span className="font-medium tabular-nums">
            {t("todaySummary", { notes: data.hariIni.nota, items: data.hariIni.barang, total: formatIDR(data.hariIni.total) })}
          </span>
        </div>
      </section>

      {/* Absen masuk (check-in GPS) di toko tetapnya. Pulang (check-out) ada paling bawah. */}
      <section className="beranda-kartu space-y-3" style={bisaJual ? { borderColor: "var(--primary)", borderWidth: 2 } : undefined}>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <StoreIcon className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold leading-tight">{toko.name}</p>
            {/* Alamat bisa kosong: tanpa penyaring, kodenya tertinggal dengan "·" menggantung. */}
            <p className="text-xs text-muted-foreground">{[toko.code, toko.address?.trim()].filter(Boolean).join(" · ")}</p>
            {toko.mapsUrl ? (
              <a
                href={toko.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium underline decoration-primary decoration-2 underline-offset-4"
              >
                <MapPin className="h-4 w-4" aria-hidden />
                {t("openMaps")}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : null}
          </div>
        </div>
        <p className="flex items-start gap-1.5 text-sm">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          {/* Satu aliran teks: kalimat check-in yang panjang tidak menjepit
              keterangan hari masuk menjadi kolom sempit di kanan. */}
          <span className="min-w-0">
            {masukServer
              ? t(masukServer.lama ? "checkedInEarlier" : "checkedInAt", { time: masukServer.teks })
              : masukLokal
                ? t(masukLokal.lama ? "checkedInEarlier" : "checkedInAt", { time: masukLokal.teks })
                : t("notCheckedIn")}{" "}
            <span className="text-muted-foreground">· {t("daysThisMonth", { count: data.hariMasuk })}</span>
          </span>
        </p>
        {data.shift ? (
          <p className="flex items-start gap-1.5 text-sm">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <Link href="/pwa/spg/jadwal" className="min-w-0 underline-offset-4 hover:underline">
              {data.shift.jenis === "LIBUR"
                ? t("shiftOff")
                : t("shiftToday", { label: data.shift.label, mulai: data.shift.mulai.replace(":", "."), selesai: data.shift.selesai.replace(":", ".") })}
            </Link>
          </p>
        ) : null}
        {kunjungan?.diLuarRadius ? (
          <Alert className="border-amber-500/50">
            <AlertDescription className="text-amber-800 dark:text-amber-300">
              {t("outOfRadius", { meters: kunjungan.jarak ?? "?" })}
            </AlertDescription>
          </Alert>
        ) : null}
        {!bisaJual && kembali ? <p className="text-sm text-muted-foreground">{t("checkInReturns")}</p> : null}
        {tombolDiKartu ? tombolKunjungan : null}
      </section>

      {/* Tombol utama hari kerja SPG, langsung di bawah absen. Tanpa check-in, alasannya disebut. */}
      {bisaJual ? (
        <Button asChild size="lg" className="h-14 w-full text-base">
          <Link href="/pwa/spg/sale">
            <ScanLine className="h-5 w-5" />
            {t("sell")}
          </Link>
        </Button>
      ) : (
        <p className="rounded-lg bg-muted/60 px-4 py-3 text-center text-sm text-muted-foreground">{t("sellNeedsCheckin")}</p>
      )}

      <KartuPengumuman data={data.pengumuman} />

      <TugasHariIni judul={(n) => t("tasksTitle", { count: n })} tugas={tugas} />

      {/* Penghitung pengunjung: satu ketukan per pengunjung, tetap jalan tanpa sinyal. */}
      <PenghitungPengunjungMini userId={data.userId} storeId={toko.id} awal={data.pengunjung} />

      {!data.stokDilacak ? (
        <section className="beranda-kartu space-y-2">
          <h2 className="beranda-judul">{t("startStockTitle")}</h2>
          <div className="grid grid-cols-2 gap-2">
            <Button asChild variant="outline">
              <Link href="/pwa/spg/terima">{t("startStockReceive")}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/pwa/spg/opname">{t("startStockCount")}</Link>
            </Button>
          </div>
        </section>
      ) : null}

      <section className="beranda-kartu">
        <h2 className="beranda-judul">{t("bestTitle")}</h2>
        {data.terlaris.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("bestEmpty")}</p>
        ) : (
          <ol className="mt-2 space-y-1.5">
            {data.terlaris.map((b, i) => (
              <li key={b.kunci} className="flex items-baseline gap-3 text-sm">
                <span className="w-4 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{b.nama}</span>
                <span className="shrink-0 font-semibold tabular-nums">{t("pcs", { count: b.qty })}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="beranda-kartu beranda-kartu-daftar">
        <div className="flex items-baseline justify-between px-4 pb-1 pt-3">
          <h2 className="beranda-judul">{t("notesTitle")}</h2>
          <Link href="/pwa/spg/nota" className="inline-flex min-h-11 items-center text-sm font-medium underline decoration-primary decoration-2 underline-offset-4">
            {t("notesAll")}
          </Link>
        </div>
        {data.notaHariIni.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">{t("notesEmpty")}</p>
        ) : (
          <ul className="divide-y">
            {data.notaHariIni.map((n) => (
              <li key={n.id}>
                <Link href={`/pwa/spg/${n.id}/nota`} className="flex min-h-12 items-center gap-3 px-4 py-2 transition-colors hover:bg-background/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{n.docNo}</span>
                    <span className="block text-xs text-muted-foreground">
                      {n.jam} · {t("pcs", { count: n.jumlahBarang })}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{formatIDR(n.total)}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/pwa/spg/gaji" className="beranda-kartu flex items-center gap-3 transition-colors hover:bg-background/60">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <Wallet className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="beranda-judul block">{t("payTitle")}</span>
          <span className="block text-sm">
            {data.gaji.perkiraan
              ? t("payEstimate", { amount: formatIDR(data.gaji.perkiraan.bagianSaya) })
              : data.gaji.terakhir
                ? t(data.gaji.terakhir.dibayar ? "payLastPaid" : "payLastUnpaid", {
                    period: data.gaji.terakhir.periode,
                    amount: formatIDR(data.gaji.terakhir.total),
                  })
                : t("payNone")}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>

      {/* Check-out PALING BAWAH, terpisah jauh dari tombol Jual (dulu tepat di atasnya).
          Kunjungan yang check-in-nya masih di HP membawa kartunya sendiri. */}
      {tombolDiBawah === "SERVER" ? (
        <section className="beranda-kartu space-y-3" aria-labelledby="judul-selesai-kerja">
          <h2 id="judul-selesai-kerja" className="beranda-judul">
            {t("checkoutTitle")}
          </h2>
          {tombolKunjungan}
        </section>
      ) : tombolDiBawah === "LOKAL" ? (
        tombolKunjungan
      ) : null}
    </div>
  );
}

/**
 * SPG yang tokonya belum diatur atau sudah dihapus: jalan buntu yang jelas,
 * bukan galat atau beranda salesman.
 */
export function SpgTanpaToko({ userName, onLogout }: { userName: string; onLogout: () => Promise<void> }) {
  const t = useTranslations("pwa.spgBeranda");
  return (
    <div className="space-y-4 p-4">
      <header className="flex items-start justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight">
          {t("greeting")}, {userName}
        </h1>
        <TombolKeluar onLogout={onLogout} />
      </header>
      <section className="beranda-kartu">
        <p className="text-sm">{t("noStore")}</p>
      </section>
    </div>
  );
}

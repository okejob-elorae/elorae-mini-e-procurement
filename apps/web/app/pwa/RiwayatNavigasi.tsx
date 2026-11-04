"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  bacaRiwayat,
  catatPerpindahan,
  jenisDariHitungan,
  popSudahTercatat,
  RIWAYAT_KOSONG,
  simpanRiwayat,
  type JenisPerpindahan,
} from "@/lib/pwa/riwayat";

/*
 * Jenis perpindahan sejak pencatatan terakhir. Next memanggil
 * `history.pushState` untuk navigasi baru dan `replaceState` untuk
 * `router.replace` — tetapi juga `replaceState` untuk menyimpan keadaannya
 * sendiri SESUDAH sebuah push. Karena itu yang dihitung adalah apakah ADA push
 * (atau pop) sejak pencatatan terakhir, bukan panggilan yang paling akhir.
 *
 * Keadaannya disimpan di `window`, bukan di variabel modul: modul ini bisa
 * dijalankan ulang di dokumen yang sama (Turbopack menjalankannya lagi saat
 * menyusun rute baru), dan variabel modul yang baru akan kehilangan hitungan
 * yang dicatat pengamat lama — perpindahan mundur lalu terbaca "ganti".
 */
type Pengamat = { dorong: number; pop: number; pertamaDiDokumen: boolean };

const KUNCI_PENGAMAT = "__eloraeRiwayatNavigasi";

function pengamat(): Pengamat {
  const w = window as unknown as Record<string, Pengamat | undefined>;
  const ada = w[KUNCI_PENGAMAT];
  if (ada) return ada;
  const baru: Pengamat = { dorong: 0, pop: 0, pertamaDiDokumen: true };
  w[KUNCI_PENGAMAT] = baru;
  const asliPush = window.history.pushState.bind(window.history);
  window.history.pushState = (...args: Parameters<History["pushState"]>) => {
    baru.dorong += 1;
    return asliPush(...args);
  };
  window.addEventListener("popstate", () => {
    if (!popSudahTercatat(bacaRiwayat(), alamatSekarang())) baru.pop += 1;
  });
  return baru;
}

/** Alamat lengkap dengan kueri: Insentif Oktober dan Insentif September adalah halaman berbeda. */
function alamatSekarang(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * Pemuatan dokumen penuh (masuk dari halaman login, tautan notifikasi, alamat
 * yang diketik) datang dari LUAR router aplikasi: halaman sebelumnya di riwayat
 * browser bisa jadi halaman login atau situs lain. Tumpukan dimulai ulang supaya
 * "Kembali" memakai tujuan cadangannya, bukan `router.back()` ke luar aplikasi.
 * Muat ulang dan mundur/maju yang memuat ulang dokumen tetap memakai tumpukannya.
 */
function jenisPemuatanPertama(): JenisPerpindahan | "mulai" {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (nav?.type === "reload") return "ganti";
  if (nav?.type === "back_forward") return "pop";
  return "mulai";
}

/**
 * Mencatat setiap perpindahan halaman di aplikasi HP (lihat `lib/pwa/riwayat.ts`),
 * supaya `TautanKembali` tahu apakah ada halaman sebelumnya untuk dituju.
 * Tidak menampilkan apa pun. Dipasang sekali di `app/pwa/layout.tsx`.
 */
export function RiwayatNavigasi() {
  const pathname = usePathname();
  // Kueri ikut dipantau: filter bulan memakai router.replace, dan puncak
  // tumpukan harus sama dengan alamat sebenarnya supaya `popSudahTercatat` dan
  // perbandingan halaman sebelumnya tidak meleset.
  const kueri = useSearchParams().toString();
  useEffect(() => {
    const p = pengamat();
    const alamat = alamatSekarang();
    const riwayat = bacaRiwayat();
    let jenis: JenisPerpindahan | "mulai" = jenisDariHitungan(p, riwayat, alamat);
    if (p.pertamaDiDokumen) {
      p.pertamaDiDokumen = false;
      jenis = jenisPemuatanPertama();
    }
    p.dorong = 0;
    p.pop = 0;
    simpanRiwayat(
      jenis === "mulai"
        ? catatPerpindahan(RIWAYAT_KOSONG, alamat, "dorong")
        : catatPerpindahan(riwayat, alamat, jenis),
    );
  }, [pathname, kueri]);
  return null;
}

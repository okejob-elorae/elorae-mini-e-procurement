"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ATRIBUT_MASUK, PERISTIWA_TIRAI_BUKA } from "@/lib/login/masuk";
import { DURASI_ANGKA_MS, angkaPada, awalGerak, kemajuan, tampilAwal } from "@/lib/gerak/angka";
import { cn } from "@/lib/utils";

/**
 * Angka yang berhitung naik ke nilainya — sekali, saat ia muncul.
 *
 * KAPAN ia bergerak diatur hati-hati, karena angka yang salah waktu terlihat
 * seperti galat:
 *   - Dimuat ulang penuh (server merender angkanya): TIDAK dari nol. Angkanya
 *     sudah terlihat sebelum JavaScript jalan; menurunkannya ke nol lalu naik
 *     lagi terbaca sebagai angka yang berkedip.
 *   - Datang dari halaman masuk (tirai menutupinya selama hidrasi): naik dari
 *     nol tepat saat tirai mulai terbuka.
 *   - Dibuka lewat menu (tanpa hidrasi): naik dari nol.
 *   - Nilainya berubah (Diperbarui): bergerak dari angka yang sedang
 *     terlihat ke yang baru — juga bila pembaruan datang di tengah gerak.
 *   - Kurangi gerakan: langsung angka akhir.
 * Keputusannya murni dan teruji: `tampilAwal`/`awalGerak` di lib/gerak/angka.ts.
 *
 * Tanpa geser tata letak: angka akhirnya dirender tak terlihat di sel yang
 * sama, jadi lebarnya sudah dicadangkan sejak awal dan teks di sebelahnya tidak
 * bergeser selama angka bertambah digit. Perataan teks ikut induknya.
 */

const tanpaLangganan = () => () => {};

function kurangiGerakSekarang(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

export function AngkaNaik({
  nilai,
  format,
  className,
}: {
  nilai: number;
  format: (n: number) => string;
  className?: string;
}) {
  // Benar HANYA saat hidrasi: snapshot server dipakai selama hidrasi.
  const sedangHidrasi = useSyncExternalStore(tanpaLangganan, () => false, () => true);
  const lahirSaatHidrasi = useRef(sedangHidrasi);
  const [tampil, setTampil] = useState(() =>
    tampilAwal({ sedangHidrasi, kurangiGerak: kurangiGerakSekarang(), nilai }),
  );
  // Angka yang sedang terlihat — titik berangkat gerak berikutnya (lib/gerak/angka.ts awalGerak).
  const terlihat = useRef(tampil);
  const sudahMulai = useRef(false);

  useEffect(() => {
    let raf = 0;
    const tampilkan = (v: number) => {
      terlihat.current = v;
      setTampil(v);
    };
    const jalan = (dari: number) => {
      sudahMulai.current = true;
      const mulai = performance.now();
      const langkah = (t: number) => {
        const k = kemajuan(mulai, t, DURASI_ANGKA_MS);
        tampilkan(angkaPada(dari, nilai, k));
        if (k < 1) raf = requestAnimationFrame(langkah);
      };
      raf = requestAnimationFrame(langkah);
    };

    const awal = awalGerak({
      kurangiGerak: kurangiGerakSekarang(),
      sudahMulai: sudahMulai.current,
      lahirSaatHidrasi: lahirSaatHidrasi.current,
      adaTirai: document.documentElement.hasAttribute(ATRIBUT_MASUK),
      tampil: terlihat.current,
      nilai,
    });

    if (awal.jenis === "jalan") {
      jalan(awal.dari);
    } else if (awal.jenis === "tunggu-tirai") {
      const saatTirai = () => jalan(0);
      window.addEventListener(PERISTIWA_TIRAI_BUKA, saatTirai, { once: true });
      return () => {
        window.removeEventListener(PERISTIWA_TIRAI_BUKA, saatTirai);
        cancelAnimationFrame(raf);
      };
    } else {
      sudahMulai.current = true;
      // Kurangi gerakan, atau setelan berubah di tengah gerak: langsung angka akhir.
      if (terlihat.current !== nilai) raf = requestAnimationFrame(() => tampilkan(nilai));
    }
    return () => cancelAnimationFrame(raf);
  }, [nilai]);

  return (
    <span className={cn("inline-grid tabular-nums", className)}>
      <span aria-hidden className="invisible col-start-1 row-start-1">
        {format(nilai)}
      </span>
      <span className="col-start-1 row-start-1">{format(tampil)}</span>
    </span>
  );
}

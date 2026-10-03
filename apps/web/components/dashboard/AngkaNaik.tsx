'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PERISTIWA_TIRAI_BUKA } from '@/lib/login/masuk';
import { angkaAntara } from '@/lib/dashboard/angka-antara';

/**
 * Angka yang naik ke nilainya — sekali, saat ia muncul.
 *
 * KAPAN ia beranimasi diatur hati-hati, karena angka yang salah waktu terlihat
 * seperti galat:
 *   - Dimuat ulang penuh (server merender angkanya): TIDAK dari nol. Angkanya
 *     sudah terlihat sebelum JavaScript jalan; menurunkannya ke nol lalu naik
 *     lagi terbaca sebagai angka yang berkedip.
 *   - Datang dari halaman masuk (tirai menutupinya selama hidrasi): naik dari
 *     nol tepat saat tirai mulai terbuka — `elorae:masuk-buka`.
 *   - Dibuka lewat menu (tanpa hidrasi): naik dari nol.
 *   - Nilainya berubah (Diperbarui): naik dari nilai lama ke yang baru.
 * Gerak dikurangi: langsung tampil.
 */

const DURASI_MS = 700;

const tanpaLangganan = () => () => {};

export function AngkaNaik({ nilai, format }: { nilai: number; format: (n: number) => string }) {
  // Benar HANYA saat hidrasi: snapshot server dipakai selama hidrasi.
  const sedangHidrasi = useSyncExternalStore(tanpaLangganan, () => false, () => true);
  const lahirSaatHidrasi = useRef(sedangHidrasi);
  const sebelumnya = useRef<number | null>(null);
  const [tampil, setTampil] = useState(nilai);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      sebelumnya.current = nilai;
      return;
    }
    let raf = 0;
    const jalan = (dari: number) => {
      const t0 = performance.now();
      const langkah = (t: number) => {
        const k = Math.min(1, (t - t0) / DURASI_MS);
        setTampil(angkaAntara(dari, nilai, k));
        if (k < 1) raf = requestAnimationFrame(langkah);
        else sebelumnya.current = nilai;
      };
      raf = requestAnimationFrame(langkah);
    };

    if (sebelumnya.current !== null) {
      if (sebelumnya.current !== nilai) jalan(sebelumnya.current);
    } else if (!lahirSaatHidrasi.current) {
      jalan(0);
    } else if (document.documentElement.hasAttribute('data-masuk')) {
      const saatTirai = () => jalan(0);
      window.addEventListener(PERISTIWA_TIRAI_BUKA, saatTirai, { once: true });
      return () => {
        window.removeEventListener(PERISTIWA_TIRAI_BUKA, saatTirai);
        cancelAnimationFrame(raf);
      };
    } else {
      sebelumnya.current = nilai;
    }
    return () => cancelAnimationFrame(raf);
  }, [nilai]);

  return <>{format(tampil)}</>;
}

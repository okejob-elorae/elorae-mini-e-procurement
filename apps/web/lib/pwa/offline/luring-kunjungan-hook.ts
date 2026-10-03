"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PERISTIWA_ANTREAN } from "./hitung";
import { kunjunganAktifLokal, type KeadaanKunjunganLokal, type KunjunganLokal } from "./luring-kunjungan";

/**
 * Kunjungan yang berjalan di HP untuk satu toko (`kunjunganAktifLokal`), dibaca
 * ulang setiap kali antrean berubah atau layar kembali terlihat.
 *
 * Dengan `segarkanSaatTerkirim`, halaman dimuat ulang dari server begitu
 * check-in dari antrean sampai: halaman yang dibuka dari cache (tanpa sinyal)
 * masih berkata "belum check-in", padahal server kini mengenal kunjungannya.
 * Penyinkron hanya berhasil saat ada sinyal, jadi muat ulangnya tidak sia-sia.
 */
export function useKunjunganLokal(
  storeId: string | null | undefined,
  opsi: { segarkanSaatTerkirim?: boolean } = {},
): { siap: boolean; kunjungan: KunjunganLokal | null } {
  const router = useRouter();
  const [keadaan, setKeadaan] = useState<{ siap: boolean; kunjungan: KunjunganLokal | null }>({ siap: false, kunjungan: null });
  const lama = useRef<KeadaanKunjunganLokal | null>(null);
  const segarkan = opsi.segarkanSaatTerkirim === true;

  useEffect(() => {
    let hidup = true;
    const muat = () => {
      void kunjunganAktifLokal(storeId ?? null).then((k) => {
        if (!hidup) return;
        const sebelum = lama.current;
        lama.current = k?.keadaan ?? null;
        setKeadaan({ siap: true, kunjungan: k });
        if (segarkan && sebelum === "antre" && k?.keadaan !== "antre" && navigator.onLine) router.refresh();
      });
    };
    muat();
    const terlihat = () => {
      if (document.visibilityState === "visible") muat();
    };
    window.addEventListener(PERISTIWA_ANTREAN, muat);
    document.addEventListener("visibilitychange", terlihat);
    return () => {
      hidup = false;
      window.removeEventListener(PERISTIWA_ANTREAN, muat);
      document.removeEventListener("visibilitychange", terlihat);
    };
  }, [storeId, segarkan, router]);

  return keadaan;
}

import { useEffect, useRef } from 'react';

/**
 * Buka dialog cetak setelah halamannya benar-benar terpasang.
 *
 * Jedanya bukan hiasan: memanggil `window.print()` pada render yang sama
 * menghasilkan halaman setengah kosong — pelajaran dari halaman cetak work
 * order di aplikasi ini. Pembersihannya melepas penjaga supaya pemanggilan
 * ganda Strict Mode tetap mencetak sekali (timer pertama dibatalkan, kedua jalan).
 */
export function useCetakOtomatis(siap: boolean) {
  const sudah = useRef(false);
  useEffect(() => {
    if (!siap || sudah.current) return;
    /*
     * `?pratinjau=1` menahan dialog cetaknya. Berguna untuk memeriksa dokumen
     * sebelum mencetaknya — dan tanpa jalan keluar ini halaman cetak tidak bisa
     * dilihat sama sekali tanpa melewati dialog printer.
     */
    if (new URLSearchParams(window.location.search).get('pratinjau') === '1') return;
    sudah.current = true;
    const timer = setTimeout(() => window.print(), 400);
    return () => {
      clearTimeout(timer);
      sudah.current = false;
    };
  }, [siap]);
}

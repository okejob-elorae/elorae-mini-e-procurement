'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Animasi FLIP untuk daftar yang berubah urutan.
 *
 * Namanya dari langkahnya: First, Last, Invert, Play. Posisi tiap elemen
 * direkam SEBELUM React menggambar ulang, lalu setelah tata letaknya berubah
 * elemen itu digeser balik ke posisi lamanya dan dianimasikan ke posisi
 * barunya. Hasilnya ubin terlihat BERGERAK ke tempat barunya, bukan menghilang
 * lalu muncul lagi di tempat lain.
 *
 * Dilakukan lewat transform, bukan dengan menganimasikan posisi tata letaknya.
 * Transform tidak memaksa perhitungan tata letak ulang tiap bingkai, jadi
 * geraknya tetap halus walau ubinnya puluhan dan tiap ubin memuat gambar.
 *
 * `useLayoutEffect`, BUKAN `useEffect`: posisi barunya harus dibaca sebelum
 * peramban sempat melukis. Dengan `useEffect` satu bingkai sudah tergambar di
 * posisi baru, jadi yang terlihat justru loncatan yang mau dihilangkan — lalu
 * animasinya berjalan sesudahnya, yang malah tampak seperti dua gerakan.
 */
export function useFlip(
  wadah: RefObject<HTMLElement | null>,
  /** Berubah setiap kali urutannya berubah — misal daftar id yang digabung. */
  kunci: string,
  opsi?: { durasi?: number },
): void {
  const posisi = useRef(new Map<string, DOMRect>());

  useLayoutEffect(() => {
    const el = wadah.current;
    if (!el) return;

    /*
     * Yang meminta gerak dikurangi tidak diberi animasi sama sekali — tapi
     * posisinya TETAP direkam, supaya kalau setelan itu berubah di tengah sesi
     * animasi berikutnya tidak melompat dari posisi basi.
     */
    const kurangiGerak =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const baru = new Map<string, DOMRect>();
    for (const ubin of el.querySelectorAll<HTMLElement>('[data-flip]')) {
      const id = ubin.dataset.flip;
      if (!id) continue;
      const kini = ubin.getBoundingClientRect();
      baru.set(id, kini);

      const lama = posisi.current.get(id);
      if (!lama || kurangiGerak) continue;

      const dx = lama.left - kini.left;
      const dy = lama.top - kini.top;
      // Di bawah satu piksel bukan perpindahan, hanya pembulatan tata letak.
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

      ubin.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, offset: 0 },
          { transform: 'none', offset: 1 },
        ],
        {
          duration: opsi?.durasi ?? 340,
          // Cepat di awal lalu mengendap — gerak yang terbaca sebagai benda
          // dipindahkan, bukan nilai yang diinterpolasi.
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
      );
    }
    posisi.current = baru;
  }, [kunci, wadah, opsi?.durasi]);
}

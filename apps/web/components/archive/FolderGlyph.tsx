'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * Satu folder arsip.
 *
 * Dipakai DUA layar — arsip dokumen dan arsip nota retur. Sebelumnya keduanya
 * menggambar foldernya sendiri, satu digambar tangan dan satu memakai ikon
 * garis lucide, jadi dua layar dengan metafora yang sama terlihat berbeda.
 */
export function FolderGlyph({
  empty,
  pending,
  className,
}: {
  empty: boolean;
  /** Lebih dari nol memasang titik merah: ada yang menggantung di dalamnya. */
  pending: number;
  className?: string;
}) {
  /*
   * Id unik per folder. Gradien SVG dirujuk lewat id, dan id kembar membuat
   * seluruh folder di kisi memakai gradien milik folder pertama — yang baru
   * terlihat salah kalau ada dua tema di satu halaman, tapi tetap salah.
   */
  const uid = useId().replace(/:/g, '');

  return (
    <span className="relative inline-flex">
      {/*
       * Digambar sendiri, bukan ikon huruf, supaya lidah foldernya terbaca pada
       * ukuran ini — dan supaya keadaan kosong bisa jadi folder yang benar-benar
       * lebih pucat, bukan ikon yang diabu-abukan.
       *
       * WARNANYA PENUH, bukan `fill-primary/45` seperti sebelumnya. Opasitas
       * mencampur warna tema dengan latar, jadi tema pucat — lime, kuning —
       * menghilang begitu saja di atas krem. Yang membuatnya terbaca sekarang
       * tiga hal: gradien (terang di atas, pekat di bawah, seolah cahaya jatuh
       * dari atas), lidah yang lebih gelap sehingga folder terbaca sebagai dua
       * bidang bertumpuk, dan GARIS TEPI yang lebih gelap lagi — garis tepi
       * itulah yang menjamin siluetnya kelihatan di atas latar seterang apa pun.
       *
       * Semua nadanya diracik dari `--primary` dengan `color-mix`, jadi ia ikut
       * tema apa pun tanpa satu pun warna ditulis tangan di sini.
       */}
      <svg
        viewBox="0 0 48 42"
        className={cn('h-11 w-[3.3rem] overflow-visible', empty && 'opacity-60', className)}
        aria-hidden
      >
        <defs>
          <linearGradient id={`badan-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--folder-terang)" />
            <stop offset="100%" stopColor="var(--folder-pekat)" />
          </linearGradient>
          <linearGradient id={`lidah-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--folder-pekat)" />
            <stop offset="100%" stopColor="var(--folder-gelap)" />
          </linearGradient>
        </defs>

        {/* Bayangan lembut di bawahnya — mengangkat folder dari kertas. */}
        <ellipse
          cx="24"
          cy="39.5"
          rx="17"
          ry="2.2"
          className="fill-foreground/[0.13]"
          style={{ filter: 'blur(1.5px)' }}
        />

        {/* Lidah, di belakang badan dan lebih gelap: dua bidang bertumpuk. */}
        <path
          d="M2 9a4 4 0 0 1 4-4h11.2a4 4 0 0 1 2.83 1.17L24 9.5H2Z"
          fill={empty ? 'var(--folder-kosong-gelap)' : `url(#lidah-${uid})`}
          stroke="var(--folder-garis)"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />

        {/* Badan depan. */}
        <rect
          x="1.5"
          y="8"
          width="45"
          height="29"
          rx="4"
          fill={empty ? 'var(--folder-kosong)' : `url(#badan-${uid})`}
          stroke="var(--folder-garis)"
          strokeWidth="1"
        />

        {/* Bibir atas yang menangkap cahaya. Tipis, satu piksel — ini yang
            membuat bidangnya terbaca punya ketebalan, bukan sekadar berwarna. */}
        <path
          d="M4.5 9.2h39"
          stroke="var(--folder-kilau)"
          strokeWidth="1.4"
          strokeLinecap="round"
          opacity={empty ? 0.35 : 0.85}
        />
      </svg>
      {pending > 0 && (
        <span
          className="absolute -bottom-0.5 right-1 h-3 w-3 rounded-full bg-destructive ring-2 ring-card"
          aria-hidden
        />
      )}
    </span>
  );
}
'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * Satu folder arsip.
 *
 * Siluetnya meniru folder macOS, dan yang membuatnya terbaca sebagai BENDA
 * bukan warnanya melainkan bentuknya: satu bidang belakang yang lidahnya
 * MENYATU — naik di kiri lalu turun miring ke tepi atas — dan satu panel depan
 * yang menutupinya, menyisakan segaris bidang belakang di atas. Versi
 * sebelumnya menempelkan lidah sebagai kotak terpisah, dan itu terbaca sebagai
 * dua persegi bertumpuk, bukan map kertas.
 *
 * Dipakai DUA layar — arsip dokumen dan arsip nota retur. Sebelumnya keduanya
 * menggambar foldernya sendiri, satu digambar tangan dan satu memakai ikon
 * garis lucide, jadi metafora yang sama terlihat berbeda di dua tempat.
 */

/** Bidang belakang, berlidah. Lidahnya bagian dari siluet, bukan tempelan. */
const BELAKANG =
  'M3 9a3.4 3.4 0 0 1 3.4-3.4h11.4a3.4 3.4 0 0 1 2.4 1l2.5 2.5a3.4 3.4 0 0 0 2.4 1h16.5A3.4 3.4 0 0 1 45 13.5V33a3.4 3.4 0 0 1-3.4 3.4H6.4A3.4 3.4 0 0 1 3 33Z';

/** Panel depan. Mulai lebih rendah, jadi bidang belakangnya menyembul. */
const DEPAN =
  'M3 15.4a2.6 2.6 0 0 1 2.6-2.6h36.8a2.6 2.6 0 0 1 2.6 2.6V33a3.4 3.4 0 0 1-3.4 3.4H6.4A3.4 3.4 0 0 1 3 33Z';

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
   * seluruh folder di kisi memakai gradien milik folder pertama.
   */
  const uid = useId().replace(/:/g, '');

  return (
    <span className="relative inline-flex">
      {/*
       * Nadanya diracik dari `--primary` — lihat `globals.css`. Warnanya PENUH,
       * bukan opasitas: opasitas mencampur warna tema dengan latar, jadi tema
       * pucat menghilang begitu saja di atas krem.
       */}
      <svg
        viewBox="0 0 48 40"
        className={cn('h-11 w-[3.3rem] overflow-visible', empty && 'opacity-55', className)}
        aria-hidden
      >
        <defs>
          <linearGradient id={`depan-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--folder-terang)" />
            <stop offset="100%" stopColor="var(--folder-pekat)" />
          </linearGradient>
        </defs>

        {/* Bayangan lembut — mengangkat folder dari kertas. */}
        <ellipse
          cx="24"
          cy="37.6"
          rx="16"
          ry="1.9"
          className="fill-foreground/[0.18]"
          style={{ filter: 'blur(1.6px)' }}
        />

        <path
          d={BELAKANG}
          fill={empty ? 'var(--folder-kosong-gelap)' : 'var(--folder-gelap)'}
          stroke="var(--folder-garis)"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        <path
          d={DEPAN}
          fill={empty ? 'var(--folder-kosong)' : `url(#depan-${uid})`}
          stroke="var(--folder-garis)"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />

        {/* Bibir atas yang menangkap cahaya. Setipis satu piksel — ini yang
            membuat panelnya terbaca punya ketebalan, bukan sekadar berwarna. */}
        <path
          d="M6 14.2h36"
          stroke="var(--folder-kilau)"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity={empty ? 0.3 : 0.8}
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

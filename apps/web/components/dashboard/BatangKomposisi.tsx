'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { AngkaNaik } from './AngkaNaik';

/**
 * Satu batang yang dibelah menurut bagiannya, dengan keterangan di bawahnya.
 *
 * Dipakai untuk pertanyaan "berapa bagian dari keseluruhan": umur piutang,
 * komposisi nilai stok. Satu batang, bukan donat — panjang lebih mudah
 * dibandingkan mata daripada sudut, dan muat dalam satu baris pendek.
 */

export type Bagian = { label: string; nilai: number; warna: string; keterangan?: string };

export function BatangKomposisi({
  judul,
  total,
  format,
  bagian,
  href,
  kosong,
}: {
  judul: string;
  total: number;
  format: (n: number) => string;
  bagian: Bagian[];
  href?: string;
  /** Kalimat saat totalnya nol — batang kosong tanpa kalimat terbaca sebagai galat. */
  kosong: string;
}) {
  const ada = total > 0;
  const kepala = (
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="beranda-judul">{judul}</h3>
      {href ? <ChevronRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground" /> : null}
    </div>
  );
  return (
    <section className="viz beranda-kartu">
      {href ? (
        <Link href={href} className="block hover:opacity-80">
          {kepala}
        </Link>
      ) : (
        kepala
      )}
      <p className="mt-1 text-xl font-semibold tabular-nums">
        <AngkaNaik nilai={total} format={format} />
      </p>
      {ada ? (
        <>
          <div
            className="beranda-tumbuh mt-2.5 flex h-2.5 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={bagian.map((b) => `${b.label} ${format(b.nilai)}`).join(', ')}
          >
            {bagian
              .filter((b) => b.nilai > 0)
              .map((b) => (
                <span
                  key={b.label}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${(b.nilai / total) * 100}%`, background: b.warna }}
                />
              ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {bagian.map((b) => (
              <li key={b.label} className="flex items-center gap-1.5">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-sm" style={{ background: b.warna }} />
                <span>
                  {b.label} · <span className="tabular-nums text-foreground">{format(b.nilai)}</span>
                  {b.keterangan ? ` · ${b.keterangan}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{kosong}</p>
      )}
    </section>
  );
}

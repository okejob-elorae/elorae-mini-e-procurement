'use client';

import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { tintaDi } from './BarisSablon';

/**
 * Deretan warna palet. Lima kotak untuk palet bebas; satu sampai enam untuk
 * palet berkain, masing-masing bisa dihapus, dengan kotak tambah di ujungnya.
 */
export function DeretWarna({
  hex,
  terpilih,
  onPilih,
  labelUbin,
  tandaUbin,
  onSalin,
  judulSalin,
  onHapus,
  labelHapus,
  onTambah,
  labelTambah,
}: {
  hex: string[];
  terpilih: number;
  onPilih: (indeks: number) => void;
  /** Label aksesibel tiap kotak. */
  labelUbin: (indeks: number) => string;
  /** Tulisan di dalam kotak: "DASAR", "A", atau tidak ada. */
  tandaUbin: (indeks: number) => string | null;
  onSalin: (hex: string) => void;
  judulSalin: (hex: string) => string;
  onHapus?: (indeks: number) => void;
  labelHapus?: (indeks: number) => string;
  onTambah?: () => void;
  labelTambah?: string;
}) {
  const kolom = hex.length + (onTambah ? 1 : 0);
  return (
    <div className="grid gap-2 sm:gap-3" style={{ gridTemplateColumns: `repeat(${kolom}, minmax(0, 1fr))` }}>
      {hex.map((kode, i) => {
        const aktif = i === terpilih;
        const tinta = tintaDi(kode);
        const tanda = tandaUbin(i);
        return (
          <div key={i} className="relative flex min-w-0 flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => onPilih(i)}
              aria-pressed={aktif}
              aria-label={labelUbin(i)}
              className={cn(
                'flex h-24 w-full items-end justify-center rounded-lg pb-2 outline-none sm:h-36',
                'motion-safe:transition-[transform,box-shadow] motion-safe:duration-200',
                'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                aktif
                  ? 'shadow-lg ring-2 ring-foreground ring-offset-2 ring-offset-card motion-safe:-translate-y-1'
                  : 'ring-1 ring-inset ring-black/10 hover:shadow-md dark:ring-white/10 motion-safe:hover:-translate-y-0.5',
              )}
              style={{ background: kode }}
            >
              {tanda && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ color: tinta, background: tinta === '#ffffff' ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.5)' }}
                >
                  {tanda}
                </span>
              )}
            </button>
            {onHapus && hex.length > 1 && (
              <button
                type="button"
                onClick={() => onHapus(i)}
                aria-label={labelHapus?.(i)}
                title={labelHapus?.(i)}
                className={cn(
                  'absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full outline-none',
                  'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  aktif && 'motion-safe:-translate-y-1',
                )}
                style={{ color: tinta, background: tinta === '#ffffff' ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.55)' }}
              >
                <X className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onSalin(kode)}
              title={judulSalin(kode)}
              className="max-w-full truncate rounded px-1 font-mono text-[10px] uppercase text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:text-xs"
            >
              {kode}
            </button>
          </div>
        );
      })}
      {onTambah && (
        <div className="flex min-w-0 flex-col items-center gap-2">
          <button
            type="button"
            onClick={onTambah}
            aria-label={labelTambah}
            title={labelTambah}
            className="flex h-24 w-full items-center justify-center rounded-lg border-2 border-dashed text-muted-foreground outline-none hover:border-foreground/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-36"
          >
            <Plus className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}

'use client';

import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { ImagePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KOLOM_FEED, labelTanggal, susunFeed } from '@/lib/creative/feed';
import type { BarisKonten } from '@/lib/creative/queries';

/**
 * Pratinjau feed Instagram.
 *
 * Bentuknya meniru yang dipakai tim hari ini di spreadsheet: tiga kolom,
 * tanggal di bilah hitam di ATAS ubinnya, nomor baris di kiri, terbaru di kiri
 * atas. Kemiripan itu disengaja — art director sudah membaca susunan ini setiap
 * hari, dan layar yang menuntut cara membaca baru akan ditinggalkan demi
 * spreadsheet yang sudah ia hafal.
 *
 * Yang TIDAK ditiru: sel kosong di sini tetap bisa diklik dan tahu statusnya,
 * dan tanggalnya berasal dari jadwal yang sama yang dipakai daftar tugas —
 * bukan teks yang diketik terpisah lalu menyimpang.
 */
export function GridFeed({
  konten,
  onPilih,
}: {
  konten: BarisKonten[];
  onPilih: (k: BarisKonten) => void;
}) {
  const t = useTranslations('creative');
  const locale = useLocale();
  const baris = susunFeed(konten);

  return (
    <div className="space-y-0.5">
      {baris.map((b) => (
        <div key={b.nomor} className="flex gap-2">
          {/* Nomor baris, sama seperti kolom paling kiri di spreadsheet-nya. */}
          <div className="w-6 shrink-0 pt-9 text-right text-sm font-medium tabular-nums text-muted-foreground">
            {b.nomor}
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-3 gap-0.5">
            {b.sel.map((sel) => {
              const k = sel.konten;
              const tanggal = labelTanggal(k.scheduledAt, locale);
              return (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => onPilih(k)}
                  className="group block text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {/* Bilah tanggal di ATAS ubinnya, persis seperti sheet-nya. */}
                  <div
                    className={cn(
                      'truncate px-2 py-1 text-center text-xs font-medium',
                      tanggal
                        ? 'bg-foreground text-background'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {tanggal ?? t('unscheduled')}
                  </div>
                  <div className="relative aspect-square w-full overflow-hidden bg-muted">
                    {sel.jenis === 'konten' && k.imageUrl ? (
                      <Image
                        src={k.imageUrl}
                        alt={k.title}
                        fill
                        sizes="(max-width: 768px) 33vw, 200px"
                        className="object-cover transition-opacity group-hover:opacity-90"
                      />
                    ) : (
                      /* Slot kosong TETAP terlihat: ia bagian dari komposisi
                         yang sedang dinilai, bukan baris yang boleh dirapatkan. */
                      <span className="flex h-full w-full flex-col items-center justify-center gap-1 border border-dashed p-2 text-center">
                        <ImagePlus className="h-5 w-5 text-muted-foreground" />
                        <span className="line-clamp-2 text-[11px] leading-tight text-muted-foreground">
                          {k.title}
                        </span>
                      </span>
                    )}
                    {k.terlambat && (
                      <span className="absolute left-1 top-1 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground">
                        {t('late')}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
            {/* Baris terakhir yang belum penuh dibiarkan berlubang, bukan
                direntangkan — supaya lebar ubinnya tetap sama di semua baris. */}
            {Array.from({ length: KOLOM_FEED - b.sel.length }).map((_, i) => (
              <div key={`sisa-${i}`} aria-hidden />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

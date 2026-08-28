'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * Komposisi perintah kerja sebagai SATU batang.
 *
 * Bentuknya dipilih dari pekerjaan datanya: yang ditanya bukan "berapa banyak
 * yang DRAFT" melainkan "di tahap mana pekerjaan menumpuk". Itu pertanyaan
 * tentang proporsi, dan proporsi dibaca dari satu batang utuh — bukan dari
 * enam baris tabel yang harus dijumlah sendiri di kepala.
 *
 * Warnanya diberikan menurut URUTAN TETAP, tidak diputar. Slot ketiga selalu
 * IN_PRODUCTION, apa pun yang tersaring — warna yang berpindah pemilik saat
 * daftar berubah membuat orang salah baca grafik yang kemarin ia hafal.
 */

export type BarisPipeline = { status: string; count: number; label: string };

const WARNA = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-6)', 'var(--viz-5)'];

export function PipelineBar({ baris }: { baris: BarisPipeline[] }) {
  const t = useTranslations('dashboard');
  const total = baris.reduce((s, b) => s + b.count, 0);
  const terisi = baris.filter((b) => b.count > 0);

  if (total === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t('vizEmpty')}</p>;
  }

  return (
    <div className="viz space-y-3">
      {/* Batangnya. Celah 2px antar ruas supaya batas warnanya terbaca tanpa
          bergantung pada beda rona saja — itu juga yang menutup peringatan
          kontras palet terhadap latar terang. */}
      <div className="flex h-9 w-full gap-[2px] overflow-hidden rounded-lg" role="img"
        aria-label={terisi.map((b) => `${b.label}: ${b.count}`).join(', ')}>
        {terisi.map((b, i) => {
          const persen = (b.count / total) * 100;
          return (
            <div
              key={b.status}
              className="relative flex items-center justify-center first:rounded-l-lg last:rounded-r-lg"
              style={{ width: `${persen}%`, background: WARNA[i % WARNA.length] }}
              title={`${b.label}: ${b.count}`}
            >
              {/* Angka ditulis langsung di ruas yang cukup lebar. Menulisnya di
                  SEMUA ruas membuat yang sempit jadi tumpang tindih. */}
              {persen >= 9 && (
                <span className="text-[11px] font-semibold tabular-nums text-white drop-shadow-sm">
                  {b.count}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Legenda selalu ada: identitas tidak boleh bergantung pada warna saja. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {terisi.map((b, i) => (
          <span key={b.status} className="flex items-center gap-1.5 text-xs">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
              style={{ background: WARNA[i % WARNA.length] }}
            />
            <span className="text-muted-foreground">{b.label}</span>
            <span className="font-medium tabular-nums">{b.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Peringkat sederhana: satu ukuran, banyak nama.
 *
 * SATU rona, bukan pelangi. Warna di sini tidak membawa identitas — namanya
 * sudah tertulis di sebelah batangnya — jadi memberi tiap batang rona berbeda
 * menyiratkan pengelompokan yang tidak ada.
 *
 * Batang mendatar karena namanya panjang; batang tegak memaksa namanya dimiringkan
 * atau dipotong, dan nama yang dipotong tidak bisa dibaca siapa pun.
 */
export function PeringkatBar({
  baris,
  format,
}: {
  baris: { id: string; nama: string; nilai: number }[];
  format: (n: number) => string;
}) {
  const t = useTranslations('dashboard');
  const puncak = Math.max(1, ...baris.map((b) => b.nilai));

  if (baris.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t('vizEmpty')}</p>;
  }

  return (
    <div className="space-y-2.5">
      {baris.map((b) => (
        <div key={b.id} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3">
          <span className="truncate text-sm" title={b.nama}>
            {b.nama}
          </span>
          {/*
            `block`, BUKAN span polos. Span bawaannya inline, jadi tinggi dan
            lebarnya diabaikan sama sekali dan batangnya tidak muncul — itu
            benar-benar terjadi di versi pertama, lolos type-check dan lolos
            lint, dan hanya ketahuan karena grafiknya dilihat.
          */}
          <span className="block h-2.5 overflow-hidden rounded-full bg-muted">
            <span
              className={cn('block h-full rounded-full bg-primary')}
              style={{ width: `${Math.max(2, (b.nilai / puncak) * 100)}%` }}
            />
          </span>
          <span className="text-sm font-medium tabular-nums">{format(b.nilai)}</span>
        </div>
      ))}
    </div>
  );
}

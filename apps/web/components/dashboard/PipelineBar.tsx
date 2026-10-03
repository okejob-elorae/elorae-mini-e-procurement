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
 * Warna terkunci ke STATUS lewat `kelas` (lihat `warna-status-wo.ts`), sama
 * dengan lencana status di bawah batang. Palet menurut urutan hanya cadangan
 * untuk pemanggil yang tidak memberi `kelas` — dan urutan itu urutan baris yang
 * TERISI, jadi warnanya bisa berpindah pemilik begitu satu status kosong.
 */

export type BarisPipeline = {
  status: string;
  count: number;
  label: string;
  /** Kelas warna ruas (mis. `bg-blue-600`) — dipakai supaya batang sewarna lencana statusnya. */
  kelas?: string;
};

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
              className={cn('relative flex items-center justify-center first:rounded-l-lg last:rounded-r-lg', b.kelas)}
              style={{ width: `${persen}%`, background: b.kelas ? undefined : WARNA[i % WARNA.length] }}
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
              className={cn('h-2.5 w-2.5 shrink-0 rounded-[3px]', b.kelas)}
              style={{ background: b.kelas ? undefined : WARNA[i % WARNA.length] }}
            />
            <span className="text-muted-foreground">{b.label}</span>
            <span className="font-medium tabular-nums">{b.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

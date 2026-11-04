'use client';

import { useLocale, useTranslations } from 'next-intl';
import { STATUS_TONE_CLASS, type StatusTone } from '@/components/ui/status-pill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  rasioKontras,
  tampilRasio,
  tingkatKontras,
  type TingkatKontras,
} from '@/lib/production-colors/palet/kontras';
import { keterbacaanSablon, type KeterbacaanSablon } from '@/lib/production-colors/sablon/saran';
import { cn } from '@/lib/utils';

const NADA: Record<TingkatKontras, StatusTone> = {
  AAA: 'settled',
  AA: 'progress',
  AA_BESAR: 'waiting',
  GAGAL: 'inactive',
};

const TINGKAT: TingkatKontras[] = ['AAA', 'AA', 'AA_BESAR', 'GAGAL'];

const NADA_BACA: Record<KeterbacaanSablon, StatusTone> = {
  KUAT: 'settled',
  CUKUP: 'progress',
  LEMBUT: 'waiting',
  SAMAR: 'attention',
};

const BACA: KeterbacaanSablon[] = ['KUAT', 'CUKUP', 'LEMBUT', 'SAMAR'];

function Keping({ hex }: { hex: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-4 shrink-0 rounded ring-1 ring-inset ring-black/15 dark:ring-white/20"
      style={{ background: hex }}
    />
  );
}

/**
 * Palet berkain: satu-satunya patokan adalah kain. Tinta dicetak di kain,
 * bukan di atas tinta lain, jadi yang ditampilkan hanya tiap tinta di atas
 * kain — dengan skala keterbacaan sablon yang sama seperti baris tintanya,
 * bukan label WCAG yang menyebut tone-on-tone "gagal".
 */
function KontrasDiKain({ warna, kain, label }: { warna: string[]; kain: string; label: (indeks: number) => string }) {
  const t = useTranslations('productionPalette');
  const tSablon = useTranslations('productionPrint');
  const locale = useLocale();
  const angka = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {warna.map((hex, i) => {
          const rasio = rasioKontras(hex, kain);
          const baca = keterbacaanSablon(rasio);
          return (
            <li key={i} className="space-y-1.5">
              <div
                className="flex h-16 items-center justify-center rounded-md ring-1 ring-inset ring-black/10 dark:ring-white/10"
                style={{ background: kain, color: hex }}
              >
                <span className="text-2xl font-semibold leading-none">Aa</span>
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
                  <Keping hex={hex} />
                  <span className="truncate">{label(i)}</span>
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{angka.format(tampilRasio(rasio))}</span>
              </div>
              <span
                className={cn(
                  'inline-flex rounded px-1.5 text-[10px] font-medium leading-4 ring-1 ring-inset whitespace-nowrap',
                  STATUS_TONE_CLASS[NADA_BACA[baca]],
                )}
              >
                {tSablon(`readability.${baca}`)}
              </span>
            </li>
          );
        })}
      </ul>

      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
        {BACA.map((baca) => (
          <li key={baca} className="flex items-center gap-1.5">
            <span className={cn('rounded px-1 text-[10px] font-medium leading-4 ring-1 ring-inset', STATUS_TONE_CLASS[NADA_BACA[baca]])}>
              {tSablon(`readability.${baca}`)}
            </span>
            {t(`readabilityHints.${baca}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Kisi keterbacaan palet bebas: setiap warna palet sebagai latar, setiap warna
 * palet ditambah putih dan hitam sebagai tulisan. Palet berkain memakai
 * `KontrasDiKain` — patokannya hanya kain.
 *
 * Putih dan hitam ikut karena di feed Instagram tulisan paling sering memang
 * salah satu dari keduanya — pertanyaan yang benar-benar diajukan art director
 * adalah "teks putih masih terbaca di warna ini atau tidak".
 */
export function KisiKontras({
  warna,
  kain = null,
  labelWarna,
}: {
  warna: string[];
  /** Palet berkain: hanya keterbacaan tiap tinta di atas kain ini. */
  kain?: string | null;
  labelWarna?: (indeks: number) => string;
}) {
  const t = useTranslations('productionPalette');
  const locale = useLocale();
  const angka = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const label = labelWarna ?? ((i: number) => t('swatchLabel', { n: i + 1 }));
  if (kain) return <KontrasDiKain warna={warna} kain={kain} label={label} />;
  const latar = warna.map((hex, i) => ({ hex, label: label(i) }));
  const tulisan = [
    ...warna.map((hex, i) => ({ hex, label: label(i) })),
    { hex: '#ffffff', label: t('white') },
    { hex: '#000000', label: t('black') },
  ];

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[8rem] text-xs text-muted-foreground">{t('contrastCorner')}</TableHead>
              {tulisan.map((k) => (
                <TableHead key={k.label} className="min-w-[5.75rem] text-center">
                  <span className="inline-flex flex-col items-center gap-1 py-1">
                    <Keping hex={k.hex} />
                    <span className="text-xs font-medium">{k.label}</span>
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {latar.map(({ hex: warnaLatar, label: labelLatar }, baris) => (
              <TableRow key={baris} className="hover:bg-transparent">
                <TableCell>
                  <span className="flex items-center gap-2">
                    <Keping hex={warnaLatar} />
                    <span className="flex flex-col leading-tight">
                      <span className="text-xs font-medium">{labelLatar}</span>
                      <span className="font-mono text-[11px] uppercase text-muted-foreground">{warnaLatar}</span>
                    </span>
                  </span>
                </TableCell>
                {tulisan.map((teks) => {
                  if (teks.hex === warnaLatar) {
                    return (
                      <TableCell key={teks.label} className="text-center text-[11px] text-muted-foreground">
                        {t('sameColor')}
                      </TableCell>
                    );
                  }
                  const rasio = rasioKontras(warnaLatar, teks.hex);
                  const tingkat = tingkatKontras(rasio);
                  return (
                    <TableCell key={teks.label} className="p-1.5">
                      <div
                        className="flex h-11 items-center justify-center rounded-md ring-1 ring-inset ring-black/10 dark:ring-white/10"
                        style={{ background: warnaLatar, color: teks.hex }}
                      >
                        <span className="text-lg font-semibold leading-none">Aa</span>
                      </div>
                      <div className="mt-1 flex items-center justify-center gap-1">
                        <span className="text-[11px] tabular-nums text-muted-foreground">{angka.format(tampilRasio(rasio))}</span>
                        <span
                          className={cn(
                            'rounded px-1 text-[10px] font-medium leading-4 ring-1 ring-inset whitespace-nowrap',
                            STATUS_TONE_CLASS[NADA[tingkat]],
                          )}
                        >
                          {t(`levels.${tingkat}.name`)}
                        </span>
                      </div>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
        {TINGKAT.map((tingkat) => (
          <li key={tingkat} className="flex items-center gap-1.5">
            <span
              className={cn(
                'rounded px-1 text-[10px] font-medium leading-4 ring-1 ring-inset',
                STATUS_TONE_CLASS[NADA[tingkat]],
              )}
            >
              {t(`levels.${tingkat}.name`)}
            </span>
            {t(`levels.${tingkat}.hint`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

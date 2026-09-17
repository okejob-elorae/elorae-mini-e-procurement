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
} from '@/lib/creative/palet/kontras';
import { cn } from '@/lib/utils';

const NADA: Record<TingkatKontras, StatusTone> = {
  AAA: 'settled',
  AA: 'progress',
  AA_BESAR: 'waiting',
  GAGAL: 'inactive',
};

const TINGKAT: TingkatKontras[] = ['AAA', 'AA', 'AA_BESAR', 'GAGAL'];

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
 * Kisi keterbacaan: setiap warna palet sebagai latar, setiap warna palet
 * ditambah putih dan hitam sebagai tulisan.
 *
 * Putih dan hitam ikut karena di feed Instagram tulisan paling sering memang
 * salah satu dari keduanya — pertanyaan yang benar-benar diajukan art director
 * adalah "teks putih masih terbaca di warna ini atau tidak".
 */
export function KisiKontras({ warna }: { warna: string[] }) {
  const t = useTranslations('creative.palette');
  const locale = useLocale();
  const angka = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const tulisan = [
    ...warna.map((hex, i) => ({ hex, label: t('swatchLabel', { n: i + 1 }) })),
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
            {warna.map((latar, baris) => (
              <TableRow key={baris} className="hover:bg-transparent">
                <TableCell>
                  <span className="flex items-center gap-2">
                    <Keping hex={latar} />
                    <span className="flex flex-col leading-tight">
                      <span className="text-xs font-medium">{t('swatchLabel', { n: baris + 1 })}</span>
                      <span className="font-mono text-[11px] uppercase text-muted-foreground">{latar}</span>
                    </span>
                  </span>
                </TableCell>
                {tulisan.map((teks) => {
                  if (teks.hex === latar) {
                    return (
                      <TableCell key={teks.label} className="text-center text-[11px] text-muted-foreground">
                        {t('sameColor')}
                      </TableCell>
                    );
                  }
                  const rasio = rasioKontras(latar, teks.hex);
                  const tingkat = tingkatKontras(rasio);
                  return (
                    <TableCell key={teks.label} className="p-1.5">
                      <div
                        className="flex h-11 items-center justify-center rounded-md ring-1 ring-inset ring-black/10 dark:ring-white/10"
                        style={{ background: latar, color: teks.hex }}
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

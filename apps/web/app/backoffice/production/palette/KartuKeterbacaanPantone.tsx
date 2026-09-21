'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { STATUS_TONE_CLASS, type StatusTone } from '@/components/ui/status-pill';
import { Switch } from '@/components/ui/switch';
import { KELUARGA_WARNA, type KeluargaWarna } from '@/lib/production-colors/palet/katalog';
import { tampilRasio } from '@/lib/production-colors/palet/kontras';
import type { WarnaPantone } from '@/lib/production-colors/palet/pantone';
import {
  TINGKAT_BACA,
  URUTAN_KETERBACAAN,
  hitungKeterbacaan,
  nilaiKatalogDiKain,
  saringKeterbacaan,
  type BarisKeterbacaan,
  type UrutanKeterbacaan,
} from '@/lib/production-colors/sablon/keterbacaan-katalog';
import { HURUF_SABLON, type KeterbacaanSablon } from '@/lib/production-colors/sablon/saran';
import { cn } from '@/lib/utils';
import { WARNA_KELUARGA } from './KatalogPantone';

/** Satu halaman kisi — 3.219 ubin sekaligus membuat halaman tersendat. */
const PER_HALAMAN = 96;

const NADA_BACA: Record<KeterbacaanSablon, StatusTone> = {
  KUAT: 'settled',
  CUKUP: 'progress',
  LEMBUT: 'waiting',
  SAMAR: 'attention',
};

/**
 * Seluruh buku Pantone C sebagai tulisan "Aa" di atas kain, masing-masing
 * dengan angka kontrasnya — jadi orang melihat sendiri warna mana yang terbaca
 * kuat dan mana yang tidak, alih-alih menunggu saran ditebak. Memilih satu
 * warna memperlihatkan tulisannya dalam beberapa ukuran, dan bisa langsung
 * dipasang ke tinta mana pun yang tidak dikunci.
 */
export function KartuKeterbacaanPantone({
  kainHex,
  namaKain,
  katalogC,
  hexTinta,
  indeksKunci,
  onPakai,
}: {
  kainHex: string;
  namaKain: string;
  katalogC: readonly WarnaPantone[];
  /** Tinta palet, untuk tombol "pakai untuk tinta". */
  hexTinta: readonly string[];
  indeksKunci: readonly number[];
  onPakai: (indeks: number, hex: string, kode: string) => void;
}) {
  const t = useTranslations('productionPalette.readabilityBook');
  const tPalet = useTranslations('productionPalette');
  const tSablon = useTranslations('productionPrint');
  const locale = useLocale();
  const angka = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const [kueri, setKueri] = useState('');
  const [keluarga, setKeluarga] = useState<KeluargaWarna | null>(null);
  const [baca, setBaca] = useState<KeterbacaanSablon | null>(null);
  const [urut, setUrut] = useState<UrutanKeterbacaan>('KONTRAS');
  const [tanpaKhusus, setTanpaKhusus] = useState(false);
  const [kodePilihan, setKodePilihan] = useState<string | null>(null);

  const kueriTunda = useDeferredValue(kueri);
  const baris = useMemo(() => nilaiKatalogDiKain(katalogC, kainHex), [katalogC, kainHex]);
  // Jumlah per keterbacaan mengikuti saringan keluarga dan tinta khusus, supaya angkanya cocok dengan yang tampil.
  const hitung = useMemo(
    () => hitungKeterbacaan(saringKeterbacaan(baris, { kueri: '', keluarga, baca: null, sembunyikanKhusus: tanpaKhusus, urut: 'KODE' })),
    [baris, keluarga, tanpaKhusus],
  );
  const hasil = useMemo(
    () => saringKeterbacaan(baris, { kueri: kueriTunda, keluarga, baca, sembunyikanKhusus: tanpaKhusus, urut }),
    [baris, kueriTunda, keluarga, baca, tanpaKhusus, urut],
  );

  // Banyaknya ubin hanya berlaku untuk saringan yang sedang aktif.
  const kunciSaring = `${kueriTunda}|${keluarga ?? ''}|${baca ?? ''}|${tanpaKhusus}|${urut}`;
  const [halaman, setHalaman] = useState({ kunci: '', batas: PER_HALAMAN });
  const batas = halaman.kunci === kunciSaring ? halaman.batas : PER_HALAMAN;

  const terpilih: BarisKeterbacaan | null = baris.find((b) => b.warna.kode === kodePilihan) ?? hasil[0] ?? null;
  const total = hitung.KUAT + hitung.CUKUP + hitung.LEMBUT + hitung.SAMAR;

  return (
    <Card id="keterbacaan-pantone" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description', { fabric: namaKain })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full max-w-64 space-y-1">
              <Label htmlFor="cari-keterbacaan" className="text-xs">
                {t('searchLabel')}
              </Label>
              <Input
                id="cari-keterbacaan"
                type="search"
                value={kueri}
                onChange={(e) => setKueri(e.target.value)}
                placeholder={t('searchPlaceholder')}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="w-48 space-y-1">
              <Label htmlFor="urut-keterbacaan" className="text-xs">
                {t('sort')}
              </Label>
              <Select value={urut} onValueChange={(v) => setUrut(v as UrutanKeterbacaan)}>
                <SelectTrigger id="urut-keterbacaan" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {URUTAN_KETERBACAAN.map((u) => (
                    <SelectItem key={u} value={u}>
                      {t(`sorts.${u}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch id="tanpa-khusus" checked={tanpaKhusus} onCheckedChange={setTanpaKhusus} />
              <Label htmlFor="tanpa-khusus" className="text-xs">
                {t('hideSpecial')}
              </Label>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('readabilityLabel')}>
            {[null, ...TINGKAT_BACA].map((b) => {
              const aktif = baca === b;
              return (
                <Button
                  key={b ?? 'SEMUA'}
                  type="button"
                  size="xs"
                  variant={aktif ? 'default' : 'outline'}
                  aria-pressed={aktif}
                  title={b ? tPalet(`readabilityHints.${b}`) : undefined}
                  className="rounded-full px-2.5"
                  onClick={() => setBaca(b)}
                >
                  {b && <span aria-hidden className={cn('size-2.5 rounded-full ring-1 ring-inset', STATUS_TONE_CLASS[NADA_BACA[b]])} />}
                  {b ? tSablon(`readability.${b}`) : tPalet('familyAll')}
                  <span className={cn('tabular-nums', aktif ? 'opacity-80' : 'text-muted-foreground')}>{b ? hitung[b] : total}</span>
                </Button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-1.5" role="group" aria-label={tPalet('familyLabel')}>
            {[null, ...KELUARGA_WARNA].map((k) => {
              const aktif = keluarga === k;
              return (
                <Button
                  key={k ?? 'SEMUA'}
                  type="button"
                  size="xs"
                  variant={aktif ? 'secondary' : 'ghost'}
                  aria-pressed={aktif}
                  className="rounded-full px-2.5"
                  onClick={() => setKeluarga(k)}
                >
                  {k && <span aria-hidden className="size-2.5 rounded-full ring-1 ring-black/15" style={{ background: WARNA_KELUARGA[k] }} />}
                  {k ? tPalet(`families.${k}`) : tPalet('familyAll')}
                </Button>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground">{hasil.length === 0 ? t('empty') : tPalet('catalogCount', { count: hasil.length })}</p>

          {hasil.length > 0 && (
            <div className="max-h-[32rem] overflow-y-auto rounded-md border p-1">
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))] gap-1">
                {hasil.slice(0, batas).map((b) => {
                  const aktif = terpilih?.warna.kode === b.warna.kode;
                  const nilai = angka.format(tampilRasio(b.rasio));
                  return (
                    <li key={b.warna.kode}>
                      <button
                        type="button"
                        aria-pressed={aktif}
                        aria-label={t('tileLabel', { code: b.warna.kode, readability: tSablon(`readability.${b.baca}`), ratio: nilai })}
                        onClick={() => setKodePilihan(b.warna.kode)}
                        className={cn(
                          'flex w-full min-w-0 flex-col gap-1 rounded-md p-1 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50',
                          aktif && 'bg-muted',
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'flex h-12 items-center justify-center rounded text-xl font-semibold ring-inset',
                            aktif ? 'ring-2 ring-foreground' : 'ring-1 ring-black/10 dark:ring-white/10',
                          )}
                          style={{ background: kainHex, color: b.warna.hex }}
                        >
                          Aa
                        </span>
                        <span className="flex items-center gap-1 text-[10px] leading-tight">
                          <span aria-hidden className="size-2 shrink-0 rounded-full ring-1 ring-black/15" style={{ background: b.warna.hex }} />
                          <span className="min-w-0 flex-1 truncate tabular-nums">{b.warna.kode.replace(/ C$/, '')}</span>
                          <span className={cn('rounded px-1 font-medium tabular-nums ring-1 ring-inset', STATUS_TONE_CLASS[NADA_BACA[b.baca]])}>{nilai}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {hasil.length > batas && (
                <div className="p-2 text-center">
                  <Button type="button" variant="outline" size="sm" onClick={() => setHalaman({ kunci: kunciSaring, batas: batas + PER_HALAMAN })}>
                    {tPalet('showMore', { count: Math.min(PER_HALAMAN, hasil.length - batas) })}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          {terpilih ? (
            <div className="space-y-3 rounded-lg border p-3">
              <div
                className="space-y-3 rounded-md p-5 ring-1 ring-inset ring-black/10 dark:ring-white/10"
                style={{ background: kainHex, color: terpilih.warna.hex }}
              >
                <p className="text-7xl leading-none font-semibold">Aa</p>
                <p className="text-2xl leading-tight font-extrabold tracking-wide uppercase">{t('sampleHeadline')}</p>
                <p className="text-sm leading-snug">{t('sampleBody')}</p>
                <p className="text-[11px] leading-snug">{t('sampleSmall')}</p>
              </div>
              <div className="space-y-1.5">
                <p className="flex flex-wrap items-baseline gap-x-2 font-medium">
                  PANTONE {terpilih.warna.kode}
                  <span className="font-mono text-xs uppercase text-muted-foreground">{terpilih.warna.hex}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                      STATUS_TONE_CLASS[NADA_BACA[terpilih.baca]],
                    )}
                  >
                    {tSablon(`readability.${terpilih.baca}`)} · {angka.format(tampilRasio(terpilih.rasio))}
                  </span>
                  {terpilih.khusus && (
                    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', STATUS_TONE_CLASS.waiting)}>
                      {tSablon(`options.${terpilih.khusus}`)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{tPalet(`readabilityHints.${terpilih.baca}`)}</p>
              </div>
              {hexTinta.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">{t('useFor')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {hexTinta.map((hex, i) => {
                      const terkunci = indeksKunci.includes(i);
                      return (
                        <Button
                          key={i}
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={terkunci}
                          title={terkunci ? t('lockedInk', { letter: HURUF_SABLON[i] }) : t('useForInk', { letter: HURUF_SABLON[i] })}
                          aria-label={terkunci ? t('lockedInk', { letter: HURUF_SABLON[i] }) : t('useForInk', { letter: HURUF_SABLON[i] })}
                          onClick={() => onPakai(i, terpilih.warna.hex, terpilih.warna.kode)}
                        >
                          <span aria-hidden className="size-3 rounded-sm ring-1 ring-inset ring-black/15" style={{ background: hex }} />
                          {HURUF_SABLON[i]}
                          {terkunci && <Lock className="h-3 w-3" />}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('pickHint')}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

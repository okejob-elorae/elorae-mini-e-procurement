'use client';

import { useId, useState, useTransition } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { normalisasiHex } from '@/lib/production-colors/palet/warna';
import type { HasilWarnaLaris } from '@/lib/production-colors/sablon/warna-laris';

const SEMUA = '-';
const TAMPIL = 12;

/**
 * Warna produk yang laku di toko — dasar rekomendasi yang "sesuai selera
 * pembeli", bukan tebakan. Data datang dari impor pesanan marketplace; nama
 * warna yang tidak dikenal kamus dipetakan tim sekali di sini.
 */
export function KartuWarnaLaris({
  hasil,
  adaData,
  kategori,
  daftarKategori,
  onKategori,
  bolehMengelola,
  onJadikanKain,
  onPetakan,
}: {
  hasil: HasilWarnaLaris;
  adaData: boolean;
  kategori: string | null;
  daftarKategori: string[];
  onKategori: (k: string | null) => void;
  bolehMengelola: boolean;
  onJadikanKain: (hex: string, nama: string) => void;
  onPetakan: (nama: string, hex: string) => Promise<boolean>;
}) {
  const t = useTranslations('productionPalette.bestSellers');
  const locale = useLocale();
  const angka = new Intl.NumberFormat(locale);
  const persen = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const tampil = hasil.laris.slice(0, TAMPIL);
  const tertinggi = tampil[0]?.qty ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!adaData ? (
          <div className="flex flex-col gap-3 rounded-md border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href="/backoffice/forecast/import">{t('emptyLink')}</Link>
            </Button>
          </div>
        ) : (
          <>
            {daftarKategori.length > 0 && (
              <div className="w-full max-w-64 space-y-1">
                <Label htmlFor="kategori-laris" className="text-xs">
                  {t('category')}
                </Label>
                <Select value={kategori ?? SEMUA} onValueChange={(v) => onKategori(v === SEMUA ? null : v)}>
                  <SelectTrigger id="kategori-laris" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value={SEMUA}>{t('allCategories')}</SelectItem>
                    {daftarKategori.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {tampil.map((w) => (
                <li key={w.kunci} className="flex min-w-0 items-center gap-3 rounded-lg border p-2.5">
                  <span aria-hidden className="size-10 shrink-0 rounded-md ring-1 ring-inset ring-black/15" style={{ background: w.hex }} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <p className="truncate text-sm font-medium" title={w.namaAsli.join(', ')}>
                        {w.label}
                      </p>
                      <span className="text-xs tabular-nums text-muted-foreground">{t('sold', { count: angka.format(w.qty) })}</span>
                      {w.tren === null ? (
                        w.qty > 0 && <Badge variant="secondary">{t('trendNew')}</Badge>
                      ) : w.tren >= 0.05 ? (
                        <span className="inline-flex items-center gap-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                          <TrendingUp className="h-3 w-3" />
                          {t('trendUp', { percent: persen.format(w.tren * 100) })}
                        </span>
                      ) : w.tren <= -0.05 ? (
                        <span className="inline-flex items-center gap-0.5 text-xs text-amber-700 dark:text-amber-400">
                          <TrendingDown className="h-3 w-3" />
                          {t('trendDown', { percent: persen.format(-w.tren * 100) })}
                        </span>
                      ) : null}
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted" title={t('share', { percent: persen.format(w.bagian * 100) })}>
                      <div className="h-full rounded-full ring-1 ring-inset ring-foreground/25" style={{ width: `${tertinggi ? (w.qty / tertinggi) * 100 : 0}%`, background: w.hex }} />
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="xs" className="shrink-0" onClick={() => onJadikanKain(w.hex, w.label)}>
                    {t('asFabric')}
                  </Button>
                </li>
              ))}
            </ul>

            {hasil.tidakDikenal.length > 0 && (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">{t('unknownTitle', { count: hasil.tidakDikenal.length })}</summary>
                <p className="mt-1 text-xs text-muted-foreground">{t('unknownHint')}</p>
                <ul className="mt-3 space-y-2">
                  {hasil.tidakDikenal.slice(0, 20).map((x) => (
                    <BarisPetakan key={x.nama} nama={x.nama} qty={x.qty} boleh={bolehMengelola} onPetakan={onPetakan} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BarisPetakan({ nama, qty, boleh, onPetakan }: { nama: string; qty: number; boleh: boolean; onPetakan: (nama: string, hex: string) => Promise<boolean> }) {
  const t = useTranslations('productionPalette.bestSellers');
  const locale = useLocale();
  const id = useId();
  const [hex, setHex] = useState('#');
  const [pending, startTransition] = useTransition();
  const sah = normalisasiHex(hex);
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 truncate">
        {nama} <span className="text-xs text-muted-foreground">· {t('sold', { count: new Intl.NumberFormat(locale).format(qty) })}</span>
      </span>
      {boleh && (
        <>
          <Label htmlFor={id} className="sr-only">
            {t('mapLabel', { name: nama })}
          </Label>
          <span aria-hidden className="size-6 shrink-0 rounded ring-1 ring-inset ring-black/15" style={{ background: sah ?? 'transparent' }} />
          <Input id={id} value={hex} onChange={(e) => setHex(e.target.value)} className="h-8 w-28 font-mono text-xs" placeholder="#2B2F4A" />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!sah || pending}
            onClick={() => startTransition(async () => void (await onPetakan(nama, sah!)))}
          >
            {t('map')}
          </Button>
        </>
      )}
    </li>
  );
}

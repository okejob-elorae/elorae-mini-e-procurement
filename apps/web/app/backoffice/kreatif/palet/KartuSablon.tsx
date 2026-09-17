'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Copy, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AturanHarmoni } from '@/lib/creative/palet/harmoni';
import { rasioKontras } from '@/lib/creative/palet/kontras';
import { pantoneTerdekat, type WarnaPantone } from '@/lib/creative/palet/pantone';
import { bagiGram, resepCampur } from '@/lib/creative/sablon/campur';
import { susunRingkasan } from '@/lib/creative/sablon/ringkasan';
import { keterbacaanSablon, peranUntuk } from '@/lib/creative/sablon/saran';
import type { TintaDasar } from '@/lib/creative/sablon/tinta-dasar';
import { BarisSablon } from './BarisSablon';
import { PratinjauKaos } from './PratinjauKaos';

export const HURUF_SABLON = 'ABCDEF';

/**
 * Resep tiap warna sablon, dicari ulang hanya saat warna, tinta dasar, atau
 * batas tintanya benar-benar berubah. Masukannya teks, bukan larik: larik
 * dibuat ulang setiap render, dan satu resep bisa memakan beberapa milidetik —
 * mengetik berat adonan tidak boleh memicu enam pencarian ulang.
 */
function useResep(hexWarna: string, hexTinta: string, maksTinta: number) {
  return useMemo(() => {
    if (!hexWarna) return [];
    const tinta = hexTinta ? hexTinta.split(',') : [];
    return hexWarna.split(',').map((hex) => resepCampur(hex, tinta, maksTinta));
  }, [hexWarna, hexTinta, maksTinta]);
}

/**
 * Bagian sablon dari palet berkain: pratinjau di kaos, porsi, resep campur,
 * dan ringkasan untuk tukang sablon.
 */
export function KartuSablon({
  kainHex,
  namaKain,
  aturan,
  hex,
  porsi,
  saranUtuh,
  tintaDasar,
  maksTinta,
  onMaksTinta,
  beratTeks,
  onBeratTeks,
  katalogC,
  onPorsi,
  onGanti,
  onSarankanUlang,
  onSalin,
}: {
  kainHex: string;
  namaKain: string;
  aturan: AturanHarmoni;
  hex: string[];
  porsi: number[];
  saranUtuh: boolean;
  tintaDasar: readonly TintaDasar[];
  maksTinta: number;
  onMaksTinta: (n: number) => void;
  beratTeks: string;
  onBeratTeks: (teks: string) => void;
  katalogC: readonly WarnaPantone[];
  onPorsi: (indeks: number, nilai: number) => void;
  onGanti: (indeks: number, hex: string) => void;
  onSarankanUlang: () => void;
  onSalin: (teks: string) => void;
}) {
  const t = useTranslations('creative.sablon');
  const tPalet = useTranslations('creative.palette');
  const locale = useLocale();
  const desimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const persen = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  const berat = Math.max(0, Math.round(Number(beratTeks) || 0));
  const resep = useResep(hex.join(','), tintaDasar.map((x) => x.hex).join(','), maksTinta);
  const pantone = hex.map((h) => pantoneTerdekat(katalogC, h));
  const totalPorsi = porsi.reduce((s, x) => s + x, 0);

  function ringkasan(): string {
    return susunRingkasan({
      kepala: [
        t('summaryFabric', { fabric: `${namaKain} (${kainHex.toUpperCase()})` }),
        t('summaryRule', { rule: tPalet(`rules.${aturan}.name`), count: hex.length }),
      ],
      baris: hex.map((h, i) => {
        const r = resep[i];
        const p = pantone[i];
        const rasio = rasioKontras(h, kainHex);
        const gram = r ? bagiGram(berat, r.bagian.map((x) => x.persen)) : [];
        return {
          huruf: HURUF_SABLON[i],
          judul:
            p && p.deltaE < 0.05
              ? `PANTONE ${p.warna.kode} (${h.toUpperCase()})`
              : `${h.toUpperCase()}${p ? ` — ${t('nearestPantone', { code: p.warna.kode, de: desimal.format(p.deltaE) })}` : ''}`,
          rincian: t('summaryDetail', {
            role: t(`roles.${peranUntuk(i, hex.length)}`),
            portion: porsi[i],
            ratio: desimal.format(rasio),
            readability: t(`readability.${keterbacaanSablon(rasio)}`),
          }),
          resep: r
            ? t('summaryRecipe', {
                grams: berat,
                parts: r.bagian.map((x, j) => `${tintaDasar[x.indeks]?.nama ?? '?'} ${persen.format(x.persen)}% (${gram[j]} g)`).join(' + '),
                de: desimal.format(r.deltaE),
              })
            : t('summaryNoRecipe'),
        };
      }),
      catatan: t('summaryNote'),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('printTitle')}</CardTitle>
        <CardDescription>{t('printDescription')}</CardDescription>
        <CardAction>
          <Button type="button" variant="outline" size="sm" onClick={() => onSalin(ringkasan())}>
            <Copy className="h-3.5 w-3.5" />
            {t('copySummary')}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">{saranUtuh ? t('followingSuggestion') : t('editedHint')}</p>
          {!saranUtuh && (
            <Button type="button" variant="outline" size="sm" onClick={onSarankanUlang} className="shrink-0">
              <Sparkles className="h-3.5 w-3.5" />
              {t('resuggest')}
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <PratinjauKaos
            kainHex={kainHex}
            tinta={hex.map((h, i) => ({ huruf: HURUF_SABLON[i], hex: h, porsi: porsi[i] ?? 0 }))}
            label={t('previewLabel', { fabric: namaKain })}
          />
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">{t('previewNote')}</p>
            <ul className="space-y-1.5">
              {hex.map((h, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span aria-hidden className="size-3.5 rounded-sm ring-1 ring-inset ring-black/15" style={{ background: h }} />
                  <span className="font-medium">{HURUF_SABLON[i]}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{pantone[i]?.warna.kode ?? h.toUpperCase()}</span>
                  <span className="tabular-nums">{porsi[i]}%</span>
                </li>
              ))}
            </ul>
            <p className={totalPorsi === 100 ? 'border-t pt-2 text-muted-foreground' : 'border-t pt-2 font-medium text-amber-700 dark:text-amber-400'}>
              {totalPorsi === 100 ? t('portionTotal', { total: totalPorsi }) : t('portionWarn', { total: totalPorsi })}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="maks-tinta" className="text-xs">
                  {t('maxInksLabel')}
                </Label>
                <Select value={String(maksTinta)} onValueChange={(v) => onMaksTinta(Number(v))}>
                  <SelectTrigger id="maks-tinta" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {[1, 2, 3, 4].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {t('maxInksOption', { n })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="berat-adonan" className="text-xs">
                  {t('batchLabel')}
                </Label>
                <Input
                  id="berat-adonan"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={beratTeks}
                  onChange={(e) => onBeratTeks(e.target.value)}
                  className="tabular-nums"
                />
              </div>
            </div>
          </div>
        </div>

        <ul className="space-y-3">
          {hex.map((h, i) => (
            <BarisSablon
              key={i}
              huruf={HURUF_SABLON[i]}
              hex={h}
              pantone={pantone[i] ? { kode: pantone[i]!.warna.kode, deltaE: pantone[i]!.deltaE } : null}
              peran={peranUntuk(i, hex.length)}
              porsi={porsi[i] ?? 0}
              kainHex={kainHex}
              resep={resep[i] ?? null}
              tintaDasar={tintaDasar}
              berat={berat}
              katalogC={katalogC}
              onPorsi={(n) => onPorsi(i, n)}
              onGanti={(baru) => onGanti(i, baru)}
            />
          ))}
        </ul>

        <p className="text-xs text-muted-foreground">{t('recipeNote')}</p>
      </CardContent>
    </Card>
  );
}

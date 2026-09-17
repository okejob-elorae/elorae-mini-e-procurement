'use client';

import { useDeferredValue, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Copy, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { simpanTintaDasarAction } from '@/app/actions/creative';
import { rasioKontras } from '@/lib/creative/palet/kontras';
import dataPantoneC from '@/lib/creative/palet/pantone-c.json';
import { pantoneTerdekat, siapkanKatalog, type WarnaPantone } from '@/lib/creative/palet/pantone';
import { hexKeHsb } from '@/lib/creative/palet/warna';
import { bagiGram, resepCampur } from '@/lib/creative/sablon/campur';
import { susunRingkasan } from '@/lib/creative/sablon/ringkasan';
import {
  ATURAN_SABLON,
  JUMLAH_SABLON_MAKS,
  keterbacaanSablon,
  sarankanSablon,
  type AturanSablon,
} from '@/lib/creative/sablon/saran';
import type { TintaDasar } from '@/lib/creative/sablon/tinta-dasar';
import { salinTeks } from '@/lib/ui/salin-teks';
import { EditorWarna, type ModeMasukan } from '../palet/EditorWarna';
import { IkonHarmoni } from '../palet/IkonHarmoni';
import { BarisSablon } from './BarisSablon';
import { KartuTintaDasar } from './KartuTintaDasar';
import { PratinjauKaos } from './PratinjauKaos';

const HURUF = 'ABCDEF';
/** Contoh awal dari permintaan tim sendiri — kain Blue Surf. Dipakai kalau kodenya ada di tabel TCX. */
const KAIN_AWAL = '16-5106';
const KAIN_CADANGAN = '#90a8a4';

let katalogCSiap: WarnaPantone[] | null = null;
function katalogC(): WarnaPantone[] {
  katalogCSiap ??= siapkanKatalog('C', dataPantoneC as [string, string][]);
  return katalogCSiap;
}

type Ubahan = { kunci: string; ganti: Record<number, string>; porsi: number[] | null };

/**
 * Resep untuk tiap warna sablon, dicari ulang hanya saat warna, tinta dasar,
 * atau batas tintanya benar-benar berubah. Masukannya teks, bukan larik:
 * larik baris dibuat ulang setiap render, dan satu resep bisa memakan
 * beberapa milidetik — mengetik berat adonan tidak boleh memicu enam
 * pencarian ulang.
 */
function useResep(hexWarna: string, hexTinta: string, maksTinta: number) {
  return useMemo(() => {
    if (!hexWarna) return [];
    const tinta = hexTinta ? hexTinta.split(',') : [];
    return hexWarna.split(',').map((hex) => resepCampur(hex, tinta, maksTinta));
  }, [hexWarna, hexTinta, maksTinta]);
}

export function SablonClient({
  tcx,
  tintaDasar,
  bolehMengelola,
}: {
  tcx: [string, string, string][];
  tintaDasar: TintaDasar[];
  bolehMengelola: boolean;
}) {
  const t = useTranslations('creative.sablon');
  const tPalet = useTranslations('creative.palette');
  const locale = useLocale();
  const router = useRouter();
  const [menyimpan, startTransition] = useTransition();
  const desimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const persen = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  const katalogTcx = useMemo(() => siapkanKatalog('TCX', tcx), [tcx]);
  const [kainHex, setKainHex] = useState(() => tcx.find(([kode]) => kode === KAIN_AWAL)?.[1].toLowerCase() ?? KAIN_CADANGAN);
  const [modeKain, setModeKain] = useState<ModeMasukan>('PANTONE_TCX');
  const [jumlah, setJumlah] = useState(3);
  const [aturan, setAturan] = useState<AturanSablon>('COMPLEMENTARY');
  const [maksTinta, setMaksTinta] = useState(3);
  const [beratTeks, setBeratTeks] = useState('1000');
  const berat = Math.max(0, Math.round(Number(beratTeks) || 0));

  const [tinta, setTinta] = useState<TintaDasar[]>(tintaDasar);
  const [tintaTersimpan, setTintaTersimpan] = useState<TintaDasar[]>(tintaDasar);
  const tintaBerubah = JSON.stringify(tinta) !== JSON.stringify(tintaTersimpan);

  // Saran dan resep dihitung dari nilai yang ditunda: mengetik kode kain atau
  // menggeser jumlah tidak boleh menunggu enam resep selesai dicari.
  const kainTunda = useDeferredValue(kainHex);
  const tintaTunda = useDeferredValue(tinta);

  const saran = useMemo(
    () => sarankanSablon({ kainHex: kainTunda, jumlah, aturan, katalog: katalogC() }),
    [kainTunda, jumlah, aturan],
  );

  /*
   * Penggantian warna dan porsi hanya berlaku untuk saran yang sedang tampil.
   * Begitu kain, jumlah, atau aturan berubah, sarannya lain — dan "ganti
   * warna B" untuk saran lama tidak berarti apa-apa lagi.
   */
  const kunciSaran = `${kainTunda}|${jumlah}|${aturan}`;
  const [ubahanMentah, setUbahan] = useState<Ubahan>({ kunci: '', ganti: {}, porsi: null });
  const ubahan: Ubahan = ubahanMentah.kunci === kunciSaran ? ubahanMentah : { kunci: kunciSaran, ganti: {}, porsi: null };

  const baris = saran.map((s, i) => {
    const kode = ubahan.ganti[i];
    const warna = (kode && katalogC().find((w) => w.kode === kode)) || s.warna;
    return { huruf: HURUF[i], warna, peran: s.peran, porsi: ubahan.porsi?.[i] ?? s.porsi, diganti: Boolean(kode) };
  });

  const resep = useResep(
    baris.map((b) => b.warna.hex).join(','),
    tintaTunda.map((x) => x.hex).join(','),
    maksTinta,
  );

  const totalPorsi = baris.reduce((s, b) => s + b.porsi, 0);
  const kainTerdekat = pantoneTerdekat(katalogTcx, kainHex);
  const namaKain =
    kainTerdekat && kainTerdekat.deltaE < 0.05
      ? `PANTONE ${kainTerdekat.warna.kode} TCX ${kainTerdekat.warna.nama ?? ''}`.trim()
      : kainHex.toUpperCase();

  function ubahPorsi(indeks: number, nilai: number) {
    const porsi = baris.map((b, i) => (i === indeks ? nilai : b.porsi));
    setUbahan({ ...ubahan, porsi });
  }

  async function salinRingkasan() {
    const teks = susunRingkasan({
      kepala: [
        t('summaryFabric', { fabric: `${namaKain} (${kainHex.toUpperCase()})` }),
        t('summaryRule', { rule: tPalet(`rules.${aturan}.name`), count: baris.length }),
      ],
      baris: baris.map((b, i) => {
        const r = resep[i];
        const rasio = rasioKontras(b.warna.hex, kainHex);
        const gram = r ? bagiGram(berat, r.bagian.map((x) => x.persen)) : [];
        return {
          huruf: b.huruf,
          judul: `PANTONE ${b.warna.kode} (${b.warna.hex.toUpperCase()})`,
          rincian: t('summaryDetail', {
            role: t(`roles.${b.peran}`),
            portion: b.porsi,
            ratio: desimal.format(rasio),
            readability: t(`readability.${keterbacaanSablon(rasio)}`),
          }),
          resep: r
            ? t('summaryRecipe', {
                grams: berat,
                parts: r.bagian.map((x, j) => `${tintaTunda[x.indeks]?.nama ?? '?'} ${persen.format(x.persen)}% (${gram[j]} g)`).join(' + '),
                de: desimal.format(r.deltaE),
              })
            : t('summaryNoRecipe'),
        };
      }),
      catatan: t('summaryNote'),
    });
    if (await salinTeks(teks)) toast.success(t('copied'));
    else toast.error(t('copyFailed'));
  }

  function simpanTinta() {
    startTransition(async () => {
      const h = await simpanTintaDasarAction(tinta);
      if (h.ok) {
        setTinta(h.tinta);
        setTintaTersimpan(h.tinta);
        toast.success(t('inksSaved'));
        router.refresh();
      } else {
        toast.error(t(`errors.${h.kode}`));
      }
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button variant="outline" onClick={salinRingkasan}>
            <Copy className="mr-1.5 h-4 w-4" />
            {t('copySummary')}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('fabricTitle')}</CardTitle>
              <CardDescription className="truncate">{namaKain}</CardDescription>
            </CardHeader>
            <CardContent>
              <EditorWarna
                label={t('fabricLabel')}
                hex={kainHex}
                hsb={hexKeHsb(kainHex)}
                mode={modeKain}
                onMode={setModeKain}
                onGantiHex={setKainHex}
                onSalin={(teks) => salinTeks(teks).then((ok) => (ok ? toast.success(tPalet('copied', { hex: teks })) : toast.error(t('copyFailed'))))}
                katalogC={katalogC()}
                katalogTcx={katalogTcx}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('setupTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label id="label-jumlah-sablon">{t('countLabel')}</Label>
                <div className="flex items-center gap-3" role="group" aria-labelledby="label-jumlah-sablon">
                  <Button type="button" variant="outline" size="icon-sm" onClick={() => setJumlah((n) => Math.max(1, n - 1))} disabled={jumlah <= 1} aria-label={t('fewer')}>
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="w-6 text-center text-lg font-semibold tabular-nums" aria-live="polite">
                    {jumlah}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={() => setJumlah((n) => Math.min(JUMLAH_SABLON_MAKS, n + 1))}
                    disabled={jumlah >= JUMLAH_SABLON_MAKS}
                    aria-label={t('more')}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <span className="font-mono text-sm tracking-widest text-muted-foreground">{HURUF.slice(0, jumlah).split('').join(' ')}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="aturan-sablon">{t('ruleLabel')}</Label>
                <Select value={aturan} onValueChange={(v) => setAturan(v as AturanSablon)}>
                  <SelectTrigger id="aturan-sablon" className="h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {ATURAN_SABLON.map((a) => (
                      <SelectItem key={a} value={a} className="py-2">
                        <IkonHarmoni aturan={a} className="size-5" />
                        {tPalet(`rules.${a}.name`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{tPalet(`rules.${aturan}.hint`)}</p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="maks-tinta">{t('maxInksLabel')}</Label>
                  <Select value={String(maksTinta)} onValueChange={(v) => setMaksTinta(Number(v))}>
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
                <div className="space-y-2">
                  <Label htmlFor="berat-adonan">{t('batchLabel')}</Label>
                  <Input
                    id="berat-adonan"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={beratTeks}
                    onChange={(e) => setBeratTeks(e.target.value)}
                    className="tabular-nums"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('printTitle')}</CardTitle>
              <CardDescription>{t('printDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                <PratinjauKaos
                  kainHex={kainHex}
                  tinta={baris.map((b) => ({ huruf: b.huruf, hex: b.warna.hex, porsi: b.porsi }))}
                  label={t('previewLabel', { fabric: namaKain })}
                />
                <div className="space-y-2 text-sm">
                  <p className="text-xs text-muted-foreground">{t('previewNote')}</p>
                  <ul className="space-y-1.5">
                    {baris.map((b) => (
                      <li key={b.huruf} className="flex items-center gap-2">
                        <span aria-hidden className="size-3.5 rounded-sm ring-1 ring-inset ring-black/15" style={{ background: b.warna.hex }} />
                        <span className="font-medium">{b.huruf}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{b.warna.kode}</span>
                        <span className="tabular-nums">{b.porsi}%</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                    <span className={totalPorsi === 100 ? 'text-muted-foreground' : 'font-medium text-amber-700 dark:text-amber-400'}>
                      {totalPorsi === 100 ? t('portionTotal', { total: totalPorsi }) : t('portionWarn', { total: totalPorsi })}
                    </span>
                    {ubahan.porsi && (
                      <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setUbahan({ ...ubahan, porsi: null })}>
                        {t('resetPortions')}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <ul className="space-y-3">
                {baris.map((b, i) => (
                  <BarisSablon
                    key={b.huruf}
                    huruf={b.huruf}
                    warna={b.warna}
                    peran={b.peran}
                    porsi={b.porsi}
                    kainHex={kainHex}
                    diganti={b.diganti}
                    resep={resep[i] ?? null}
                    tintaDasar={tintaTunda}
                    berat={berat}
                    katalogC={katalogC()}
                    onPorsi={(n) => ubahPorsi(i, n)}
                    onGanti={(kode) => setUbahan({ ...ubahan, ganti: { ...ubahan.ganti, [i]: kode } })}
                    onKembalikan={() => {
                      const ganti = { ...ubahan.ganti };
                      delete ganti[i];
                      setUbahan({ ...ubahan, ganti });
                    }}
                  />
                ))}
              </ul>

              <p className="text-xs text-muted-foreground">{t('recipeNote')}</p>
            </CardContent>
          </Card>

          <KartuTintaDasar
            tinta={tinta}
            berubah={tintaBerubah}
            bolehMenyimpan={bolehMengelola}
            menyimpan={menyimpan}
            katalogC={katalogC()}
            onUbah={setTinta}
            onSimpan={simpanTinta}
            onGalat={(pesan) => toast.error(pesan)}
          />
        </div>
      </div>
    </div>
  );
}

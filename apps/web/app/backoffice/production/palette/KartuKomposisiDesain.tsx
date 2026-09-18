'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { svgKaos } from '@/lib/production-colors/palet/kaos-svg';
import { deltaE2000, hexKeLab, pantoneTerdekat, type WarnaPantone } from '@/lib/production-colors/palet/pantone';
import { bacaKomposisiDesain, variasiDesain, type Komposisi } from '@/lib/production-colors/sablon/komposisi';
import { HURUF_SABLON } from '@/lib/production-colors/sablon/saran';

type Pilihan = { hex: string; label: string };
type Variasi = { id: string; judul: string; kainHex: string; kainLabel: string; komposisi: Komposisi };

const MAKS_KAIN = 8;
const MAKS_AKSEN = 6;

/** Nama TCX kain kalau warnanya dekat satu warna katalog, selain itu hex-nya. */
function namaKainDari(katalogTcx: readonly WarnaPantone[], hex: string): string {
  const tcx = pantoneTerdekat(katalogTcx, hex);
  return tcx && tcx.deltaE < 3 ? `${tcx.warna.kode} ${tcx.warna.nama ?? ''}`.trim() : hex.toUpperCase();
}

/**
 * Desain yang diunggah, dibaca komposisinya — kain dan tinta beserta peran dan
 * porsinya — lalu diberi pengganti warna: desain yang sama di kain lain, dan
 * aksen lain di kain aslinya. Semua dihitung di peramban dari warna dominan
 * gambar; tidak ada yang dikirim ke server.
 */
export function KartuKomposisiDesain({
  warnaGambar,
  katalogC,
  katalogTcx,
  kainKandidat,
  kainDariPenjualan,
  aksenKandidat,
  onPakai,
}: {
  warnaGambar: readonly { hex: string; bagian: number }[];
  katalogC: readonly WarnaPantone[];
  katalogTcx: readonly WarnaPantone[];
  kainKandidat: readonly Pilihan[];
  /** Kandidat kain berasal dari penjualan toko (bukan daftar umum). */
  kainDariPenjualan: boolean;
  aksenKandidat: readonly Pilihan[];
  onPakai: (kainHex: string, k: Komposisi, kainLabel: string) => void;
}) {
  const t = useTranslations('productionPalette.design');
  const tPeran = useTranslations('productionPalette.recommend.roles');
  const analisis = useMemo(() => bacaKomposisiDesain(warnaGambar), [warnaGambar]);

  const { asli, diKainLain, aksenLain } = useMemo(() => {
    if (!analisis) return { asli: null, diKainLain: [] as Variasi[], aksenLain: [] as Variasi[] };
    const kainAsli = analisis.kain.hex;
    const labAsli = hexKeLab(kainAsli);
    const buat = (kainHex: string, kainLabel: string, judul: string, aksenBaru?: string): Variasi | null => {
      const k = variasiDesain({ analisis, kainHex, katalog: katalogC, aksenBaru });
      return k ? { id: k.id, judul, kainHex, kainLabel, komposisi: k } : null;
    };
    const asli = buat(kainAsli, namaKainDari(katalogTcx, kainAsli), t('original'));
    const diKainLain = kainKandidat
      .filter((k) => deltaE2000(hexKeLab(k.hex), labAsli) >= 10)
      .slice(0, MAKS_KAIN)
      .flatMap((k) => buat(k.hex, k.label, k.label) ?? []);
    const aksenAsli = analisis.tinta.find((x) => x.peran === 'AKSEN');
    const aksenLain = aksenAsli
      ? aksenKandidat
          .filter((a) => deltaE2000(hexKeLab(a.hex), hexKeLab(aksenAsli.hex)) >= 15)
          .slice(0, MAKS_AKSEN)
          .flatMap((a) => buat(kainAsli, namaKainDari(katalogTcx, kainAsli), t('accentTitle', { name: a.label }), a.hex) ?? [])
      : [];
    return { asli, diKainLain, aksenLain };
  }, [analisis, katalogC, katalogTcx, kainKandidat, aksenKandidat, t]);

  if (!analisis) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('unreadable')}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const kodeC = (hex: string) => {
    const c = pantoneTerdekat(katalogC, hex);
    return c ? c.warna.kode : hex.toUpperCase();
  };

  return (
    <Card id="komposisi-desain" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col gap-4 rounded-lg border p-3 md:flex-row md:items-start">
          <div className="flex items-center gap-3 md:w-64 md:shrink-0">
            <span aria-hidden className="size-12 shrink-0 rounded-md ring-1 ring-inset ring-black/15" style={{ background: analisis.kain.hex }} />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{t('fabric')}</p>
              <p className="truncate text-sm font-medium">{namaKainDari(katalogTcx, analisis.kain.hex)}</p>
              <p className="text-xs text-muted-foreground">{t('share', { percent: Math.round(analisis.kain.bagian * 100) })}</p>
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-xs text-muted-foreground">{t('inks', { count: analisis.tinta.length })}</p>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {analisis.tinta.map((x, i) => (
                <li key={x.hex} className="flex items-center gap-2 text-sm">
                  <span aria-hidden className="size-5 shrink-0 rounded ring-1 ring-inset ring-black/15" style={{ background: x.hex }} />
                  <span className="w-3 font-medium">{HURUF_SABLON[i]}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {kodeC(x.hex)} <span className="text-muted-foreground">· {tPeran(x.peran)}</span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">{x.porsi}%</span>
                </li>
              ))}
            </ul>
          </div>
          {asli && (
            <Button type="button" className="md:self-center" onClick={() => onPakai(asli.kainHex, asli.komposisi, asli.kainLabel)}>
              {t('useOriginal')}
            </Button>
          )}
        </div>

        {diKainLain.length > 0 && (
          <section className="space-y-2">
            <div>
              <h3 className="text-sm font-medium">{t('otherFabrics')}</h3>
              <p className="text-xs text-muted-foreground">{kainDariPenjualan ? t('otherFabricsLaris') : t('otherFabricsUmum')}</p>
            </div>
            <DeretVariasi daftar={diKainLain} awalanId="desain-kain" onPakai={onPakai} />
          </section>
        )}

        {aksenLain.length > 0 && (
          <section className="space-y-2">
            <div>
              <h3 className="text-sm font-medium">{t('otherAccents')}</h3>
              <p className="text-xs text-muted-foreground">{t('otherAccentsHint')}</p>
            </div>
            <DeretVariasi daftar={aksenLain} awalanId="desain-aksen" onPakai={onPakai} />
          </section>
        )}
      </CardContent>
    </Card>
  );
}

function DeretVariasi({
  daftar,
  awalanId,
  onPakai,
}: {
  daftar: readonly Variasi[];
  awalanId: string;
  onPakai: (kainHex: string, k: Komposisi, kainLabel: string) => void;
}) {
  const t = useTranslations('productionPalette.design');
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-8">
      {daftar.map((v, i) => (
        <li key={v.id} className="flex min-w-0 flex-col gap-2 rounded-lg border p-2.5">
          <p className="truncate text-sm font-medium" title={v.judul}>
            {v.judul}
          </p>
          <div
            className="mx-auto w-full max-w-28"
            // Teks SVG dari fungsi murni yang meloloskan label dan hanya menerima hex sah.
            dangerouslySetInnerHTML={{
              __html: svgKaos({
                kainHex: v.kainHex,
                tinta: v.komposisi.tinta.map((x, j) => ({ huruf: HURUF_SABLON[j], hex: x.hex, porsi: x.porsi })),
                id: `${awalanId}-${i}`,
                label: t('previewLabel', { fabric: v.kainLabel }),
                kelas: 'block h-auto w-full',
              }),
            }}
          />
          <div className="flex gap-1">
            {v.komposisi.tinta.map((x) => (
              <span
                key={x.hex}
                aria-hidden
                title={`${x.kode ?? x.hex.toUpperCase()} · ${x.porsi}%`}
                className="h-3 flex-1 rounded-sm ring-1 ring-inset ring-black/15"
                style={{ background: x.hex }}
              />
            ))}
          </div>
          <Button type="button" size="sm" variant="outline" className="mt-auto" onClick={() => onPakai(v.kainHex, v.komposisi, v.kainLabel)}>
            {t('use')}
          </Button>
        </li>
      ))}
    </ul>
  );
}

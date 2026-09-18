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

const MAKS_AKSEN = 6;

/** Nama TCX kain kalau warnanya dekat satu warna katalog, selain itu hex-nya. */
function namaKainDari(katalogTcx: readonly WarnaPantone[], hex: string): string {
  const tcx = pantoneTerdekat(katalogTcx, hex);
  return tcx && tcx.deltaE < 3 ? `${tcx.warna.kode} ${tcx.warna.nama ?? ''}`.trim() : hex.toUpperCase();
}

/**
 * Desain yang diunggah, dibaca komposisinya — kain dan tinta beserta peran dan
 * porsinya — lalu diberi aksen pengganti. Semua dihitung di peramban dari warna
 * dominan gambar; tidak ada yang dikirim ke server.
 *
 * Kainnya patokan: selama kain palet dikunci, desain disesuaikan ke kain itu —
 * tintanya dijaga tetap terbaca — alih-alih memasang kain dari gambar. Tanpa
 * kunci, kain gambar yang dipakai.
 */
export function KartuKomposisiDesain({
  warnaGambar,
  katalogC,
  katalogTcx,
  kainTerkunci,
  aksenKandidat,
  onPakai,
}: {
  warnaGambar: readonly { hex: string; bagian: number }[];
  katalogC: readonly WarnaPantone[];
  katalogTcx: readonly WarnaPantone[];
  /** Kain palet yang dikunci — desain disesuaikan ke kain ini. */
  kainTerkunci: Pilihan | null;
  aksenKandidat: readonly Pilihan[];
  onPakai: (kainHex: string, k: Komposisi, kainLabel: string) => void;
}) {
  const t = useTranslations('productionPalette.design');
  const tPeran = useTranslations('productionPalette.recommend.roles');
  const analisis = useMemo(() => bacaKomposisiDesain(warnaGambar), [warnaGambar]);

  const { acuan, asli, aksenLain } = useMemo(() => {
    if (!analisis) return { acuan: null, asli: null, aksenLain: [] as Variasi[] };
    const acuan = kainTerkunci ?? { hex: analisis.kain.hex, label: namaKainDari(katalogTcx, analisis.kain.hex) };
    const buat = (judul: string, aksenBaru?: string): Variasi | null => {
      const k = variasiDesain({ analisis, kainHex: acuan.hex, katalog: katalogC, aksenBaru });
      return k ? { id: k.id, judul, kainHex: acuan.hex, kainLabel: acuan.label, komposisi: k } : null;
    };
    const asli = buat(t('original'));
    const aksenAsli = analisis.tinta.find((x) => x.peran === 'AKSEN');
    const aksenLain = aksenAsli
      ? aksenKandidat
          .filter((a) => deltaE2000(hexKeLab(a.hex), hexKeLab(aksenAsli.hex)) >= 15)
          .slice(0, MAKS_AKSEN)
          .flatMap((a) => buat(t('accentTitle', { name: a.label }), a.hex) ?? [])
      : [];
    return { acuan, asli, aksenLain };
  }, [analisis, katalogC, katalogTcx, kainTerkunci, aksenKandidat, t]);
  // Kain gambar dan kain terkunci yang praktis sama tidak perlu disebut "disesuaikan".
  const disesuaikan =
    analisis !== null && kainTerkunci !== null && deltaE2000(hexKeLab(kainTerkunci.hex), hexKeLab(analisis.kain.hex)) >= 3;

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
              {kainTerkunci ? t('useOnFabric', { fabric: kainTerkunci.label }) : t('useOriginal')}
            </Button>
          )}
        </div>

        {disesuaikan && asli && acuan && (
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <p className="text-xs text-muted-foreground">{t('adapted', { fabric: acuan.label })}</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {asli.komposisi.tinta.map((x, i) => (
                <li key={x.hex} className="flex items-center gap-1.5 text-sm">
                  <span aria-hidden className="size-4 shrink-0 rounded ring-1 ring-inset ring-black/15" style={{ background: x.hex }} />
                  <span className="font-medium">{HURUF_SABLON[i]}</span>
                  {x.kode ?? x.hex.toUpperCase()}
                  <span className="tabular-nums text-muted-foreground">{x.porsi}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {aksenLain.length > 0 && (
          <section className="space-y-2">
            <div>
              <h3 className="text-sm font-medium">{t('otherAccents')}</h3>
              <p className="text-xs text-muted-foreground">{t('otherAccentsHint', { fabric: acuan?.label ?? '' })}</p>
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

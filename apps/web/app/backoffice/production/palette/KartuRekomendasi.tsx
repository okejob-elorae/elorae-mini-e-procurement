'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock, Shuffle, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { svgKaos } from '@/lib/production-colors/palet/kaos-svg';
import { pantoneTerdekat, type WarnaPantone } from '@/lib/production-colors/palet/pantone';
import { galeriKomposisi, type GayaKomposisi, type Komposisi } from '@/lib/production-colors/sablon/komposisi';
import { KAMUS_WARNA } from '@/lib/production-colors/sablon/nama-warna';
import type { WarnaLaris } from '@/lib/production-colors/sablon/warna-laris';
import { HURUF_SABLON, JUMLAH_SABLON_MAKS } from '@/lib/production-colors/sablon/saran';
import { cn } from '@/lib/utils';

const TANPA_KUNCI = '-';

/** Dari mana warna aksen diambil: warna laris toko, preset tren lokal, atau daftar sablon bawaan. */
type SumberWarna = 'LARIS' | 'EARTH' | 'PASTEL' | 'CERAH' | 'BAWAAN';
const SUMBER: readonly SumberWarna[] = ['LARIS', 'EARTH', 'PASTEL', 'CERAH', 'BAWAAN'];

/**
 * Galeri komposisi siap pakai untuk kain yang dipilih — jawaban untuk "warna
 * apa yang cocok", tanpa harus menyetel tinta satu per satu. Setiap komposisi
 * memakai jumlah tinta yang sama dengan palet; galeri dihitung ulang hanya saat
 * kain, jumlah tinta, atau warna yang dikunci berubah.
 */
export function KartuRekomendasi({
  kainHex,
  namaKain,
  katalogC,
  hexTinta,
  kunci,
  onKunci,
  dariGambar,
  onBuangDariGambar,
  onJumlah,
  onPakai,
  warnaLaris,
}: {
  kainHex: string;
  namaKain: string;
  katalogC: readonly WarnaPantone[];
  /** Tinta yang sedang dipakai — calon warna yang bisa dikunci. */
  hexTinta: string[];
  kunci: string | null;
  onKunci: (hex: string | null) => void;
  dariGambar: Komposisi | null;
  onBuangDariGambar: () => void;
  /** Mengubah jumlah tinta palet — rekomendasi mengikuti. */
  onJumlah: (n: number) => void;
  onPakai: (k: Komposisi, judul: string) => void;
  /** Warna produk yang laku di toko, terlaris dulu. */
  warnaLaris: readonly WarnaLaris[];
}) {
  const t = useTranslations('productionPalette.recommend');
  const jumlah = hexTinta.length;
  const [gaya, setGaya] = useState<GayaKomposisi | 'SEMUA'>('SEMUA');
  const adaLaris = warnaLaris.length >= 3;
  // Tanpa data penjualan, titik mulainya tren lokal — bukan tujuh warna sablon generik.
  const [sumber, setSumber] = useState<SumberWarna>(adaLaris ? 'LARIS' : 'EARTH');
  const [acak, setAcak] = useState(0);
  const aksen = useMemo(
    () =>
      sumber === 'LARIS'
        ? warnaLaris.slice(0, 12).map((w) => w.hex)
        : sumber === 'BAWAAN'
          ? undefined
          : KAMUS_WARNA.filter((w) => w.keluarga === sumber).map((w) => w.hex),
    [sumber, warnaLaris],
  );
  const galeri = useMemo(
    () => galeriKomposisi({ kainHex, katalog: katalogC, kunciHex: kunci, jumlah, gaya, aksen, acak }),
    [kainHex, katalogC, kunci, jumlah, gaya, aksen, acak],
  );
  const daftar = dariGambar ? [dariGambar, ...galeri] : galeri;

  /** Judul dari peran tintanya: empat tinta klasik berbunyi "Netral + Aksen + Tone-on-tone + Aksen 2". */
  const judul = (k: Komposisi) => {
    if (k.pola === 'DARI_GAMBAR') return t('patterns.DARI_GAMBAR');
    if (k.pola === 'TONAL') return t('patterns.TONAL', { count: k.tinta.length });
    if (k.pola === 'SATU') return t('patterns.SATU', { role: t(`roles.${k.tinta[0].peran}`) });
    return [...new Set(k.tinta.map((x) => x.peran))].map((p) => t(`roles.${p}`)).join(' + ');
  };

  const kodeUntuk = (hex: string) => {
    const p = pantoneTerdekat(katalogC, hex);
    return p && p.deltaE < 0.05 ? p.warna.kode : hex.toUpperCase();
  };
  const pilihanKunci = hexTinta.map((hex, i) => ({ hex, label: t('lockInk', { letter: HURUF_SABLON[i], code: kodeUntuk(hex) }) }));
  if (kunci && !hexTinta.includes(kunci)) pilihanKunci.push({ hex: kunci, label: t('lockKept', { code: kodeUntuk(kunci) }) });

  return (
    <Card id="rekomendasi" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description', { fabric: namaKain })}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Di badan kartu, bukan di kepala: di HP kontrol ini menjepit judul dan deskripsi. */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-60 space-y-1">
            <Label htmlFor="sumber-rekomendasi" className="text-xs">
              {t('source')}
            </Label>
            <Select value={sumber} onValueChange={(v) => setSumber(v as SumberWarna)}>
              <SelectTrigger id="sumber-rekomendasi" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {SUMBER.map((s) => (
                  <SelectItem key={s} value={s} disabled={s === 'LARIS' && !adaLaris}>
                    {t(`sources.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-32 space-y-1">
            <Label htmlFor="jumlah-tinta-rekomendasi" className="text-xs">
              {t('count')}
            </Label>
            <Select value={String(jumlah)} onValueChange={(v) => onJumlah(Number(v))}>
              <SelectTrigger id="jumlah-tinta-rekomendasi" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {Array.from({ length: JUMLAH_SABLON_MAKS }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {t('countOption', { count: n })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-36 space-y-1">
            <Label htmlFor="gaya-rekomendasi" className="text-xs">
              {t('style')}
            </Label>
            <Select value={gaya} onValueChange={(v) => setGaya(v as GayaKomposisi | 'SEMUA')}>
              <SelectTrigger id="gaya-rekomendasi" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="SEMUA">{t('styleAll')}</SelectItem>
                <SelectItem value="CERAH">{t('styles.CERAH')}</SelectItem>
                <SelectItem value="REDAM">{t('styles.REDAM')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="max-w-64 min-w-52 flex-1 space-y-1">
            <Label htmlFor="kunci-warna" className="text-xs">
              <Lock className="h-3 w-3" />
              {t('lockLabel')}
            </Label>
            <Select value={kunci ?? TANPA_KUNCI} onValueChange={(v) => onKunci(v === TANPA_KUNCI ? null : v)}>
              <SelectTrigger id="kunci-warna" className="w-full" title={t('lockHint')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value={TANPA_KUNCI}>{t('lockNone')}</SelectItem>
                {pilihanKunci.map((p) => (
                  <SelectItem key={p.hex} value={p.hex}>
                    <span aria-hidden className="size-3 rounded-sm ring-1 ring-inset ring-black/15" style={{ background: p.hex }} />
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" onClick={() => setAcak((a) => a + 1)}>
            <Shuffle className="h-4 w-4" />
            {t('shuffle')}
          </Button>
        </div>
        <p className="mt-2 mb-4 text-xs text-muted-foreground">
          {t(`sourceHints.${sumber === 'LARIS' ? 'LARIS' : sumber === 'BAWAAN' ? 'BAWAAN' : 'TREN'}`)}
        </p>
        {daftar.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {daftar.map((k, i) => {
              const nama = judul(k);
              const gambar = k.pola === 'DARI_GAMBAR';
              return (
                <li key={k.id} className={cn('flex min-w-0 flex-col gap-3 rounded-lg border p-3', gambar && 'border-primary ring-1 ring-primary')}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm leading-tight font-medium">{nama}</p>
                    {k.gaya && (
                      <Badge variant="outline" className="shrink-0">
                        {t(`styles.${k.gaya}`)}
                      </Badge>
                    )}
                    {gambar && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Badge variant="secondary">{t('fromImage')}</Badge>
                        <Button type="button" variant="ghost" size="icon-xs" aria-label={t('dismiss')} onClick={onBuangDariGambar}>
                          <X />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div
                    className="mx-auto w-full max-w-36"
                    // Teks SVG dari fungsi murni yang meloloskan label dan hanya menerima hex sah.
                    dangerouslySetInnerHTML={{
                      __html: svgKaos({
                        kainHex,
                        tinta: k.tinta.map((x, j) => ({ huruf: HURUF_SABLON[j], hex: x.hex, porsi: x.porsi })),
                        id: `rekomendasi-${i}`,
                        label: t('previewLabel', { name: nama, fabric: namaKain }),
                        kelas: 'block h-auto w-full',
                      }),
                    }}
                  />
                  {gambar && k.tinta.length < jumlah && (
                    <p className="text-xs text-muted-foreground">{t('fewerInImage', { count: k.tinta.length })}</p>
                  )}
                  <ul className="space-y-1 text-xs">
                    {k.tinta.map((x, j) => (
                      <li key={`${x.hex}-${j}`} className="flex items-center gap-2">
                        <span aria-hidden className="size-4 shrink-0 rounded ring-1 ring-inset ring-black/15" style={{ background: x.hex }} />
                        <span className="w-3 font-medium">{HURUF_SABLON[j]}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {x.kode ?? x.hex.toUpperCase()}
                          <span className="text-muted-foreground"> · {t(`roles.${x.peran}`)}</span>
                          {x.dikunci && <Lock aria-label={t('lockLabel')} className="ml-1 inline h-3 w-3 text-muted-foreground" />}
                        </span>
                        <span className="tabular-nums text-muted-foreground">{x.porsi}%</span>
                      </li>
                    ))}
                  </ul>
                  <Button type="button" size="sm" variant={gambar ? 'default' : 'outline'} className="mt-auto" onClick={() => onPakai(k, nama)}>
                    {t('use')}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

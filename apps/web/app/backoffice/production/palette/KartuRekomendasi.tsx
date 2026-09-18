'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Lock, LockOpen, Shuffle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { svgKaos } from '@/lib/production-colors/palet/kaos-svg';
import { pantoneTerdekat, type WarnaPantone } from '@/lib/production-colors/palet/pantone';
import { galeriKomposisi, type GayaKomposisi, type Komposisi } from '@/lib/production-colors/sablon/komposisi';
import { KAMUS_WARNA } from '@/lib/production-colors/sablon/nama-warna';
import type { WarnaLaris } from '@/lib/production-colors/sablon/warna-laris';
import { HURUF_SABLON, JUMLAH_SABLON_MAKS } from '@/lib/production-colors/sablon/saran';

/** Dari mana warna aksen diambil: warna laris toko, preset tren lokal, atau daftar sablon bawaan. */
type SumberWarna = 'LARIS' | 'EARTH' | 'PASTEL' | 'CERAH' | 'BAWAAN';
const SUMBER: readonly SumberWarna[] = ['LARIS', 'EARTH', 'PASTEL', 'CERAH', 'BAWAAN'];

/**
 * Galeri komposisi siap pakai untuk kain yang dipilih — jawaban untuk "warna
 * apa yang cocok", tanpa harus menyetel tinta satu per satu. Setiap komposisi
 * memakai jumlah tinta yang sama dengan palet; galeri dihitung ulang hanya saat
 * kain, jumlah tinta, atau warna yang dikunci berubah.
 *
 * Tinta bisa dikunci dari daftar tinta palet atau langsung dari sebuah kartu.
 * Di kartu, gembok dipilih dulu lalu dikonfirmasi sekali: kalau setiap klik
 * langsung mengunci, galeri berganti setelah klik pertama dan kartu yang memuat
 * tinta kedua bisa hilang.
 */
export function KartuRekomendasi({
  kainHex,
  namaKain,
  katalogC,
  hexTinta,
  kunci,
  onKunci,
  onJumlah,
  onPakai,
  warnaLaris,
}: {
  kainHex: string;
  namaKain: string;
  katalogC: readonly WarnaPantone[];
  /** Tinta yang sedang dipakai — calon warna yang bisa dikunci. */
  hexTinta: string[];
  /** Warna yang dikunci, berurutan: urutan ini juga urutan tinta dan porsinya. */
  kunci: readonly string[];
  onKunci: (daftar: string[]) => void;
  /** Mengubah jumlah tinta palet — rekomendasi mengikuti. */
  onJumlah: (n: number) => void;
  onPakai: (k: Komposisi, judul: string) => void;
  /** Warna produk yang laku di toko, terlaris dulu. */
  warnaLaris: readonly WarnaLaris[];
}) {
  const t = useTranslations('productionPalette.recommend');
  const tUmum = useTranslations('productionPalette');
  const jumlah = hexTinta.length;
  // Satu tinta selalu disisakan untuk direkomendasikan.
  const maksKunci = Math.max(1, jumlah - 1);
  const kunciAktif = useMemo(() => kunci.slice(0, maksKunci), [kunci, maksKunci]);
  /** Gembok yang sedang dipilih di satu kartu, belum dikonfirmasi. */
  const [pilihan, setPilihan] = useState<{ id: string; hex: string[] } | null>(null);
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
    () => galeriKomposisi({ kainHex, katalog: katalogC, kunciHex: kunciAktif, jumlah, gaya, aksen, acak }),
    [kainHex, katalogC, kunciAktif, jumlah, gaya, aksen, acak],
  );
  const daftar = galeri;

  /** Judul dari peran tintanya: empat tinta klasik berbunyi "Netral + Aksen + Tone-on-tone + Aksen 2". */
  const judul = (k: Komposisi) => {
    if (k.pola === 'TONAL') return t('patterns.TONAL', { count: k.tinta.length });
    if (k.pola === 'SATU') return t('patterns.SATU', { role: t(`roles.${k.tinta[0].peran}`) });
    return [...new Set(k.tinta.map((x) => x.peran))].map((p) => t(`roles.${p}`)).join(' + ');
  };

  const kodeUntuk = (hex: string) => {
    const p = pantoneTerdekat(katalogC, hex);
    return p && p.deltaE < 0.05 ? p.warna.kode : hex.toUpperCase();
  };
  const pilihanKunci = [
    ...hexTinta.map((hex, i) => ({ hex, label: t('lockInk', { letter: HURUF_SABLON[i], code: kodeUntuk(hex) }) })),
    ...kunciAktif.filter((hex) => !hexTinta.includes(hex)).map((hex) => ({ hex, label: t('lockKept', { code: kodeUntuk(hex) }) })),
  ];
  const kunciPenuh = kunciAktif.length >= maksKunci;

  /** Gembok di kartu: yang terpilih mula-mula adalah tinta kartu yang sudah terkunci. */
  const terpilihDi = (k: Komposisi) => (pilihan?.id === k.id ? pilihan.hex : k.tinta.filter((x) => x.dikunci).map((x) => x.hex));
  const alihGembok = (k: Komposisi, hex: string) => {
    const kini = terpilihDi(k);
    const berikut = kini.includes(hex) ? kini.filter((h) => h !== hex) : kini.length < maksKunci ? [...kini, hex] : kini;
    setPilihan({ id: k.id, hex: berikut });
  };
  const konfirmasiGembok = (k: Komposisi) => {
    const dipilih = terpilihDi(k);
    // Urutan kartu, bukan urutan klik: tinta A tetap A dengan porsinya.
    onKunci(k.tinta.map((x) => x.hex).filter((h) => dipilih.includes(h)));
    setPilihan(null);
  };

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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button id="kunci-warna" type="button" variant="outline" className="w-full justify-between font-normal" title={t('lockHint')}>
                  <span className="flex min-w-0 items-center gap-2">
                    {kunciAktif.map((hex) => (
                      <span key={hex} aria-hidden className="size-3 shrink-0 rounded-sm ring-1 ring-inset ring-black/15" style={{ background: hex }} />
                    ))}
                    <span className="truncate">
                      {kunciAktif.length === 0
                        ? t('lockNone')
                        : kunciAktif.length === 1
                          ? kodeUntuk(kunciAktif[0])
                          : t('lockedCount', { count: kunciAktif.length })}
                    </span>
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('lockMax', { count: maksKunci })}</DropdownMenuLabel>
                {pilihanKunci.map((p) => {
                  const aktif = kunciAktif.includes(p.hex);
                  return (
                    <DropdownMenuCheckboxItem
                      key={p.hex}
                      checked={aktif}
                      disabled={!aktif && kunciPenuh}
                      // Menu tetap terbuka: mengunci dua tinta tidak perlu membuka menu dua kali.
                      onSelect={(e) => e.preventDefault()}
                      onCheckedChange={(v) => onKunci(v ? [...kunciAktif, p.hex] : kunciAktif.filter((h) => h !== p.hex))}
                    >
                      <span aria-hidden className="size-3 rounded-sm ring-1 ring-inset ring-black/15" style={{ background: p.hex }} />
                      {p.label}
                    </DropdownMenuCheckboxItem>
                  );
                })}
                {kunciAktif.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onKunci([])}>{t('lockClear')}</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button type="button" variant="outline" onClick={() => setAcak((a) => a + 1)}>
            <Shuffle className="h-4 w-4" />
            {t('shuffle')}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t(`sourceHints.${sumber === 'LARIS' ? 'LARIS' : sumber === 'BAWAAN' ? 'BAWAAN' : 'TREN'}`)}
        </p>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">{kunciAktif.length >= 2 ? t('fillHint') : t('lockCardHint')}</p>
        {daftar.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {daftar.map((k, i) => {
              const nama = judul(k);
              const terpilih = terpilihDi(k);
              const awal = k.tinta.filter((x) => x.dikunci).map((x) => x.hex);
              const berubah = pilihan?.id === k.id && (terpilih.length !== awal.length || terpilih.some((h) => !awal.includes(h)));
              return (
                <li key={k.id} className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm leading-tight font-medium">{nama}</p>
                    {k.gaya && (
                      <Badge variant="outline" className="shrink-0">
                        {t(`styles.${k.gaya}`)}
                      </Badge>
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
                  <ul className="space-y-1 text-xs">
                    {k.tinta.map((x, j) => {
                      const kode = x.kode ?? x.hex.toUpperCase();
                      const dipilih = terpilih.includes(x.hex);
                      return (
                        <li key={`${x.hex}-${j}`} className="flex items-center gap-2">
                          <span aria-hidden className="size-4 shrink-0 rounded ring-1 ring-inset ring-black/15" style={{ background: x.hex }} />
                          <span className="w-3 font-medium">{HURUF_SABLON[j]}</span>
                          <span className="min-w-0 flex-1 truncate">
                            {kode}
                            <span className="text-muted-foreground"> · {t(`roles.${x.peran}`)}</span>
                          </span>
                          <span className="tabular-nums text-muted-foreground">{x.porsi}%</span>
                          <Button
                            type="button"
                            variant={dipilih ? 'secondary' : 'ghost'}
                            size="icon-xs"
                            aria-pressed={dipilih}
                            aria-label={dipilih ? t('unlockThis', { code: kode }) : t('lockThis', { code: kode })}
                            title={dipilih ? t('unlockThis', { code: kode }) : t('lockThis', { code: kode })}
                            disabled={!dipilih && terpilih.length >= maksKunci}
                            onClick={() => alihGembok(k, x.hex)}
                          >
                            {dipilih ? <Lock /> : <LockOpen className="text-muted-foreground" />}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                  {berubah && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" size="sm" onClick={() => konfirmasiGembok(k)}>
                        <Lock className="h-3.5 w-3.5" />
                        {terpilih.length ? t('lockSelected', { count: terpilih.length }) : t('lockClear')}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setPilihan(null)}>
                        {tUmum('cancel')}
                      </Button>
                    </div>
                  )}
                  <Button type="button" size="sm" variant="outline" className="mt-auto" onClick={() => onPakai(k, nama)}>
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

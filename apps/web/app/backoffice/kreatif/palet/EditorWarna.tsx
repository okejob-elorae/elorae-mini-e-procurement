'use client';

import { useId, useState, type FocusEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cariPantone, pantoneTerdekat, type WarnaPantone } from '@/lib/creative/palet/pantone';
import { cmykKeRgb, hexKeRgb, normalisasiHex, rgbKeCmyk, rgbKeHex, type Hsb } from '@/lib/creative/palet/warna';
import { cn } from '@/lib/utils';

export const MODE_MASUKAN = ['HEX', 'RGB', 'CMYK', 'PANTONE_C', 'PANTONE_TCX'] as const;
export type ModeMasukan = (typeof MODE_MASUKAN)[number];

/** Nama sistem warna tidak diterjemahkan — sama di setiap bahasa dan di setiap alat desain. */
const NAMA_MODE: Record<ModeMasukan, string> = {
  HEX: 'HEX',
  RGB: 'RGB',
  CMYK: 'CMYK',
  PANTONE_C: 'Pantone C',
  PANTONE_TCX: 'Pantone TCX',
};

const KANAL: Record<'HEX' | 'RGB' | 'CMYK', { label: string; maks: number }[]> = {
  HEX: [{ label: 'HEX', maks: 0 }],
  RGB: [
    { label: 'R', maks: 255 },
    { label: 'G', maks: 255 },
    { label: 'B', maks: 255 },
  ],
  CMYK: [
    { label: 'C', maks: 100 },
    { label: 'M', maks: 100 },
    { label: 'Y', maks: 100 },
    { label: 'K', maks: 100 },
  ],
};

function namaPantone(w: WarnaPantone): string {
  return w.jenis === 'C' ? `PANTONE ${w.kode}` : `PANTONE ${w.kode} TCX${w.nama ? ` ${w.nama}` : ''}`;
}

function Keping({ hex, className }: { hex: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block shrink-0 rounded ring-1 ring-inset ring-black/15 dark:ring-white/20', className)}
      style={{ background: hex }}
    />
  );
}

/**
 * Isian satu warna dalam lima bahasa warna.
 *
 * Warna di palet tetap disimpan sebagai hex; RGB, CMYK, dan Pantone hanyalah
 * cara lain untuk menyebutnya. Semua jalan masuk berakhir di `onGantiHex`,
 * jadi aturan harmoni, roda, dan kisi kontras tidak perlu tahu dari mana
 * warnanya datang.
 */
export function EditorWarna({
  label,
  hex,
  hsb,
  mode,
  onMode,
  onGantiHex,
  onSalin,
  katalogC,
  katalogTcx,
}: {
  label: string;
  hex: string;
  hsb: Hsb;
  mode: ModeMasukan;
  onMode: (mode: ModeMasukan) => void;
  onGantiHex: (hex: string) => void;
  onSalin: (teks: string, label: string) => void;
  katalogC: readonly WarnaPantone[];
  katalogTcx: readonly WarnaPantone[];
}) {
  const t = useTranslations('creative.palette');
  const locale = useLocale();
  // Satu halaman bisa memuat dua editor (kain dan tinta); id kolom harus unik
  // supaya setiap label menunjuk kolomnya sendiri.
  const awalanId = useId();
  const desimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  /*
   * Isian yang sedang diketik, dipegang sampai kolomnya ditinggalkan.
   *
   * Warnanya diterapkan seketika, tetapi angka di kolom TIDAK ditulis ulang
   * dari hasil hitungan selama orang masih mengetik. CMYK tidak unik — C10 M10
   * Y10 K0 dan C0 M0 Y0 K10 adalah abu-abu yang sama — jadi menulis ulang
   * kolomnya membuat angka yang baru diketik berubah sendiri di depan mata.
   */
  const [draf, setDraf] = useState<{ mode: ModeMasukan; nilai: string[] } | null>(null);
  // Satu kueri per pustaka: kode C yang diketik tidak ada artinya di TCX, dan
  // membawanya pindah tab hanya menyambung teks lama dengan yang baru.
  const [kueriPer, setKueriPer] = useState({ PANTONE_C: '', PANTONE_TCX: '' });
  const kueri = mode === 'PANTONE_C' || mode === 'PANTONE_TCX' ? kueriPer[mode] : '';
  /*
   * CMYK yang terakhir DIKETIK, selama warnanya belum berubah lewat jalan lain.
   * Tanpa ini, orang yang mengetik C10 M10 Y10 K0 melihatnya berubah menjadi
   * C0 M0 Y0 K10 begitu kolomnya ditinggalkan — warna yang sama, tetapi bukan
   * angka yang ia kirim ke percetakan.
   */
  const [cmykDiketik, setCmykDiketik] = useState<{ hex: string; nilai: string[] } | null>(null);

  const rgb = hexKeRgb(hex);
  const cmyk = rgbKeCmyk(rgb.r, rgb.g, rgb.b);
  const nilaiSekarang: Record<'HEX' | 'RGB' | 'CMYK', string[]> = {
    HEX: [hex.toUpperCase()],
    RGB: [rgb.r, rgb.g, rgb.b].map(String),
    CMYK: cmykDiketik?.hex === hex ? cmykDiketik.nilai : cmyk.map(String),
  };

  const terdekatC = pantoneTerdekat(katalogC, hex);
  const terdekatTcx = pantoneTerdekat(katalogTcx, hex);

  function ketik(m: 'HEX' | 'RGB' | 'CMYK', indeks: number, isi: string) {
    const nilai = [...(draf?.mode === m ? draf.nilai : nilaiSekarang[m])];
    nilai[indeks] = isi;
    setDraf({ mode: m, nilai });

    if (m === 'HEX') {
      // Enam digit lengkap saja: tiga digit bisa jadi awal dari enam yang
      // sedang diketik, dan warnanya melompat di tengah ketikan.
      if (/^#?[0-9a-fA-F]{6}$/.test(isi.trim())) onGantiHex(normalisasiHex(isi)!);
      return;
    }
    const angka = nilai.map((v) => (/^\d{1,3}$/.test(v.trim()) ? Number(v) : NaN));
    if (angka.some((n, i) => Number.isNaN(n) || n > KANAL[m][i].maks)) return;
    const hasil = m === 'RGB' ? { r: angka[0], g: angka[1], b: angka[2] } : cmykKeRgb(angka[0], angka[1], angka[2], angka[3]);
    const hexBaru = rgbKeHex(hasil.r, hasil.g, hasil.b);
    if (m === 'CMYK') setCmykDiketik({ hex: hexBaru, nilai: angka.map(String) });
    onGantiHex(hexBaru);
  }

  function tinggalkan(e: FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      if (draf?.mode === 'HEX') {
        const bersih = normalisasiHex(draf.nilai[0]);
        if (bersih) onGantiHex(bersih);
      }
      setDraf(null);
    }
  }

  const tampil = (m: 'HEX' | 'RGB' | 'CMYK') => (draf?.mode === m ? draf.nilai : nilaiSekarang[m]);
  const salahKanal = (m: 'HEX' | 'RGB' | 'CMYK') => {
    if (draf?.mode !== m) return false;
    if (m === 'HEX') return normalisasiHex(draf.nilai[0]) === null && draf.nilai[0].replace(/^#/, '').length >= 6;
    return draf.nilai.some((v, i) => !/^\d{1,3}$/.test(v.trim()) || Number(v) > KANAL[m][i].maks);
  };

  const katalogAktif = mode === 'PANTONE_C' ? katalogC : katalogTcx;
  const hasilCari = mode === 'PANTONE_C' || mode === 'PANTONE_TCX' ? cariPantone(katalogAktif, kueri, 6) : [];

  function labelDeltaE(deltaE: number): string {
    return deltaE < 0.05 ? t('exact') : `ΔE ${desimal.format(deltaE)}`;
  }

  const baris: { label: string; nilai: ReactNode; salin: string }[] = [
    { label: 'HEX', nilai: <span className="font-mono">{hex.toUpperCase()}</span>, salin: hex.toUpperCase() },
    { label: 'RGB', nilai: <span className="font-mono">{nilaiSekarang.RGB.join(', ')}</span>, salin: nilaiSekarang.RGB.join(', ') },
    { label: 'CMYK*', nilai: <span className="font-mono">{nilaiSekarang.CMYK.join(', ')}</span>, salin: nilaiSekarang.CMYK.join(', ') },
    {
      label: 'HSB',
      nilai: (
        <span className="tabular-nums">
          {Math.round(hsb.h)}° · {Math.round(hsb.s * 100)}% · {Math.round(hsb.b * 100)}%
        </span>
      ),
      salin: `${Math.round(hsb.h)}, ${Math.round(hsb.s * 100)}, ${Math.round(hsb.b * 100)}`,
    },
  ];
  for (const [namaBaris, terdekat] of [
    ['Pantone C', terdekatC],
    ['Pantone TCX', terdekatTcx],
  ] as const) {
    if (!terdekat) continue;
    baris.push({
      label: namaBaris,
      nilai: (
        <span className="flex min-w-0 items-center gap-2">
          <Keping hex={terdekat.warna.hex} className="size-3.5" />
          <span className="truncate">
            {terdekat.warna.kode}
            {terdekat.warna.nama && <span className="text-muted-foreground"> {terdekat.warna.nama}</span>}
          </span>
          <span
            className={cn(
              'shrink-0 rounded px-1 text-[10px] font-medium leading-4 ring-1 ring-inset',
              terdekat.deltaE < 2
                ? 'bg-emerald-500/12 text-emerald-700 ring-emerald-600/25 dark:text-emerald-300'
                : 'bg-muted text-muted-foreground ring-border',
            )}
          >
            {labelDeltaE(terdekat.deltaE)}
          </span>
        </span>
      ),
      salin: namaPantone(terdekat.warna),
    });
  }

  /*
   * Tata letak mengikuti lebar WADAHNYA, bukan lebar layar. Editor ini dipasang
   * di kolom lebar (Palet Warna) dan di kolom sempit (Warna Sablon); dengan
   * breakpoint layar, di kolom sempit pada layar lebar kelima tab saling tindih.
   */
  return (
    <div className="@container">
      <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-3 @md:flex-row @md:items-start @md:p-4">
        <div
          aria-hidden
          className="h-16 w-full shrink-0 rounded-md ring-1 ring-inset ring-black/10 @md:w-16 dark:ring-white/10"
          style={{ background: hex }}
        />
        <div className="@container/isi min-w-0 flex-1 space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">{label}</p>
            <Tabs value={mode} onValueChange={(v) => onMode(v as ModeMasukan)}>
              {/* Tinggi bawaan TabsList dikunci lewat selektor grup; menimpanya butuh selektor yang sama, bukan `h-auto` biasa. */}
              <TabsList
                className="grid w-full grid-cols-3 group-data-[orientation=horizontal]/tabs:h-auto @md/isi:grid-cols-5"
                aria-label={t('inputAs')}
              >
                {MODE_MASUKAN.map((m) => (
                  <TabsTrigger key={m} value={m} className="h-8 text-xs">
                    {NAMA_MODE[m]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {(mode === 'HEX' || mode === 'RGB' || mode === 'CMYK') && (
            <div onBlur={tinggalkan} className="space-y-1.5">
              <div className="flex flex-wrap items-end gap-2">
                {KANAL[mode].map((kanal, i) => {
                  const id = `${awalanId}-${mode}-${i}`;
                  return (
                    <div key={id} className="space-y-1">
                      <Label htmlFor={id} className={cn('text-xs text-muted-foreground', mode === 'HEX' && 'sr-only')}>
                        {kanal.label}
                        {mode === 'CMYK' && ' %'}
                      </Label>
                      <Input
                        id={id}
                        value={tampil(mode)[i]}
                        onChange={(e) => ketik(mode, i, e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                        inputMode={mode === 'HEX' ? 'text' : 'numeric'}
                        maxLength={mode === 'HEX' ? 7 : 3}
                        spellCheck={false}
                        autoComplete="off"
                        aria-invalid={salahKanal(mode) || undefined}
                        className={cn('font-mono tabular-nums', mode === 'HEX' ? 'w-32 uppercase' : 'w-16 text-center')}
                      />
                    </div>
                  );
                })}
              </div>
              {salahKanal(mode) && (
                <p className="text-xs text-destructive">
                  {mode === 'HEX' ? t('hexInvalid') : mode === 'RGB' ? t('rangeRgb') : t('rangeCmyk')}
                </p>
              )}
            </div>
          )}

          {(mode === 'PANTONE_C' || mode === 'PANTONE_TCX') && (
            <div className="space-y-2">
              <Input
                type="search"
                value={kueri}
                onChange={(e) => {
                  const isi = e.target.value;
                  setKueriPer((k) => ({ ...k, [mode]: isi }));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && hasilCari[0]) {
                    e.preventDefault();
                    onGantiHex(hasilCari[0].hex);
                  }
                }}
                placeholder={mode === 'PANTONE_C' ? t('searchC') : t('searchTcx')}
                aria-label={mode === 'PANTONE_C' ? t('searchC') : t('searchTcx')}
                autoComplete="off"
                spellCheck={false}
              />
              {kueri.trim() !== '' &&
                (hasilCari.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('searchEmpty', { q: kueri.trim() })}</p>
                ) : (
                  <ul className="divide-y overflow-hidden rounded-md border bg-background">
                    {hasilCari.map((w) => {
                      const dipakai = w.hex === hex;
                      return (
                        <li key={w.kode}>
                          <button
                            type="button"
                            onClick={() => onGantiHex(w.hex)}
                            aria-label={t('applyPantone', { code: namaPantone(w) })}
                            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
                          >
                            <Keping hex={w.hex} className="size-5" />
                            <span className="min-w-0 flex-1 truncate">
                              <span className="font-medium">{w.kode}</span>
                              {w.nama && <span className="text-muted-foreground"> {w.nama}</span>}
                            </span>
                            <span className="font-mono text-[11px] uppercase text-muted-foreground">{w.hex}</span>
                            {dipakai && <Check className="size-4 text-emerald-600 dark:text-emerald-400" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ))}
            </div>
          )}

          <dl className="divide-y rounded-md border bg-background text-sm">
            {baris.map((b) => (
              // Di HP labelnya naik ke atas: berdampingan, kolom nilai tinggal
              // ~85px dan kode Pantone terpotong menjadi "76…".
              <div key={b.label} className="flex flex-wrap items-center gap-x-3 py-1.5 pr-1.5 pl-3">
                <dt className="w-full shrink-0 text-[11px] text-muted-foreground @sm/isi:w-24 @sm/isi:text-xs">{b.label}</dt>
                <dd className="min-w-0 flex-1 truncate">{b.nilai}</dd>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('copyValue', { label: b.label.replace('*', '') })}
                  onClick={() => onSalin(b.salin, b.label.replace('*', ''))}
                >
                  <Copy />
                </Button>
              </div>
            ))}
          </dl>

          <div className="space-y-1 text-xs text-muted-foreground">
            <p>{t('cmykNote')}</p>
            <p>{t('pantoneNote')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

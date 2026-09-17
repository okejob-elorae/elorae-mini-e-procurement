'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  KELUARGA_WARNA,
  hitungKeluarga,
  jelajahiKatalog,
  variasiTerdekat,
  type KeluargaWarna,
} from '@/lib/production-colors/palet/katalog';
import type { WarnaPantone } from '@/lib/production-colors/palet/pantone';
import { cn } from '@/lib/utils';

/** Satu halaman kisi. Katalog TCX berisi 2.800 warna; merender semuanya sekaligus membuat roda tersendat. */
const PER_HALAMAN = 96;
const JUMLAH_VARIASI = 12;

/** Titik warna penanda tiap keluarga di tombol saring. */
const WARNA_KELUARGA: Record<KeluargaWarna, string> = {
  MERAH: '#d0312d',
  ORANYE: '#f08c21',
  KUNING: '#f2c832',
  HIJAU: '#3e9e4d',
  BIRU: '#2f6fb5',
  UNGU: '#7b4ba0',
  PINK: '#e05a9b',
  COKELAT: '#7a5230',
  NETRAL: '#9e9e9e',
};

function namaPantone(w: WarnaPantone): string {
  return w.jenis === 'C' ? `PANTONE ${w.kode}` : `PANTONE ${w.kode} TCX${w.nama ? ` ${w.nama}` : ''}`;
}

function Ubin({ warna, aktif, onPilih, label }: { warna: WarnaPantone; aktif: boolean; onPilih: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onPilih}
      title={warna.nama ? `${warna.kode} · ${warna.nama}` : warna.kode}
      aria-label={label}
      aria-pressed={aktif}
      className="group flex min-w-0 flex-col gap-1 rounded-md p-1 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span
        aria-hidden
        className={cn(
          'block h-9 w-full rounded ring-inset',
          aktif ? 'ring-2 ring-foreground' : 'ring-1 ring-black/10 dark:ring-white/10',
        )}
        style={{ background: warna.hex }}
      />
      <span
        className={cn(
          'truncate text-[10px] leading-tight tabular-nums',
          aktif ? 'font-semibold text-foreground' : 'text-muted-foreground group-hover:text-foreground',
        )}
      >
        {warna.jenis === 'C' ? warna.kode.replace(/ C$/, '') : warna.kode}
      </span>
    </button>
  );
}

/**
 * Katalog Pantone yang bisa dijelajahi, bukan sekadar dicari.
 *
 * Tanpa diketik pun seluruh katalog tampil sebagai kisi swatch, bisa disaring
 * per keluarga warna, dengan baris "mirip warna ini" untuk melihat variasi di
 * sekitar warna yang sedang dipilih. Kotak pencarian menyaring kisi yang sama.
 */
export function KatalogPantone({
  katalog,
  hex,
  kueri,
  onKueri,
  onPilih,
  placeholder,
}: {
  katalog: readonly WarnaPantone[];
  hex: string;
  kueri: string;
  onKueri: (kueri: string) => void;
  onPilih: (hex: string) => void;
  placeholder: string;
}) {
  const t = useTranslations('productionPalette');
  const [keluarga, setKeluarga] = useState<KeluargaWarna | null>(null);
  // Banyaknya ubin yang tampil hanya berlaku untuk saringan yang sedang aktif;
  // mengganti kueri atau keluarga kembali ke halaman pertama.
  const kunciSaring = `${kueri}|${keluarga ?? ''}`;
  const [halaman, setHalaman] = useState({ kunci: '', batas: PER_HALAMAN });
  const batas = halaman.kunci === kunciSaring ? halaman.batas : PER_HALAMAN;

  const kueriTunda = useDeferredValue(kueri);
  const hexTunda = useDeferredValue(hex);
  const hitung = useMemo(() => hitungKeluarga(katalog), [katalog]);
  const hasil = useMemo(() => jelajahiKatalog(katalog, { kueri: kueriTunda, keluarga }), [katalog, kueriTunda, keluarga]);
  const variasi = useMemo(() => variasiTerdekat(katalog, hexTunda, JUMLAH_VARIASI), [katalog, hexTunda]);
  const tampilVariasi = !kueri.trim() && keluarga === null && variasi.length > 0;

  const kisi = 'grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-0.5';

  return (
    <div className="space-y-3">
      <Input
        type="search"
        value={kueri}
        onChange={(e) => onKueri(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hasil[0]) {
            e.preventDefault();
            onPilih(hasil[0].hex);
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        spellCheck={false}
      />

      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('familyLabel')}>
        {[null, ...KELUARGA_WARNA].map((k) => {
          const aktif = keluarga === k;
          return (
            <Button
              key={k ?? 'SEMUA'}
              type="button"
              size="xs"
              variant={aktif ? 'default' : 'outline'}
              aria-pressed={aktif}
              className="rounded-full px-2.5"
              onClick={() => setKeluarga(k)}
            >
              {k && <span aria-hidden className="size-2.5 rounded-full ring-1 ring-black/15" style={{ background: WARNA_KELUARGA[k] }} />}
              {k ? t(`families.${k}`) : t('familyAll')}
              <span className={cn('tabular-nums', aktif ? 'opacity-80' : 'text-muted-foreground')}>
                {k ? hitung[k] : katalog.length}
              </span>
            </Button>
          );
        })}
      </div>

      {tampilVariasi && (
        <div className="space-y-1">
          <p className="text-xs font-medium">{t('similarTitle')}</p>
          <div className={kisi}>
            {variasi.map(({ warna }) => (
              <Ubin
                key={`v-${warna.kode}`}
                warna={warna}
                aktif={warna.hex === hex}
                onPilih={() => onPilih(warna.hex)}
                label={t('applyPantone', { code: namaPantone(warna) })}
              />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          {kueri.trim() && hasil.length === 0 ? t('searchEmpty', { q: kueri.trim() }) : t('catalogCount', { count: hasil.length })}
        </p>
        {hasil.length > 0 && (
          <div className="max-h-80 overflow-y-auto rounded-md border bg-background p-1">
            <div className={kisi}>
              {hasil.slice(0, batas).map((w) => (
                <Ubin
                  key={w.kode}
                  warna={w}
                  aktif={w.hex === hex}
                  onPilih={() => onPilih(w.hex)}
                  label={t('applyPantone', { code: namaPantone(w) })}
                />
              ))}
            </div>
            {hasil.length > batas && (
              <div className="p-2 text-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setHalaman({ kunci: kunciSaring, batas: batas + PER_HALAMAN })}
                >
                  {t('showMore', { count: Math.min(PER_HALAMAN, hasil.length - batas) })}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

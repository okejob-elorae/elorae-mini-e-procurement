'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cariPantone, type WarnaPantone } from '@/lib/creative/palet/pantone';
import { normalisasiHex } from '@/lib/creative/palet/warna';
import { BATAS_TINTA_DASAR, presetTintaPantone, type TintaDasar } from '@/lib/creative/sablon/tinta-dasar';

/**
 * Daftar tinta dasar yang dipakai resep.
 *
 * Suntingan langsung dipakai untuk menghitung resep di layar — termasuk oleh
 * orang yang tidak boleh menyimpan, supaya mereka bisa mencoba "bagaimana
 * kalau kita beli Orange 021" tanpa mengubah daftar tim.
 */
export function KartuTintaDasar({
  tinta,
  berubah,
  bolehMenyimpan,
  menyimpan,
  katalogC,
  onUbah,
  onSimpan,
  onGalat,
}: {
  tinta: TintaDasar[];
  berubah: boolean;
  bolehMenyimpan: boolean;
  menyimpan: boolean;
  katalogC: readonly WarnaPantone[];
  onUbah: (tinta: TintaDasar[]) => void;
  onSimpan: () => void;
  onGalat: (pesan: string) => void;
}) {
  const t = useTranslations('creative.sablon');
  const [cari, setCari] = useState('');
  const [nama, setNama] = useState('');
  const [hex, setHex] = useState('');

  const penuh = tinta.length >= BATAS_TINTA_DASAR;
  const hasilCari = cariPantone(katalogC, cari, 5);

  function tambah(baru: TintaDasar): boolean {
    if (penuh) {
      onGalat(t('inksFull', { max: BATAS_TINTA_DASAR }));
      return false;
    }
    if (tinta.some((x) => x.nama.toLowerCase() === baru.nama.toLowerCase())) {
      onGalat(t('inksDuplicate', { name: baru.nama }));
      return false;
    }
    onUbah([...tinta, baru]);
    return true;
  }

  function tambahHex(e: FormEvent) {
    e.preventDefault();
    const bersih = normalisasiHex(hex);
    if (!nama.trim() || !bersih) return;
    if (tambah({ nama: nama.trim(), hex: bersih, kode: null })) {
      setNama('');
      setHex('');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inksTitle')}</CardTitle>
        <CardDescription>{t('inksDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {tinta.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('inksEmpty')}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {tinta.map((x) => (
              <li key={x.nama} className="flex min-w-0 items-center gap-2.5 rounded-md border py-1.5 pr-1 pl-2">
                <span aria-hidden className="size-6 shrink-0 rounded ring-1 ring-inset ring-black/15 dark:ring-white/20" style={{ background: x.hex }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{x.nama}</span>
                  <span className="block truncate font-mono text-[11px] uppercase text-muted-foreground">
                    {x.kode ? `${x.kode} · ${x.hex}` : x.hex}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('inksRemove', { name: x.nama })}
                  onClick={() => onUbah(tinta.filter((y) => y !== x))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="cari-tinta-dasar">{t('inksAddPantone')}</Label>
            <Input
              id="cari-tinta-dasar"
              type="search"
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder={t('inksSearch')}
              autoComplete="off"
              spellCheck={false}
              disabled={penuh}
            />
            {cari.trim() !== '' && hasilCari.length > 0 && (
              <ul className="divide-y overflow-hidden rounded-md border bg-background">
                {hasilCari.map((w) => (
                  <li key={w.kode}>
                    <button
                      type="button"
                      onClick={() => {
                        if (tambah({ nama: w.kode.replace(/ C$/, ''), hex: w.hex, kode: w.kode })) setCari('');
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
                    >
                      <span aria-hidden className="size-5 shrink-0 rounded ring-1 ring-inset ring-black/15" style={{ background: w.hex }} />
                      <span className="flex-1 font-medium">{w.kode}</span>
                      <Plus className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={tambahHex} className="space-y-2">
            <p className="text-sm font-medium">{t('inksAddHex')}</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor="nama-tinta" className="text-xs text-muted-foreground">
                  {t('inksName')}
                </Label>
                <Input id="nama-tinta" value={nama} onChange={(e) => setNama(e.target.value)} maxLength={40} disabled={penuh} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="hex-tinta" className="text-xs text-muted-foreground">
                  HEX
                </Label>
                <Input
                  id="hex-tinta"
                  value={hex}
                  onChange={(e) => setHex(e.target.value)}
                  placeholder="#FFFFFF"
                  maxLength={7}
                  className="w-28 font-mono uppercase"
                  disabled={penuh}
                />
              </div>
              <Button type="submit" variant="outline" disabled={penuh || !nama.trim() || !normalisasiHex(hex)}>
                {t('inksAdd')}
              </Button>
            </div>
          </form>
        </div>

        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onUbah(presetTintaPantone())}>
            {t('inksPreset')}
          </Button>
          <div className="flex flex-col gap-1 sm:items-end">
            {bolehMenyimpan ? (
              <>
                <Button type="button" onClick={onSimpan} disabled={!berubah || menyimpan}>
                  {menyimpan ? t('inksSaving') : t('inksSave')}
                </Button>
                {berubah && <p className="text-xs text-muted-foreground">{t('inksUnsaved')}</p>}
              </>
            ) : (
              <p className="text-xs text-muted-foreground sm:max-w-xs sm:text-right">{t('inksViewOnly')}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

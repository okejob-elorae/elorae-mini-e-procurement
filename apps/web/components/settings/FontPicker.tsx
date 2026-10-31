'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Type } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DAFTAR_FONT, FONT_BAWAAN, cariFont, type PilihanFont } from '@/lib/theme/fonts';
import { DEVICE_THEME_FONT_KEY } from '@/lib/theme/theme-storage';
import { setUserFont } from '@/app/actions/settings/theme';

/**
 * Pemilih huruf antarmuka.
 *
 * Tiap pilihan digambar DENGAN HURUFNYA SENDIRI — itu inti layar ini; tidak ada
 * yang bisa memilih huruf dari namanya. Tapi nama saja sudah cukup untuk itu:
 * versi pertama memberi tiap pilihan contoh kalimat DAN keterangan sendiri,
 * dua puluh kali, dan hasilnya kartu sepanjang satu setengah layar untuk satu
 * setelan. Contoh dan keterangan sekarang hanya untuk yang sedang dipilih —
 * satu-satunya yang sedang benar-benar dinilai orang.
 *
 * Pilihannya berlaku SEKETIKA, sebelum disimpan. Huruf hanya bisa dinilai
 * dengan melihat, dan memaksa simpan lalu muat ulang membuat mencoba sepuluh
 * pilihan jadi sepuluh perjalanan.
 */
export function FontPicker({ terpilihAwal }: { terpilihAwal: string }) {
  const t = useTranslations('settings.font');
  const [pending, startTransition] = useTransition();
  const [terpilih, setTerpilih] = useState(terpilihAwal);
  const [tersimpan, setTersimpan] = useState(terpilihAwal);

  const aktif = cariFont(terpilih);

  /** Pasang di layar tanpa menyimpan — supaya bisa dicoba-coba. */
  const coba = (f: PilihanFont) => {
    setTerpilih(f.id);
    document.documentElement.style.setProperty('--font-app-sans', `var(${f.variabel})`);
  };

  const simpan = () => {
    startTransition(async () => {
      const hasil = await setUserFont(terpilih);
      if (!hasil.ok) {
        toast.error(t('errUnknown'));
        return;
      }
      /*
       * Ditulis ke localStorage juga, bukan hanya ke basis data. Skrip tema
       * membacanya sebelum halaman pertama dilukis; tanpa ini huruf pilihan
       * baru muncul setelah React jalan, dan tiap pemuatan halaman berkedip.
       */
      try {
        localStorage.setItem(DEVICE_THEME_FONT_KEY, terpilih);
      } catch {
        // Mode penyamaran atau penyimpanan penuh. Pilihannya tetap tersimpan di
        // basis data; yang hilang hanya kecepatan pemasangannya.
      }
      setTersimpan(terpilih);
      toast.success(t('ok'));
    });
  };

  const belumTersimpan = terpilih !== tersimpan;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Type className="h-4 w-4" />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Satu baris per huruf, empat kolom. Dua puluh pilihan muat dalam lima
            baris — sebelumnya sepuluh kartu tinggi. */}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
          {DAFTAR_FONT.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => coba(f)}
              title={f.keterangan}
              className={cn(
                'truncate rounded-md border px-2.5 py-2 text-left text-[13px] transition-colors',
                terpilih === f.id
                  ? 'border-primary bg-primary/[0.06] font-medium'
                  : 'hover:bg-muted/60',
              )}
              style={{ fontFamily: `var(${f.variabel})` }}
            >
              {f.nama}
            </button>
          ))}
        </div>

        {/* Contoh dan keterangan HANYA untuk yang sedang dipilih. Itu satu-
            satunya yang sedang dinilai; dua puluh salinannya cuma panjang. */}
        <div className="rounded-lg border bg-muted/30 px-3.5 py-3">
          <p className="text-[17px] leading-snug" style={{ fontFamily: `var(${aktif.variabel})` }}>
            {t('sample')}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">{aktif.keterangan}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={simpan} disabled={pending || !belumTersimpan}>
            {t('save')}
          </Button>
          {belumTersimpan && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => coba(cariFont(tersimpan))}
              >
                {t('cancel')}
              </Button>
              <span className="text-xs text-muted-foreground">{t('unsaved')}</span>
            </>
          )}
          {!belumTersimpan && tersimpan !== FONT_BAWAAN && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => coba(cariFont(FONT_BAWAAN))}
            >
              {t('reset')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Type } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DAFTAR_FONT, FONT_BAWAAN, type PilihanFont } from '@/lib/theme/fonts';
import { DEVICE_THEME_FONT_KEY } from '@/lib/theme/theme-storage';
import { setUserFont } from '@/app/actions/settings/theme';

/**
 * Pemilih huruf antarmuka.
 *
 * Tiap pilihan digambar DENGAN HURUFNYA SENDIRI, dan itu inti layar ini: tidak
 * ada yang bisa memilih huruf dari namanya. "Bricolage Grotesque" tidak
 * memberi tahu apa pun; melihat kalimatnya memberi tahu segalanya.
 *
 * Pilihannya berlaku SEKETIKA, sebelum disimpan. Huruf adalah keputusan yang
 * hanya bisa diambil dengan melihat — memaksa orang menyimpan dulu, memuat
 * ulang, lalu menilai, membuat mencoba sepuluh pilihan jadi sepuluh perjalanan.
 */
export function FontPicker({ terpilihAwal }: { terpilihAwal: string }) {
  const t = useTranslations('settings.font');
  const [pending, startTransition] = useTransition();
  const [terpilih, setTerpilih] = useState(terpilihAwal);
  const [tersimpan, setTersimpan] = useState(terpilihAwal);

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
       * baru muncul setelah React jalan, dan tiap pemuatan halaman berkedip
       * ganti huruf.
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

  const batal = () => {
    const f = DAFTAR_FONT.find((x) => x.id === tersimpan) ?? DAFTAR_FONT[0];
    coba(f);
  };

  const belumTersimpan = terpilih !== tersimpan;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Type className="h-4 w-4" />
          {t('title')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {DAFTAR_FONT.map((f) => {
            const aktif = terpilih === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => coba(f)}
                className={cn(
                  'group rounded-lg border p-3 text-left transition-colors',
                  aktif ? 'border-primary bg-primary/[0.04]' : 'hover:bg-muted/50',
                )}
                style={{ fontFamily: `var(${f.variabel})` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[15px] font-semibold leading-tight">{f.nama}</span>
                  {aktif && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                </div>
                {/* Contoh kalimat memakai huruf itu — termasuk angka, karena
                    layar ini penuh angka dan sebagian huruf jelek angkanya. */}
                <p className="mt-1.5 text-[13px] leading-snug">{t('sample')}</p>
                <p
                  className="mt-2 text-[11px] leading-snug text-muted-foreground"
                  style={{ fontFamily: 'var(--font-jakarta)' }}
                >
                  {f.keterangan}
                </p>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={simpan} disabled={pending || !belumTersimpan}>
            {t('save')}
          </Button>
          {belumTersimpan && (
            <Button variant="outline" onClick={batal} disabled={pending}>
              {t('cancel')}
            </Button>
          )}
          {belumTersimpan && (
            <span className="text-xs text-muted-foreground">{t('unsaved')}</span>
          )}
          {tersimpan !== FONT_BAWAAN && !belumTersimpan && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                const b = DAFTAR_FONT.find((x) => x.id === FONT_BAWAAN)!;
                coba(b);
              }}
            >
              {t('reset')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

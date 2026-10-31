'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, CloudOff, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { perkecil } from '@/lib/foto/perkecil';
import { unggahFoto } from '@/lib/foto/unggah';

/**
 * `berkas` terisi = foto BELUM naik: dipilih saat tanpa sinyal dan disimpan di
 * HP. `url`-nya saat itu hanya pratinjau lokal (blob:) — pemanggil wajib
 * mengunggah berkasnya dulu, atau memasukkannya ke antrean offline.
 */
export type NilaiFoto = { url: string; nama: string; berkas?: Blob } | null;

/**
 * Pemilih + pengunggah satu foto.
 *
 * Mengembalikan URL, bukan berkas: pemanggilnya menyimpan URL itu ke kolomnya
 * sendiri, dan tidak perlu tahu fotonya disimpan di mana.
 */
export function UnggahFoto({
  label,
  petunjuk,
  nilai,
  onChange,
  wajib = false,
  disabled = false,
  simpanDiHp = false,
  labelLepas,
}: {
  label: string;
  petunjuk?: string;
  nilai: NilaiFoto;
  onChange: (nilai: NilaiFoto) => void;
  wajib?: boolean;
  disabled?: boolean;
  /**
   * PWA lapangan: kalau tidak ada sinyal, simpan fotonya di HP alih-alih gagal.
   * Formulir kantor tidak memakainya — di sana galat unggah harus terlihat.
   */
  simpanDiHp?: boolean;
  /**
   * Nama tombol × untuk pembaca layar (dan tooltip). Bawaannya "Hapus foto";
   * pemanggil yang × tidak menghapus apa pun di server — foto lama tetap
   * tersimpan sampai ada pengganti — wajib menyebutnya.
   */
  labelLepas?: string;
}) {
  const t = useTranslations('foto');
  const input = useRef<HTMLInputElement>(null);
  const [mengunggah, setMengunggah] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const simpanLokal = async (file: File) => {
    const kecil = await perkecil(file);
    onChange({ url: URL.createObjectURL(kecil), nama: file.name, berkas: kecil });
  };

  const pilih = async (file: File) => {
    setGalat(null);
    setMengunggah(true);
    try {
      if (simpanDiHp && typeof navigator !== 'undefined' && !navigator.onLine) {
        await simpanLokal(file);
        return;
      }
      onChange({ url: await unggahFoto(file), nama: file.name });
    } catch (err) {
      // `TypeError` dari fetch = sinyal putus di tengah jalan, bukan fotonya
      // yang ditolak. Di lapangan itu disimpan di HP, bukan dilaporkan gagal.
      if (simpanDiHp && err instanceof TypeError) {
        await simpanLokal(file);
        return;
      }
      setGalat(t(`err${err instanceof Error ? err.message : 'GAGAL'}` as never));
    } finally {
      setMengunggah(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <Label>
        {label}
        {wajib && <span className="ml-1 text-destructive">*</span>}
      </Label>

      {nilai ? (
        <div className="relative overflow-hidden rounded-lg border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={nilai.url} alt={label} className="max-h-64 w-full object-contain" />
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="absolute right-2 top-2"
            aria-label={labelLepas ?? t('remove')}
            title={labelLepas}
            disabled={disabled}
            onClick={() => {
              if (nilai.berkas) URL.revokeObjectURL(nilai.url);
              onChange(null);
            }}
          >
            <X className="h-4 w-4" />
          </Button>
          {nilai.berkas ? (
            <p className="flex items-center gap-1.5 border-t bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t('savedOnPhone')}
            </p>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || mengunggah}
          onClick={() => input.current?.click()}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-sm transition-colors',
            'hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60',
            wajib && !nilai ? 'border-destructive/50 text-destructive' : 'text-muted-foreground',
          )}
        >
          {mengunggah ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('uploading')}
            </>
          ) : (
            <>
              <Camera className="h-4 w-4" />
              {t('pick')}
            </>
          )}
        </button>
      )}

      {petunjuk && !galat && <p className="text-xs text-muted-foreground">{petunjuk}</p>}
      {galat && <p className="text-xs text-destructive">{galat}</p>}

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pilih(f);
        }}
      />
    </div>
  );
}

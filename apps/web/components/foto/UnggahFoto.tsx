'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const MAKS_SISI = 1600;
const MUTU = 0.82;

/**
 * Perkecil foto sebelum diunggah.
 *
 * Foto kamera HP hari ini 3–8 MB; nota retur tetap terbaca jelas pada sisi
 * terpanjang 1600 px. Tanpa ini setiap nota memakan berkali-kali lipat ruang
 * database dan menit-menit waktu unggah di jaringan lapangan.
 *
 * Kalau kanvasnya gagal karena alasan apa pun, berkas aslinya dipakai apa
 * adanya — lebih baik lambat daripada tidak bisa mengunggah sama sekali.
 */
async function perkecil(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const skala = Math.min(1, MAKS_SISI / Math.max(bitmap.width, bitmap.height));
    if (skala === 1 && file.size < 1_500_000) return file;

    const kanvas = document.createElement('canvas');
    kanvas.width = Math.round(bitmap.width * skala);
    kanvas.height = Math.round(bitmap.height * skala);
    const ctx = kanvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, kanvas.width, kanvas.height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      kanvas.toBlob(resolve, 'image/jpeg', MUTU),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

export type NilaiFoto = { url: string; nama: string } | null;

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
}: {
  label: string;
  petunjuk?: string;
  nilai: NilaiFoto;
  onChange: (nilai: NilaiFoto) => void;
  wajib?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('foto');
  const input = useRef<HTMLInputElement>(null);
  const [mengunggah, setMengunggah] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const pilih = async (file: File) => {
    setGalat(null);
    setMengunggah(true);
    try {
      const kecil = await perkecil(file);
      const form = new FormData();
      form.append('file', kecil, file.name.replace(/\.[^.]+$/, '') + '.jpg');
      const res = await fetch('/api/foto', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setGalat(t(`err${data.error}` as never));
        return;
      }
      onChange({ url: data.url, nama: file.name });
    } catch {
      setGalat(t('errGAGAL'));
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
            aria-label={t('remove')}
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            <X className="h-4 w-4" />
          </Button>
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

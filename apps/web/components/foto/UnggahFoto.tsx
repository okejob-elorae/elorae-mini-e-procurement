'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { unggahFoto } from '@/lib/foto/unggah';

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
      onChange({ url: await unggahFoto(file), nama: file.name });
    } catch (err) {
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

'use client';

import { useTranslations } from 'next-intl';
import { Download, FileText, ImageDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/** Menu ekspor satu palet: lembar PDF atau gambar PNG. */
export function TombolEkspor({
  onPdf,
  onPng,
  sibuk,
  ikonSaja,
  label,
}: {
  onPdf: () => void;
  onPng: () => void;
  sibuk: boolean;
  /** Tombol ikon kecil untuk daftar palet tersimpan. */
  ikonSaja?: boolean;
  label: string;
}) {
  const t = useTranslations('productionPalette.export');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {ikonSaja ? (
          <Button type="button" size="icon-sm" variant="ghost" aria-label={label} title={label} disabled={sibuk}>
            <Download className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled={sibuk}>
            <Download className="mr-1.5 h-4 w-4" />
            {label}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem onSelect={onPdf} className="items-start gap-3 py-2">
          <FileText className="mt-0.5 h-4 w-4" />
          <span className="space-y-0.5">
            <span className="block font-medium">{t('pdf')}</span>
            <span className="block text-xs text-muted-foreground">{t('pdfHint')}</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onPng} className="items-start gap-3 py-2">
          <ImageDown className="mt-0.5 h-4 w-4" />
          <span className="space-y-0.5">
            <span className="block font-medium">{t('png')}</span>
            <span className="block text-xs text-muted-foreground">{t('pngHint')}</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

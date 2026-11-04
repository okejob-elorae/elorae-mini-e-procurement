import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { nadaKategori } from '@/lib/ui/category-color';

/**
 * A badge whose colour identifies the category, not the brand.
 *
 * Shares its shape with StatusPill so the two read as one family, but draws
 * from a separate palette: StatusPill answers "how is this doing", this answers
 * "what kind of thing is this". Mixing the two palettes would make an operator
 * read amber as trouble when it only meant "accessories".
 */
export function CategoryBadge({
  label,
  warna,
  className,
  children,
}: {
  /** Drives the colour. Pass the raw category name, not a translated one, so
   *  the same category keeps its colour in both locales. */
  label: string | null | undefined;
  /** Warna pilihan pemilik untuk kategori ini ("#rrggbb", mis. SupplierType.color); kosong = otomatis. */
  warna?: string | null;
  className?: string;
  children?: ReactNode;
}) {
  const nada = nadaKategori(label, warna);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap',
        nada.className,
        className,
      )}
      style={nada.style}
    >
      {children ?? label ?? '—'}
    </span>
  );
}

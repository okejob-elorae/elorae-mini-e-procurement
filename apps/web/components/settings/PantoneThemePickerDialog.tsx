'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Search } from 'lucide-react';
import {
  listPantoneColorsForTheme,
  type PantoneThemeSwatch,
} from '@/app/actions/settings/theme';
import { ColorSwatchGrid } from '@/components/production-colors/ColorSwatchGrid';
import type { PantoneSwatch } from '@/components/production-colors/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export type PantoneThemeSelection = {
  tcx: string;
  name: string;
  hex: string;
};

type PantoneThemePickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selection: PantoneThemeSelection) => void;
};

export function PantoneThemePickerDialog({
  open,
  onOpenChange,
  onSelect,
}: PantoneThemePickerDialogProps) {
  const t = useTranslations('settings.theme');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [colors, setColors] = useState<PantoneSwatch[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadColors = useCallback(async (searchTerm: string, pageNum: number) => {
    setLoading(true);
    try {
      const result = await listPantoneColorsForTheme(searchTerm, pageNum);
      setColors(
        result.colors.map((c: PantoneThemeSwatch) => ({
          tcx: c.tcx,
          name: c.name,
          hex: c.hex,
          groupName: c.groupName,
        }))
      );
      setTotalPages(result.totalPages);
      setPage(pageNum);
    } catch {
      setColors([]);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadColors(debouncedSearch, 1);
  }, [open, debouncedSearch, loadColors]);

  const handleSelect = (tcx: string) => {
    const color = colors.find((c) => c.tcx === tcx);
    if (!color) return;
    onSelect({
      tcx: color.tcx,
      name: color.name,
      hex: color.hex.startsWith('#') ? color.hex : `#${color.hex}`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{t('pickerTitle')}</DialogTitle>
          <DialogDescription>{t('pickerDescription')}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('pickerSearchPlaceholder')}
            className="pl-9"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ColorSwatchGrid
              colors={colors}
              onSelect={handleSelect}
              emptyMessage={t('pickerEmpty')}
            />
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => void loadColors(debouncedSearch, page - 1)}
            >
              {t('pickerPrevious')}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t('pickerPage', { page, totalPages })}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => void loadColors(debouncedSearch, page + 1)}
            >
              {t('pickerNext')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

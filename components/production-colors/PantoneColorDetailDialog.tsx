'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FavoriteButton } from '@/components/production-colors/FavoriteButton';
import type { PantoneDetail } from '@/components/production-colors/types';
import { toast } from 'sonner';

type PantoneColorDetailDialogProps = {
  tcx: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectSimilar?: (tcx: string) => void;
};

export function PantoneColorDetailDialog({
  tcx,
  open,
  onOpenChange,
  onSelectSimilar,
}: PantoneColorDetailDialogProps) {
  const t = useTranslations('productionColors');
  const [detail, setDetail] = useState<PantoneDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !tcx) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/production/colors/${encodeURIComponent(tcx)}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed');
        return r.json();
      })
      .then((data: PantoneDetail) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load color');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tcx]);

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(t('copied'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] w-full overflow-x-hidden overflow-y-auto">
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle className="flex min-w-0 items-center gap-2">
            {t('detailTitle')}
            {detail && (
              <FavoriteButton
                tcx={detail.tcx}
                initialFavorited={detail.isFavorite}
                onToggle={(f) => setDetail((d) => (d ? { ...d, isFavorite: f } : d))}
              />
            )}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
        )}

        {detail && !loading && (
          <div className="min-w-0 w-full space-y-4 overflow-hidden">
            <div
              className="h-32 w-full rounded-lg border"
              style={{ backgroundColor: detail.hex }}
            />
            <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground shrink-0">{t('pantoneCode')}</dt>
              <dd className="flex min-w-0 items-center gap-1 font-mono">
                {detail.tcx}
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => copy(detail.tcx)}>
                  <Copy className="h-3 w-3" />
                </Button>
              </dd>
              <dt className="text-muted-foreground shrink-0">{t('colorName')}</dt>
              <dd className="min-w-0 break-words">{detail.name}</dd>
              <dt className="text-muted-foreground shrink-0">{t('hex')}</dt>
              <dd className="flex min-w-0 items-center gap-1 font-mono">
                {detail.hex}
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => copy(detail.hex)}>
                  <Copy className="h-3 w-3" />
                </Button>
              </dd>
              <dt className="text-muted-foreground shrink-0">{t('rgb')}</dt>
              <dd className="min-w-0 font-mono">{detail.rgb}</dd>
            </dl>

            {detail.groupName && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t('groupKelompok')}</p>
                <Badge variant="secondary">{detail.groupName}</Badge>
              </div>
            )}

            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground mb-2">{t('gradient')}</p>
              <div className="flex min-w-0 w-full rounded-md overflow-hidden border h-8">
                {detail.gradient.map((h, index) => (
                  <button
                    key={`${index}-${h}`}
                    type="button"
                    className="flex-1 min-w-0 hover:opacity-90"
                    style={{ backgroundColor: h }}
                    title={h}
                    onClick={() => copy(h)}
                  />
                ))}
              </div>
            </div>

            {detail.similar.length > 0 && (
              <div className="min-w-0 max-w-full">
                <p className="text-xs font-medium text-muted-foreground mb-2">{t('similarColors')}</p>
                <div className="flex min-w-0 max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-1 [-webkit-overflow-scrolling:touch]">
                  {detail.similar.map((s) => (
                    <div
                      key={s.tcx}
                      role="button"
                      tabIndex={0}
                      className="shrink-0 w-20 rounded border text-left overflow-hidden hover:ring-2 ring-primary/40 cursor-pointer"
                      onClick={() => onSelectSimilar?.(s.tcx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectSimilar?.(s.tcx);
                        }
                      }}
                    >
                      <div className="h-14 w-full" style={{ backgroundColor: s.hex }} />
                      <div className="p-1.5 space-y-0.5">
                        <div className="flex justify-between items-center gap-0.5">
                          <span className="text-[10px] font-mono truncate">{s.tcx}</span>
                          <FavoriteButton tcx={s.tcx} initialFavorited={!!s.isFavorite} className="h-6 w-6" />
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {t('deltaE')} {s.deltaE.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

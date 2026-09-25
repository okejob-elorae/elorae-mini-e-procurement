'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { History, Undo2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { batalkanImporAction } from '@/app/actions/receivable-import';
import { formatDisplayDateTime } from '@/lib/date-only';
import type { BatchImpor } from '@/lib/receivables/impor/batal';

/**
 * Riwayat impor, dengan pintu keluarnya.
 *
 * Satu berkas yang salah — kolom tertukar, periode keliru, berkas yang sama
 * diunggah dua kali — memasukkan puluhan tagihan palsu sekaligus. Tanpa layar
 * ini, membersihkannya menuntut akses basis data, yang berarti hanya bisa
 * dilakukan orang yang tidak membutuhkannya.
 */
export function RiwayatImpor({ batch }: { batch: BatchImpor[] }) {
  const t = useTranslations('imporPiutang');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<BatchImpor | null>(null);
  const [alasan, setAlasan] = useState('');

  if (batch.length === 0) return null;

  const batalkan = () => {
    if (!target) return;
    const id = target.auditLogId;
    startTransition(async () => {
      const hasil = await batalkanImporAction(id, alasan);
      if (hasil.ok) {
        toast.success(t('revertOk', { count: hasil.dihapus }));
        setTarget(null);
        setAlasan('');
        router.refresh();
      } else if (hasil.kode === 'SUDAH_DIPAKAI') {
        // Menyebut faktur mana yang menghalangi. "Tidak bisa dibatalkan" tanpa
        // menyebut sebabnya memaksa orang menebak, dan tebakannya salah.
        toast.error(t('revertInUse', { list: (hasil.dipakai ?? []).slice(0, 5).join(', ') }));
      } else {
        toast.error(t(`revertErr${hasil.kode}` as never));
      }
    });
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            {t('historyTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {batch.map((b) => (
            <div
              key={b.auditLogId}
              className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {formatDisplayDateTime(b.saat, locale)}
                  {b.oleh && <span className="text-muted-foreground"> · {b.oleh}</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('historyLine', { masuk: b.masuk, tersisa: b.tersisa })}
                </p>
              </div>
              {b.bisaDibatalkan ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setTarget(b);
                    setAlasan('');
                  }}
                >
                  <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                  {t('revert')}
                </Button>
              ) : (
                /* Sebabnya disebut di tempat tombolnya seharusnya berada, bukan
                   disembunyikan — kalau tidak, layarnya terbaca sebagai rusak. */
                <span className="text-xs text-muted-foreground">
                  {b.tersisa === 0 ? t('historyGone') : t('historyLocked')}
                </span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('revertTitle')}</DialogTitle>
            <DialogDescription>
              {t('revertBody', { count: target?.tersisa ?? 0 })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="alasan-batal-impor">{t('revertReason')}</Label>
            <Textarea
              id="alasan-batal-impor"
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder={t('revertReasonPlaceholder')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending || alasan.trim().length === 0}
              onClick={batalkan}
            >
              {t('revert')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

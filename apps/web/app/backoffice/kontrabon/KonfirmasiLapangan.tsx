'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { dinamis } from '@/lib/i18n/dinamis';
import { konfirmasiKontrabonAction } from '@/app/actions/collections';

/**
 * Tanda asal kontrabon. Kontrabon kantor tidak diberi tanda apa pun — ia
 * keadaan biasa; hanya janji dari lapangan yang perlu dibedakan, dan yang belum
 * dikonfirmasi diberi warna karena menunggu seseorang di kantor.
 */
export function LencanaAsal({
  dariLapangan,
  dikonfirmasi,
  className,
}: {
  dariLapangan: boolean;
  dikonfirmasi: boolean;
  className?: string;
}) {
  const t = useTranslations('collections');
  if (!dariLapangan) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        dikonfirmasi
          ? 'text-muted-foreground'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
        className,
      )}
    >
      <MapPin />
      {dikonfirmasi ? t('fromField') : t('fromFieldUnconfirmed')}
    </Badge>
  );
}

/**
 * Tombol konfirmasi janji lapangan, dengan konfirmasi dua langkah.
 *
 * Dua langkah karena yang dinyatakan adalah "foto lembarnya sudah saya
 * cocokkan" — pernyataan yang tidak bisa ditarik diam-diam; jejaknya tertulis.
 */
export function TombolKonfirmasi({
  collectionNoteId,
  docNo,
  size = 'sm',
}: {
  collectionNoteId: string;
  docNo: string;
  size?: 'sm' | 'default';
}) {
  const t = useTranslations('collections');
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [terbuka, setTerbuka] = useState(false);

  const konfirmasi = () => {
    startTransition(async () => {
      const hasil = await konfirmasiKontrabonAction(collectionNoteId);
      if (hasil.ok) {
        toast.success(t('okConfirmed'));
        setTerbuka(false);
        router.refresh();
      } else {
        toast.error(td(`err${hasil.kode}`));
      }
    });
  };

  return (
    <>
      <Button size={size} disabled={pending} onClick={() => setTerbuka(true)}>
        {t('confirm')}
      </Button>
      <AlertDialog open={terbuka} onOpenChange={setTerbuka}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmTitle', { doc: docNo })}</AlertDialogTitle>
            <AlertDialogDescription>{t('confirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t('confirmCancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                // Tetap terbuka sampai servernya menjawab.
                e.preventDefault();
                konfirmasi();
              }}
            >
              {t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

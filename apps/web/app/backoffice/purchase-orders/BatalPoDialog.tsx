'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * Konfirmasi batal PO dengan alasan WAJIB — dipakai daftar dan rincian PO.
 * Daftar PO dulu memakai `confirm()` bawaan peramban lalu mengirim alasan
 * Inggris tetap tanpa bertanya. Sesudah "Ya, batalkan" pemanggil membuka
 * jendela PIN dengan alasan ini.
 */
export function BatalPoDialog({
  open,
  onOpenChange,
  docNumber,
  onLanjut,
}: {
  open: boolean;
  onOpenChange: (buka: boolean) => void;
  docNumber: string;
  onLanjut: (alasan: string) => void;
}) {
  const tPO = useTranslations('purchaseOrders');
  const [alasan, setAlasan] = useState('');
  const kosong = alasan.trim() === '';

  return (
    <AlertDialog
      open={open}
      onOpenChange={(buka) => {
        if (!buka) setAlasan('');
        onOpenChange(buka);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tPO('batal.judul', { docNumber })}</AlertDialogTitle>
          <AlertDialogDescription>{tPO('cancelDialogDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="alasan-batal-po">{tPO('reasonLabel')}</Label>
          <Textarea
            id="alasan-batal-po"
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
            placeholder={tPO('reasonPlaceholder')}
            rows={3}
          />
          {kosong && <p className="text-xs text-muted-foreground">{tPO('batal.alasanDulu')}</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{tPO('keepPO')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={kosong}
            onClick={() => {
              const teks = alasan.trim();
              setAlasan('');
              onLanjut(teks);
            }}
          >
            {tPO('confirmCancelButton')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

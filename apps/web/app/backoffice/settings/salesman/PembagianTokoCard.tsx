'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, Store } from 'lucide-react';
import { simpanKunciToko } from '@/app/actions/settings/salesman';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export type RingkasanSales = { id: string; nama: string; jumlah: number; area: string[] };

/**
 * Pembagian toko ke sales: ringkasan siapa memegang berapa toko di area mana,
 * toko yang belum punya pemegang, dan saklar "hanya toko sendiri".
 *
 * Pemegang dan area DIATUR di master toko — di sini hanya dibaca. Satu tempat
 * menulis, supaya tidak ada dua layar yang bisa saling menimpa pembagiannya.
 */
export function PembagianTokoCard({
  bolehUbah,
  terkunci,
  tanpaPemegang,
  ringkasan,
}: {
  bolehUbah: boolean;
  terkunci: boolean;
  tanpaPemegang: number;
  ringkasan: RingkasanSales[];
}) {
  const t = useTranslations('settings.salesman');
  const tToasts = useTranslations('toasts');
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [konfirmasi, setKonfirmasi] = useState(false);

  const simpan = (nyala: boolean) =>
    mulai(async () => {
      const r = await simpanKunciToko(nyala);
      if (!r.ok) {
        toast.error(r.code === 'INVALID' ? t('errInvalid') : t('errForbidden'));
        return;
      }
      toast.success(tToasts('saved'));
      router.refresh();
    });

  // Menyalakan kunci selagi ada toko tanpa pemegang menutup toko itu untuk
  // SEMUA sales. Boleh, tapi harus disengaja.
  const ubahSaklar = (nyala: boolean) => {
    if (nyala && tanpaPemegang > 0) setKonfirmasi(true);
    else simpan(nyala);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Store className="h-5 w-5" />
          {t('shareTitle')}
        </CardTitle>
        <CardDescription>{t('shareDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {ringkasan.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noSalesman')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colSalesman')}</TableHead>
                <TableHead className="text-right">{t('colStoresHeld')}</TableHead>
                <TableHead>{t('colAreas')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ringkasan.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/backoffice/stores?sales=${encodeURIComponent(s.id)}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {s.nama}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.jumlah}</TableCell>
                  <TableCell className="whitespace-normal text-sm text-muted-foreground">
                    {s.area.length ? s.area.join(', ') : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {tanpaPemegang > 0 ? (
          <p className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            <span>
              {t('storesWithoutHolder', { count: tanpaPemegang })}{' '}
              <Link href="/backoffice/stores?sales=TANPA" className="font-medium underline underline-offset-4">
                {t('storesWithoutHolderLink')}
              </Link>
            </span>
          </p>
        ) : null}

        <Button asChild variant="outline">
          <Link href="/backoffice/stores">
            {t('openStoreMaster')}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>

        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <Label htmlFor="kunci-toko" className="text-sm font-medium">
              {t('lockTitle')}
            </Label>
            <p className="text-sm text-muted-foreground">{terkunci ? t('lockOnDesc') : t('lockOffDesc')}</p>
          </div>
          <Switch
            id="kunci-toko"
            checked={terkunci}
            onCheckedChange={ubahSaklar}
            disabled={!bolehUbah || sibuk}
          />
        </div>
      </CardContent>

      <AlertDialog open={konfirmasi} onOpenChange={setKonfirmasi}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('lockConfirmTitle', { count: tanpaPemegang })}</AlertDialogTitle>
            <AlertDialogDescription>{t('lockConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('lockConfirmCancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setKonfirmasi(false);
                simpan(true);
              }}
            >
              {t('lockConfirmGo')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

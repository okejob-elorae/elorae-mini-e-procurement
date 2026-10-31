'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CalendarCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { dinamis } from '@/lib/i18n/dinamis';
import type { BarisPiutang } from '@/lib/receivables/queries';
import type { KeadaanPiutang } from '@/lib/receivables/rules';

import { TautanKembali } from "@/app/pwa/TautanKembali";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";
const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Jakarta',
      })
    : '—';

const NADA: Record<KeadaanPiutang, string> = {
  lewat: 'bg-destructive/10 text-red-800 dark:text-red-300',
  tertahan: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  klaim: 'bg-primary/15 text-foreground',
  tt: 'bg-muted text-muted-foreground',
  belum: 'bg-primary/15 text-foreground',
  lunas: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
};

/** Kontrabon berjalan di toko ini; tanggal dan uang sudah diformat di server. */
export type JanjiTampil = {
  id: string;
  docNo: string;
  tanggalJanji: string;
  nilai: string;
  jumlahFaktur: number;
  receivedBy: string | null;
  dariLapangan: boolean;
  dikonfirmasi: boolean;
};

export function FakturTokoClient({
  storeId,
  storeName,
  baris,
  bisaJanji,
  janji,
}: {
  storeId: string;
  storeName: string;
  baris: BarisPiutang[];
  /** Ada faktur yang masih bisa dijanjikan (bersisa, belum dikontrabon). */
  bisaJanji: boolean;
  janji: JanjiTampil[];
}) {
  const t = useTranslations('pwaPiutang');
  const td = dinamis(t);
  const sisa = baris.reduce((s, b) => s + b.outstanding, 0);

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan="/pwa/piutang" />
      </Button>

      <header className="space-y-1">
        <div className="flex items-center gap-1">
          <h1 className="min-w-0 break-words text-xl font-bold leading-tight">{storeName}</h1>
          <TombolBantuanHp judul={storeName} />
        </div>
        <p className="text-sm text-muted-foreground">
          {/* Hitungan = faktur yang masih bersisa, sama dengan daftar Tagihan.
              Faktur yang sudah lunas tetap terdaftar di bawah. */}
          {t('summaryStore', { count: baris.filter((b) => b.outstanding > 0).length || baris.length, value: rupiah(sisa) })}
        </p>
      </header>

      {/* Janji bayar / tukar faktur dicatat di depan toko, saat lembarnya
          ditandatangani — bukan menunggu kantor menyusun kontrabon. */}
      {bisaJanji && (
        <Button asChild className="w-full">
          <Link href={`/pwa/piutang/${storeId}/janji`}>
            <CalendarCheck className="mr-1.5 h-4 w-4" />
            {t('addPromise')}
          </Link>
        </Button>
      )}

      {janji.length > 0 && (
        <section className="beranda-kartu beranda-kartu-daftar" aria-labelledby="janji-berjalan-judul">
          <div className="px-4 pb-3 pt-4">
            <h2 id="janji-berjalan-judul" className="beranda-judul">
              {t('promisesTitle')}
            </h2>
          </div>
          <ul className="divide-y border-t">
            {janji.map((j) => (
              <li key={j.id} className="flex min-h-14 items-start justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block font-semibold">{j.docNo}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('promiseLine', { date: j.tanggalJanji, count: j.jumlahFaktur })}
                    {j.receivedBy && ` · ${t('promiseReceivedBy', { name: j.receivedBy })}`}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-semibold tabular-nums">{j.nilai}</span>
                  {j.dariLapangan && (
                    <Badge
                      variant="outline"
                      className={cn(
                        j.dikonfirmasi
                          ? 'text-muted-foreground'
                          : 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
                      )}
                    >
                      {j.dikonfirmasi ? t('promiseConfirmed') : t('promiseUnconfirmed')}
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="anim-stagger space-y-3">
        {baris.map((b) => (
          <Card key={b.id} className="py-0">
            <CardContent className="space-y-2 py-4">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-semibold">{b.invoiceNo}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('due', { date: tanggal(b.dueDate) })}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-bold tabular-nums">{rupiah(b.outstanding)}</span>
                  {b.outstanding !== b.amount && (
                    <span className="block text-xs text-muted-foreground line-through tabular-nums">
                      {rupiah(b.amount)}
                    </span>
                  )}
                </span>
              </div>
              <p className={cn('rounded-lg px-3 py-2 text-sm leading-relaxed', NADA[b.keadaan])}>
                {td(`why_${b.keadaan}`, {
                  value: rupiah(b.alasan.nilaiTertahan ?? 0),
                  doc: b.alasan.noKlaim ?? b.alasan.noKontrabon ?? '—',
                  date: tanggal(b.alasan.janjiBayar),
                  days: b.alasan.hariTerlambat ?? 0,
                })}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

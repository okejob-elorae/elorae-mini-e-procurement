'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, ImageIcon, PackageCheck, PackageX, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/date-only';
import { KeputusanPemilikGrn } from '@/components/grn/KeputusanPemilikGrn';
import { JurnalGrnPanel } from '@/components/grn/JurnalGrnPanel';
import { TAUTAN_DOKUMEN } from '@/app/backoffice/purchase-orders/tautan-dokumen';
import type { RincianGRN } from '@/app/actions/grn';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`;
const angka = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 });

export function RincianGrnClient({ grn }: { grn: RincianGRN | null }) {
  const t = useTranslations('inventory.grnRincian');
  const tp = useTranslations('inventory.page');
  const tTable = useTranslations('tableHeaders');
  const tStatus = useTranslations('vendorReturnsList');
  const locale = useLocale();
  const router = useRouter();
  const { data: session } = useSession();
  const perms = session?.user?.permissions ?? [];
  const pemilik = perms.includes('*');
  // Tautan hanya ke halaman yang boleh dibuka; selain itu nomornya teks biasa.
  const bolehBukaPo = hasPermission(perms, PERMISSIONS.PURCHASE_ORDERS_VIEW);
  const bolehBukaRetur = hasPermission(perms, PERMISSIONS.VENDOR_RETURNS_VIEW);
  const bolehBuatRetur = hasPermission(perms, PERMISSIONS.VENDOR_RETURNS_CREATE);

  const kembali = (
    <Button variant="ghost" size="icon" asChild>
      <Link href="/backoffice/inventory?tab=grn" aria-label={t('kembali')} title={t('kembali')}>
        <ArrowLeft className="h-4 w-4" />
      </Link>
    </Button>
  );

  if (!grn) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          {kembali}
          <PageHeader title={t('judulKosong')} />
        </div>
        <Card>
          <CardContent>
            <EmptyState icon={PackageX} title={t('tidakDitemukan')} description={t('tidakDitemukanIsi')} />
          </CardContent>
        </Card>
      </div>
    );
  }

  const keadaan = grn.pemilik.keadaan;
  const totalQty = grn.baris.reduce((s, b) => s + b.qty, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        {kembali}
        <PageHeader
          className="flex-1"
          title={grn.docNumber}
          meta={`${grn.supplier.name} · ${formatDisplayDate(grn.grnDate, locale)}`}
          actions={
            <>
              {keadaan === 'menunggu' && (
                <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                  {tp('awaitingOwnerApproval')}
                </Badge>
              )}
              {keadaan === 'disetujui' && <Badge variant="secondary">{tp('ownerApproved')}</Badge>}
              {keadaan === 'ditolak' && (
                <Badge variant="outline" className="border-destructive/50 text-destructive">
                  {tp('declinedByOwner')}
                </Badge>
              )}
              {/* Jalan pintas: retur barang GRN ini ke pemasoknya, pemasok dan barang terisi. */}
              {bolehBuatRetur && keadaan !== 'ditolak' && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/backoffice/vendor-returns/new?grnId=${encodeURIComponent(grn.id)}`}>
                    <Undo2 className="mr-2 h-4 w-4" />
                    {t('returKePemasok')}
                  </Link>
                </Button>
              )}
            </>
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('ringkasan')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">{t('pemasok')}</p>
            <p className="font-medium">
              {grn.supplier.name} <span className="text-muted-foreground">({grn.supplier.code})</span>
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('po')}</p>
            {grn.po && bolehBukaPo ? (
              <Link href={`/backoffice/purchase-orders/${grn.po.id}`} className={TAUTAN_DOKUMEN}>
                {grn.po.docNumber}
              </Link>
            ) : grn.po ? (
              <p className="font-medium">{grn.po.docNumber}</p>
            ) : (
              <p className="font-medium">{t('tanpaPo')}</p>
            )}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('tanggal')}</p>
            <p className="font-medium">{formatDisplayDateTime(grn.createdAt, locale)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('penerima')}</p>
            <p className="font-medium">{grn.penerima ?? '—'}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('nilai')}</p>
            <p className="text-lg font-semibold tabular-nums">{rp(grn.totalAmount)}</p>
            {grn.ppnAmount ? (
              <p className="text-xs text-muted-foreground">{t('ppnMasukan', { ppn: rp(grn.ppnAmount), hutang: rp(grn.totalAmount + grn.ppnAmount) })}</p>
            ) : null}
          </div>
          {grn.notes && (
            <div className="sm:col-span-2 xl:col-span-3">
              <p className="text-sm text-muted-foreground">{t('catatan')}</p>
              <p className="whitespace-pre-wrap break-words">{grn.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {keadaan !== null && (
        <Card>
          <CardHeader>
            <CardTitle>{t('lebihTerima')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {keadaan === 'menunggu' ? (
              <>
                <p className="text-sm">{t('menungguIsi')}</p>
                {pemilik ? (
                  <KeputusanPemilikGrn grnId={grn.id} docNumber={grn.docNumber} onSelesai={() => router.refresh()} />
                ) : (
                  <p className="text-sm text-muted-foreground">{t('hanyaPemilik')}</p>
                )}
              </>
            ) : (
              <p className="text-sm">
                {t(keadaan === 'disetujui' ? 'disetujuiOleh' : 'ditolakOleh', {
                  waktu: grn.pemilik.waktu ? formatDisplayDateTime(grn.pemilik.waktu, locale) : '—',
                  nama: grn.pemilik.oleh ?? '—',
                })}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" />
            {t('barangDiterima')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {grn.baris.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('tanpaBaris')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tTable('item')}</TableHead>
                    <TableHead>{t('colVarian')}</TableHead>
                    <TableHead className="text-right">{tTable('qty')}</TableHead>
                    <TableHead className="text-right">{t('colHarga')}</TableHead>
                    <TableHead className="text-right">{t('colTotal')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grn.baris.map((b, i) => (
                    <TableRow key={`${b.itemId}-${b.varianSku ?? ''}-${i}`}>
                      <TableCell className="min-w-[200px] whitespace-normal">
                        <Link
                          href={`/backoffice/inventory/stock-card?itemId=${encodeURIComponent(b.itemId)}`}
                          className={TAUTAN_DOKUMEN}
                        >
                          {b.sku}
                        </Link>
                        {b.nama && <p className="text-sm text-muted-foreground">{b.nama}</p>}
                        {b.jumlahRoll > 0 && (
                          <p className="text-xs text-muted-foreground">{t('jumlahRoll', { count: b.jumlahRoll })}</p>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-normal text-sm">
                        {b.varianSku ? (
                          <>
                            <span>{b.varianSku}</span>
                            {b.varianLabel && <p className="text-xs text-muted-foreground">{b.varianLabel}</p>}
                          </>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {angka(b.qty)} {b.satuan}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{rp(b.hargaSatuan)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rp(b.total)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={2} className="font-medium">
                      {t('total')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{angka(totalQty)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums font-semibold">{rp(grn.totalAmount)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {grn.rolls.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{tp('rollsInGrn')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tTable('rollCode')}</TableHead>
                    <TableHead>{tTable('ref')}</TableHead>
                    <TableHead>{tTable('item')}</TableHead>
                    <TableHead className="text-right">{tTable('initial')}</TableHead>
                    <TableHead className="text-right">{tTable('remaining')}</TableHead>
                    <TableHead>{tTable('status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grn.rolls.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-sm">{r.rollCode}</TableCell>
                      <TableCell>{r.rollRef}</TableCell>
                      <TableCell className="whitespace-normal">
                        {r.item.sku} – {r.item.nameId}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {angka(r.initialLength)} {r.uom.code}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {angka(r.remainingLength)} {r.uom.code}
                      </TableCell>
                      <TableCell>
                        {r.isClosed ? (
                          <Badge variant="secondary">{tp('rollClosed')}</Badge>
                        ) : (
                          <Badge variant="default">{tp('rollOpen')}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5" />
            {t('foto')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {grn.foto.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('tanpaFoto')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {grn.foto.map((url, i) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block aspect-square overflow-hidden rounded-md border bg-muted"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- foto bukti dari penyimpanan, ukuran bebas */}
                  <img src={url} alt={t('fotoKe', { index: i + 1 })} className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('jurnal')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <JurnalGrnPanel grnId={grn.id} ditolak={keadaan === 'ditolak'} />
          {grn.returPemasok.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{t('returPemasok')}</p>
              <ul className="space-y-1 text-sm">
                {grn.returPemasok.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    {bolehBukaRetur ? (
                      <Link href={`/backoffice/vendor-returns/${r.id}`} className={TAUTAN_DOKUMEN}>
                        {r.docNumber}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.docNumber}</span>
                    )}
                    <Badge variant="outline">
                      {r.status === 'DRAFT'
                        ? tStatus('statusDraft')
                        : r.status === 'PROCESSED'
                          ? tStatus('statusProcessed')
                          : tStatus('statusCompleted')}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

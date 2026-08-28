'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Folder, FolderOpen, LayoutGrid, List, Search, Warehouse } from 'lucide-react';
import { FolderGlyph } from '@/components/archive/FolderGlyph';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { FolderArsip, IsiArsip } from '@/lib/receivables/return-queries';
import { NADA_LANGKAH } from '../retur-toko/langkah';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

export function ArsipClient({
  folder,
  isi,
  dibuka,
  tampilan,
}: {
  folder: FolderArsip[];
  isi: IsiArsip[];
  dibuka: string | null | undefined;
  tampilan: 'ikon' | 'daftar';
}) {
  const t = useTranslations('arsipRetur');
  const [cari, setCari] = useState('');

  const terlihat = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (!q) return folder;
    return folder.filter((f) => (f.storeName ?? t('orphanFolder')).toLowerCase().includes(q));
  }, [folder, cari, t]);

  const total = folder.reduce((s, f) => s + f.jumlah, 0);
  const yatim = folder.find((f) => f.storeId === null)?.jumlah ?? 0;

  if (dibuka !== undefined) {
    const namaFolder =
      dibuka === null
        ? t('orphanFolder')
        : (folder.find((f) => f.storeId === dibuka)?.storeName ?? t('unknownFolder'));

    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/backoffice/arsip-retur">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {t('backToFolders')}
          </Link>
        </Button>

        <PageHeader
          title={namaFolder}
          description={t('folderBody', { count: isi.length })}
          actions={
            <SaklarTampilan
              tampilan={tampilan}
              hrefIkon={`/backoffice/arsip-retur?toko=${dibuka ?? 'yatim'}`}
              hrefDaftar={`/backoffice/arsip-retur?toko=${dibuka ?? 'yatim'}&v=daftar`}
              t={t}
            />
          }
        />

        {isi.length === 0 ? (
          <Card>
            <CardContent className="p-0">
              <EmptyState icon={FolderOpen} title={t('emptyFolderTitle')} description={t('emptyFolderBody')} />
            </CardContent>
          </Card>
        ) : tampilan === 'daftar' ? (
          <Card>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('colNote')}</TableHead>
                      <TableHead>{t('colDate')}</TableHead>
                      <TableHead className="text-right">{t('colValue')}</TableHead>
                      <TableHead>{t('colState')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isi.map((n) => (
                      <TableRow key={n.id}>
                        <TableCell>
                          {n.jenis === 'NRT' ? (
                            <Link
                              href={`/backoffice/retur-toko/${n.id}`}
                              className="font-medium text-primary underline-offset-2 hover:underline"
                            >
                              {n.nomor}
                            </Link>
                          ) : (
                            <span className="font-medium">{n.nomor}</span>
                          )}
                        </TableCell>
                        <TableCell>{tanggal(n.tanggal)}</TableCell>
                        <TableCell className="text-right tabular-nums">{rupiah(n.nilai)}</TableCell>
                        <TableCell>
                          <StatusPill tone={NADA_LANGKAH[n.langkah]}>
                            {t(`step${n.langkah.charAt(0).toUpperCase()}${n.langkah.slice(1)}` as never)}
                          </StatusPill>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="anim-stagger grid grid-cols-2 gap-6 py-6 sm:grid-cols-3 lg:grid-cols-5">
              {isi.map((n) => (
                <IkonNota key={n.id} nota={n} t={t} />
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        meta={t('summary', { count: total, orphan: yatim })}
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-56 pl-8"
            />
          </div>
        }
      />

      <Card>
        <CardContent className="anim-stagger grid grid-cols-2 gap-6 py-6 sm:grid-cols-3 lg:grid-cols-6">
          {terlihat.map((f) => (
            <Link
              key={f.storeId ?? 'yatim'}
              href={`/backoffice/arsip-retur?toko=${f.storeId ?? 'yatim'}`}
              className="group flex flex-col items-center gap-2 rounded-lg p-2 text-center transition-colors hover:bg-muted/60"
            >
              <span className="relative">
                {f.storeId === null ? (
                  <Warehouse className="h-14 w-14 text-amber-600 dark:text-amber-500" />
                ) : (
                  /* Folder yang sama dengan arsip dokumen. Sebelumnya di sini
                     ikon garis lucide berwarna `text-primary` — garis tipis
                     dalam warna tema pucat hampir tak terlihat di atas krem,
                     masalah yang sama dengan folder terisi di layar sebelah. */
                  <FolderGlyph
                    empty={f.jumlah === 0}
                    pending={0}
                    className="h-14 w-[4.2rem] transition-transform group-hover:scale-105"
                  />
                )}
                {f.jumlah > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-[11px] font-semibold tabular-nums text-background">
                    {f.jumlah}
                  </span>
                )}
                {/* Titik merah = ada nota di dalamnya yang masih menggantung. */}
                {f.menggantung && (
                  <span
                    className="absolute -bottom-0.5 right-1 h-3.5 w-3.5 rounded-full bg-destructive ring-2 ring-background"
                    aria-label={t('hangingDot')}
                  />
                )}
              </span>
              <span className="text-sm font-medium leading-tight">
                {f.storeName ?? t('orphanFolder')}
              </span>
              <span className="text-xs text-muted-foreground">
                {f.jumlah === 0
                  ? t('empty')
                  : t('folderMeta', { count: f.jumlah, value: rupiah(f.nilai) })}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card className="border-primary/30 bg-primary/[0.03]">
        <CardContent className="py-4 text-sm leading-relaxed">
          {t.rich('hangingExplain', {
            tautan: (chunks) => (
              <Link
                href="/backoffice/retur-toko"
                className="text-primary underline underline-offset-2"
              >
                {chunks}
              </Link>
            ),
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function IkonNota({ nota, t }: { nota: IsiArsip; t: (k: string) => string }) {
  const isi = (
    <>
      <span className="relative block">
        <span
          className={cn(
            'flex h-28 w-full items-center justify-center overflow-hidden rounded-lg border bg-muted/40',
            nota.menggantung && 'border-destructive/50',
          )}
        >
          {nota.fotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={nota.fotoUrl} alt={nota.nomor} className="h-full w-full object-cover" />
          ) : (
            <Folder className="h-8 w-8 text-muted-foreground/50" />
          )}
        </span>
        {nota.menggantung && (
          <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-destructive ring-2 ring-background" />
        )}
      </span>
      {/* Nomor notanya dicetak besar — itulah yang dicari orang di arsip. */}
      <span className="block text-sm font-semibold leading-tight">{nota.nomor}</span>
      <span className="block text-xs text-muted-foreground">{tanggal(nota.tanggal)}</span>
      <span className="block text-xs tabular-nums text-muted-foreground">{rupiah(nota.nilai)}</span>
    </>
  );

  if (nota.jenis !== 'NRT') {
    return <span className="block space-y-1 text-center">{isi}</span>;
  }
  return (
    <Link
      href={`/backoffice/retur-toko/${nota.id}`}
      className="block space-y-1 rounded-lg p-2 text-center transition-colors hover:bg-muted/60"
    >
      {isi}
    </Link>
  );
}

function SaklarTampilan({
  tampilan,
  hrefIkon,
  hrefDaftar,
  t,
}: {
  tampilan: 'ikon' | 'daftar';
  hrefIkon: string;
  hrefDaftar: string;
  t: (k: string) => string;
}) {
  return (
    <span className="inline-flex overflow-hidden rounded-lg border">
      <Button
        variant={tampilan === 'ikon' ? 'secondary' : 'ghost'}
        size="sm"
        asChild
        className="rounded-none"
      >
        <Link href={hrefIkon}>
          <LayoutGrid className="mr-1.5 h-4 w-4" />
          {t('viewIcons')}
        </Link>
      </Button>
      <Button
        variant={tampilan === 'daftar' ? 'secondary' : 'ghost'}
        size="sm"
        asChild
        className="rounded-none"
      >
        <Link href={hrefDaftar}>
          <List className="mr-1.5 h-4 w-4" />
          {t('viewList')}
        </Link>
      </Button>
    </span>
  );
}

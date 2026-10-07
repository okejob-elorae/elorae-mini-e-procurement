'use client';

import { useState, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { CheckCircle, Edit, Eye, MessageCircle, MoreHorizontal, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CategoryBadge } from '@/components/ui/category-badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { PropsSorot } from '@/components/gerak/useSorotBaris';
import { formatDisplayDate } from '@/lib/date-only';
import { formatRupiah } from '@/lib/format/rupiah';
import { inisialPemasok } from '@/lib/suppliers/inisial';
import type { AktivitasBaris } from '@/lib/suppliers/aktivitas-queries';
import type { JenisTampilan } from '@/lib/tampilan/tampilan';
import { categoryToneClass } from '@/lib/ui/category-color';
import { cn } from '@/lib/utils';
import { bolehMemutuskan, type StatusPersetujuanPemasok } from './status-pemasok';

/*
 * Tiga cara melihat daftar pemasok yang SAMA (seperti Notion/Airtable):
 *  - Tabel: baris rapat untuk membandingkan dan mencari;
 *  - Galeri: kartu dengan lingkaran inisial berwarna menurut jenis;
 *  - Papan: kolom per jenis pemasok.
 * Datanya sama, aksinya sama (rincian, ubah, hapus, setujui/tolak, WhatsApp).
 */

export type BarisPemasok = {
  id: string;
  code: string;
  name: string;
  typeId: string;
  type?: { id: string; code: string; name: string } | null;
  phone: string | null;
  status?: StatusPersetujuanPemasok;
};

export type AksiTampilanPemasok = {
  buka: (s: BarisPemasok) => void;
  setujui: (s: BarisPemasok) => void;
  tolak: (s: BarisPemasok) => void;
  ubah: ((s: BarisPemasok) => void) | null;
  hapus: ((s: BarisPemasok) => void) | null;
};

type Props = {
  tampilan: JenisTampilan;
  pemasok: readonly BarisPemasok[];
  /** null = masih dimuat. */
  aktivitas: Record<string, AktivitasBaris> | null;
  jenis: readonly { id: string; name: string }[];
  izin: string[];
  sibuk: boolean;
  sorot: (id: string) => PropsSorot;
  aksi: AksiTampilanPemasok;
};

export function TampilanPemasok(props: Props) {
  if (props.tampilan === 'galeri') return <GaleriPemasok {...props} />;
  if (props.tampilan === 'papan') return <PapanPemasok {...props} />;
  return <TabelPemasok {...props} />;
}

// ─── Bagian bersama ────────────────────────────────────────────────────────

function Avatar({ s, besar, className }: { s: BarisPemasok; besar?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-1 ring-inset',
        categoryToneClass(s.type?.name),
        besar ? 'h-10 w-10 text-sm' : 'h-9 w-9 text-xs',
        className,
      )}
    >
      {inisialPemasok(s.name)}
    </span>
  );
}

function CatatanPersetujuan({ s }: { s: BarisPemasok }) {
  const t = useTranslations('supplier');
  if (!s.status || s.status === 'ACTIVE') return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        s.status === 'PENDING_APPROVAL'
          ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
          : 'bg-destructive/10 text-destructive',
      )}
    >
      {s.status === 'PENDING_APPROVAL' ? t('statusPendingApproval') : t('statusRejected')}
    </span>
  );
}

/** "Sedang dikerjakan": PO terbuka (kain/aksesoris) dan SPK berjalan (penjahit). */
function SedangDikerjakan({ a, ringkas }: { a: AktivitasBaris | undefined; ringkas?: boolean }) {
  const t = useTranslations('supplier');
  if (!a) return <span className="text-muted-foreground">…</span>;
  const baris: ReactNode[] = [];
  if (a.spk && a.spk.berjalan > 0) {
    baris.push(
      <div key="spk">
        <span>{t('workSpk', { count: a.spk.berjalan, pcs: a.spk.pcs.toLocaleString('id-ID') })}</span>
        {a.spk.terlambat > 0 ? (
          <span className="block text-xs text-destructive">{t('workSpkLate', { count: a.spk.terlambat })}</span>
        ) : null}
      </div>,
    );
  }
  if (a.po && a.po.terbuka > 0) {
    baris.push(
      <div key="po">
        <span>{t('workPo', { count: a.po.terbuka })}</span>
        {a.po.terlambat > 0 ? (
          <span className="block text-xs text-destructive">{t('workPoLate', { count: a.po.terlambat })}</span>
        ) : a.po.tibaTerdekat && !ringkas ? (
          <span className="block text-xs text-muted-foreground">
            {t('workArrives', { date: formatDisplayDate(a.po.tibaTerdekat) })}
          </span>
        ) : null}
      </div>,
    );
  }
  if (baris.length === 0) return <span className="text-muted-foreground">{t('workNone')}</span>;
  return <div className="space-y-1">{baris}</div>;
}

function Utang({ a }: { a: AktivitasBaris | undefined }) {
  const t = useTranslations('supplier');
  if (!a?.utang) return <span className="text-muted-foreground">…</span>;
  if (a.utang.nilai <= 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div>
      <span className="tabular-nums">{formatRupiah(a.utang.nilai)}</span>
      {a.utang.jatuhTempo ? (
        <span
          className={cn('block text-xs', a.utang.lewatTempo ? 'text-destructive' : 'text-muted-foreground')}
        >
          {a.utang.lewatTempo
            ? t('payableOverdue', { date: formatDisplayDate(a.utang.jatuhTempo) })
            : t('payableDue', { date: formatDisplayDate(a.utang.jatuhTempo) })}
        </span>
      ) : null}
    </div>
  );
}

function Terakhir({ a }: { a: AktivitasBaris | undefined }) {
  const t = useTranslations('supplier');
  const format = useFormatter();
  // "Sekarang" dibekukan sekali per tampilan supaya teks tidak bergeser saat render ulang.
  const [sekarang] = useState(() => Date.now());
  if (!a) return <span className="text-muted-foreground">…</span>;
  if (!a.terakhir) return <span className="text-muted-foreground">{t('lastNever')}</span>;
  return (
    <span className="text-muted-foreground" title={formatDisplayDate(a.terakhir)}>
      {format.relativeTime(new Date(a.terakhir), sekarang)}
    </span>
  );
}

function TombolWa({ a, s }: { a: AktivitasBaris | undefined; s: BarisPemasok }) {
  const t = useTranslations('supplier');
  if (!a?.wa) return null;
  return (
    <Button asChild variant="ghost" size="icon" title={t('waChat', { name: s.name })}>
      <a href={a.wa} target="_blank" rel="noopener noreferrer" aria-label={t('waChat', { name: s.name })}>
        <MessageCircle className="h-4 w-4" />
      </a>
    </Button>
  );
}

function MenuBaris({ s, aksi }: { s: BarisPemasok; aksi: AksiTampilanPemasok }) {
  const t = useTranslations('supplier');
  const tUi = useTranslations('ui');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('cardMenu', { name: s.name })}
          title={t('cardMenu', { name: s.name })}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => aksi.buka(s)}>
          <Eye className="mr-2 h-4 w-4" />
          {t('viewDetails')}
        </DropdownMenuItem>
        {aksi.ubah ? (
          <DropdownMenuItem onClick={() => aksi.ubah?.(s)}>
            <Edit className="mr-2 h-4 w-4" />
            {tUi('edit')}
          </DropdownMenuItem>
        ) : null}
        {aksi.hapus ? (
          <DropdownMenuItem className="text-destructive" onClick={() => aksi.hapus?.(s)}>
            <Trash2 className="mr-2 h-4 w-4" />
            {tUi('delete')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TombolPutusan({ s, izin, sibuk, aksi, kecil }: { s: BarisPemasok; izin: string[]; sibuk: boolean; aksi: AksiTampilanPemasok; kecil?: boolean }) {
  const t = useTranslations('supplier');
  if (!bolehMemutuskan(s.status, izin)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" onClick={() => aksi.setujui(s)} disabled={sibuk}>
        <CheckCircle className="h-4 w-4" />
        {kecil ? null : t('approve')}
        {kecil ? <span className="sr-only">{t('approve')}</span> : null}
      </Button>
      <Button size="sm" variant="outline" onClick={() => aksi.tolak(s)} disabled={sibuk}>
        <XCircle className="h-4 w-4" />
        {kecil ? null : t('reject')}
        {kecil ? <span className="sr-only">{t('reject')}</span> : null}
      </Button>
    </div>
  );
}

/** Kolom pekerjaan/utang hanya muncul untuk yang boleh melihat layar asalnya. */
function kolomTerlihat(aktivitas: Record<string, AktivitasBaris> | null) {
  if (!aktivitas) return { kerja: true, utang: true };
  const isi = Object.values(aktivitas);
  if (isi.length === 0) return { kerja: true, utang: true };
  return { kerja: isi.some((a) => a.po || a.spk), utang: isi.some((a) => a.utang) };
}

// ─── Tabel ─────────────────────────────────────────────────────────────────

function TabelPemasok({ pemasok, aktivitas, izin, sibuk, sorot, aksi }: Props) {
  const t = useTranslations('supplier');
  const kolom = kolomTerlihat(aktivitas);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('colSupplier')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('colType')}</TableHead>
            {kolom.kerja ? <TableHead>{t('colWork')}</TableHead> : null}
            {kolom.utang ? <TableHead className="hidden lg:table-cell">{t('colPayable')}</TableHead> : null}
            <TableHead className="hidden xl:table-cell">{t('colLast')}</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">{t('colActions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="baris-berurutan">
          {pemasok.map((s) => {
            const a = aktivitas?.[s.id];
            return (
              <TableRow key={s.id} {...sorot(s.id)} className="group">
                <TableCell className="min-w-[14rem] whitespace-normal">
                  <div className="flex items-center gap-3">
                    <Avatar s={s} />
                    <div className="min-w-0">
                      <button
                        type="button"
                        className="text-left font-medium hover:underline underline-offset-4"
                        onClick={() => aksi.buka(s)}
                      >
                        {s.name}
                      </button>
                      <p className="font-mono text-xs text-muted-foreground">{s.code}</p>
                      <div className="mt-1 flex flex-wrap gap-1 md:hidden">
                        <CategoryBadge label={s.type?.name} />
                      </div>
                      <CatatanPersetujuan s={s} />
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <CategoryBadge label={s.type?.name} />
                </TableCell>
                {kolom.kerja ? (
                  <TableCell className="whitespace-normal text-sm">
                    <SedangDikerjakan a={a} />
                  </TableCell>
                ) : null}
                {kolom.utang ? (
                  <TableCell className="hidden whitespace-normal text-sm lg:table-cell">
                    <Utang a={a} />
                  </TableCell>
                ) : null}
                <TableCell className="hidden text-sm xl:table-cell">
                  <Terakhir a={a} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <TombolPutusan s={s} izin={izin} sibuk={sibuk} aksi={aksi} />
                    <TombolWa a={a} s={s} />
                    <MenuBaris s={s} aksi={aksi} />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Galeri ────────────────────────────────────────────────────────────────

function KartuPemasok({ s, a, izin, sibuk, aksi, sorotProps, kolom }: {
  s: BarisPemasok;
  a: AktivitasBaris | undefined;
  izin: string[];
  sibuk: boolean;
  aksi: AksiTampilanPemasok;
  sorotProps: PropsSorot;
  kolom: { kerja: boolean; utang: boolean };
}) {
  const t = useTranslations('supplier');
  return (
    <div
      {...sorotProps}
      role="button"
      tabIndex={0}
      onClick={() => aksi.buka(s)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          aksi.buka(s);
        }
      }}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card text-left transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className={cn('flex h-12 items-center justify-center', categoryToneClass(s.type?.name), 'ring-0')}>
        <Avatar s={s} besar className="bg-background shadow-sm" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="line-clamp-2 break-words font-medium leading-snug" title={s.name}>{s.name}</p>
            <p className="font-mono text-xs text-muted-foreground">{s.code}</p>
          </div>
          <div className="-mr-2 -mt-1.5 flex shrink-0" onClick={(e) => e.stopPropagation()}>
            <TombolWa a={a} s={s} />
            <MenuBaris s={s} aksi={aksi} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryBadge label={s.type?.name} />
          <CatatanPersetujuan s={s} />
        </div>
        <dl className="space-y-1 text-xs">
          {kolom.kerja ? (
            <div>
              <dt className="text-xs text-muted-foreground">{t('colWork')}</dt>
              <dd>
                <SedangDikerjakan a={a} ringkas />
              </dd>
            </div>
          ) : null}
          {kolom.utang && a?.utang && a.utang.nilai > 0 ? (
            <div>
              <dt className="text-xs text-muted-foreground">{t('colPayable')}</dt>
              <dd>
                <Utang a={a} />
              </dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">{t('colLast')}</span>
            <Terakhir a={a} />
          </div>
        </dl>
        <div className="mt-auto pt-1">
          <TombolPutusan s={s} izin={izin} sibuk={sibuk} aksi={aksi} />
        </div>
      </div>
    </div>
  );
}

function GaleriPemasok({ pemasok, aktivitas, izin, sibuk, sorot, aksi }: Props) {
  const kolom = kolomTerlihat(aktivitas);
  return (
    <div className="baris-berurutan grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
      {pemasok.map((s) => (
        <KartuPemasok
          key={s.id}
          s={s}
          a={aktivitas?.[s.id]}
          izin={izin}
          sibuk={sibuk}
          aksi={aksi}
          sorotProps={sorot(s.id)}
          kolom={kolom}
        />
      ))}
    </div>
  );
}

// ─── Papan ─────────────────────────────────────────────────────────────────

function PapanPemasok({ pemasok, aktivitas, jenis, izin, sibuk, sorot, aksi }: Props) {
  const t = useTranslations('supplier');
  // Kolom mengikuti urutan jenis pemasok; jenis tanpa pemasok tidak ditampilkan,
  // jenis yang tidak ada di daftar jenis aktif tetap mendapat kolom di ujung.
  const perJenis = new Map<string, BarisPemasok[]>();
  for (const s of pemasok) {
    const daftar = perJenis.get(s.typeId);
    if (daftar) daftar.push(s);
    else perJenis.set(s.typeId, [s]);
  }
  const urutan = [
    ...jenis.filter((j) => perJenis.has(j.id)).map((j) => ({ id: j.id, name: j.name })),
    ...[...perJenis.keys()]
      .filter((id) => !jenis.some((j) => j.id === id))
      .map((id) => ({ id, name: perJenis.get(id)?.[0]?.type?.name ?? t('typeFilter') })),
  ];
  return (
    <div className="-mx-1 overflow-x-auto pb-2">
      <div className="flex gap-4 px-1">
        {urutan.map((kol) => {
          const isi = perJenis.get(kol.id) ?? [];
          return (
            <section key={kol.id} aria-label={kol.name} className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/60 p-2">
              <header className="flex items-center justify-between px-1 py-1">
                <CategoryBadge label={kol.name} />
                <span className="text-xs tabular-nums text-muted-foreground">{isi.length}</span>
              </header>
              {isi.map((s) => {
                const a = aktivitas?.[s.id];
                return (
                  <div
                    key={s.id}
                    {...sorot(s.id)}
                    role="button"
                    tabIndex={0}
                    onClick={() => aksi.buka(s)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        aksi.buka(s);
                      }
                    }}
                    className="cursor-pointer rounded-lg border bg-card p-3 text-sm transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-start gap-2">
                      <Avatar s={s} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-snug">{s.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{s.code}</p>
                      </div>
                      <div className="-mr-1 -mt-1 flex" onClick={(e) => e.stopPropagation()}>
                        <TombolWa a={a} s={s} />
                      </div>
                    </div>
                    <div className="mt-2 text-xs">
                      <SedangDikerjakan a={a} ringkas />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <CatatanPersetujuan s={s} />
                      <TombolPutusan s={s} izin={izin} sibuk={sibuk} aksi={aksi} kecil />
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}

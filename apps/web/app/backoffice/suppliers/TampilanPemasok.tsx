'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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
import { nomorTelepon, nomorWhatsApp } from '@/lib/salesman/dasbor';
import { inisialPemasok } from '@/lib/suppliers/inisial';
import type { JenisTampilan } from '@/lib/tampilan/tampilan';
import { nadaKategori } from '@/lib/ui/category-color';
import { formatDateOnlyJakarta } from '@/lib/date-only';
import { keadaanSkb } from '@/lib/finance/pajak/pemotongan';
import { hariIniWib, labelTanggal } from '@/lib/tanggal-isian';
import { cn } from '@/lib/utils';
import { bolehMemutuskan, type StatusPersetujuanPemasok } from './status-pemasok';

/*
 * Tiga cara melihat daftar pemasok yang SAMA (seperti Notion/Airtable):
 *  - Tabel: baris rapat untuk membandingkan dan mencari;
 *  - Galeri: kartu dengan lingkaran inisial berwarna menurut jenis;
 *  - Papan: kolom per jenis pemasok.
 * Datanya sama, aksinya sama (rincian, ubah, hapus, setujui/tolak, WhatsApp).
 *
 * Ini DATA MASTER: yang tampil hanya data tetap pemasok (kontak, pajak,
 * rekening, alamat). Progres pekerjaan (PO terbuka, SPK, utang) sengaja tidak
 * di sini — tempatnya Pesanan pembelian, Follow-up produksi, dan Pembayaran
 * pemasok (pemilik, 2026-10-08).
 */

export type BarisPemasok = {
  id: string;
  code: string;
  name: string;
  typeId: string;
  type?: { id: string; code: string; name: string; color?: string | null } | null;
  phone: string | null;
  email?: string | null;
  address?: string | null;
  bankName?: string | null;
  bankAccountName?: string | null;
  isPkp?: boolean | null;
  taxWithholding?: string | null;
  hasNpwp?: boolean;
  /** SKB bebas potong PPh (penjahit bukan badan usaha). Tanggal = hari WIB terakhir berlaku. */
  skbNumber?: string | null;
  skbValidUntil?: Date | string | null;
  status?: StatusPersetujuanPemasok;
  /** `false` = nonaktif: tidak ditawarkan di PO baru dan tidak tampil di papan Lead time. */
  isActive?: boolean;
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
  // Warna jenis pilihan pemilik (Jenis pemasok → Warna) bila ada; selain itu otomatis.
  const nada = nadaKategori(s.type?.name, s.type?.color);
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-1 ring-inset',
        nada.className,
        besar ? 'h-10 w-10 text-sm' : 'h-9 w-9 text-xs',
        className,
      )}
      style={nada.style}
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

/** Pemasok nonaktif terlihat di setiap tampilan — dulu tampil persis seperti yang aktif. */
function LencanaNonaktif({ s }: { s: BarisPemasok }) {
  const t = useTranslations('supplier');
  if (s.isActive !== false) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-muted-foreground/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {t('lencanaNonaktif')}
    </span>
  );
}

/** Telepon (tautan panggil) dan email; "Belum ada kontak" bila keduanya kosong. */
function Kontak({ s, ringkas }: { s: BarisPemasok; ringkas?: boolean }) {
  const t = useTranslations('supplier');
  const tel = nomorTelepon(s.phone);
  if (!s.phone && !s.email) return <span className="text-muted-foreground">{t('kontakKosong')}</span>;
  return (
    <div className="min-w-0 space-y-0.5">
      {s.phone ? (
        tel ? (
          <a href={`tel:${tel}`} className="block tabular-nums hover:underline underline-offset-4" title={t('teleponNama', { name: s.name })}>
            {s.phone}
          </a>
        ) : (
          <span className="block tabular-nums">{s.phone}</span>
        )
      ) : null}
      {s.email && !ringkas ? (
        <a href={`mailto:${s.email}`} className="block truncate text-xs text-muted-foreground hover:underline underline-offset-4" title={s.email}>
          {s.email}
        </a>
      ) : null}
    </div>
  );
}

const LABEL_POTONG: Record<string, string> = { PPH23: 'potongPph23', PPH21: 'potongPph21', PPH4_2: 'potongPph42' };

/** Hari WIB terakhir SKB berlaku ("YYYY-MM-DD"), dari Date atau teks ISO kiriman aksi. */
function hariSkb(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : formatDateOnlyJakarta(d);
}

/** Status PKP, NPWP, SKB, dan jenis potongan PPh pemasok — data master untuk pembelian & pembayaran. */
function Pajak({ s }: { s: BarisPemasok }) {
  const t = useTranslations('supplier');
  const locale = useLocale();
  const pkp = s.isPkp === true ? t('pajakPkp') : s.isPkp === false ? t('pajakNonPkp') : null;
  const potong = s.taxWithholding && LABEL_POTONG[s.taxWithholding] ? t(LABEL_POTONG[s.taxWithholding]) : null;
  const skb = keadaanSkb({ nomor: s.skbNumber ?? null, berlakuSampai: hariSkb(s.skbValidUntil) }, hariIniWib());
  return (
    <div className="space-y-0.5">
      <span className={cn('block', pkp ? '' : 'text-muted-foreground')}>{pkp ?? t('pajakPkpBelum')}</span>
      {potong || s.hasNpwp === false ? (
        <span className="block text-xs text-muted-foreground">
          {[potong, s.hasNpwp === false ? t('pajakTanpaNpwp') : null].filter(Boolean).join(' · ')}
        </span>
      ) : null}
      {skb ? (
        <span
          className={cn('block text-xs', skb.habis ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}
          title={skb.nomor}
        >
          {t(skb.habis ? 'skbHabisLabel' : 'skbBerlakuLabel', { tanggal: labelTanggal(skb.berlakuSampai, locale) })}
        </span>
      ) : null}
    </div>
  );
}

function Rekening({ s }: { s: BarisPemasok }) {
  const t = useTranslations('supplier');
  if (!s.bankName && !s.bankAccountName) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-0.5">
      <span className="block">{s.bankName ?? '—'}</span>
      {s.bankAccountName ? (
        <span className="block text-xs text-muted-foreground">{t('rekeningAtasNama', { nama: s.bankAccountName })}</span>
      ) : null}
    </div>
  );
}

function TombolWa({ s }: { s: BarisPemasok }) {
  const t = useTranslations('supplier');
  const n = nomorWhatsApp(s.phone);
  if (!n) return null;
  return (
    <Button asChild variant="ghost" size="icon" title={t('waChat', { name: s.name })}>
      <a href={`https://wa.me/${n}`} target="_blank" rel="noopener noreferrer" aria-label={t('waChat', { name: s.name })}>
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
      {/* Di papan tombolnya ikon saja: `title` memberi tooltip bagi tetikus. */}
      <Button
        size="sm"
        onClick={() => aksi.setujui(s)}
        disabled={sibuk}
        title={kecil ? t('setujuiNama', { name: s.name }) : undefined}
      >
        <CheckCircle aria-hidden className="h-4 w-4" />
        {kecil ? null : t('approve')}
        {kecil ? <span className="sr-only">{t('approve')}</span> : null}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => aksi.tolak(s)}
        disabled={sibuk}
        title={kecil ? t('tolakNama', { name: s.name }) : undefined}
      >
        <XCircle aria-hidden className="h-4 w-4" />
        {kecil ? null : t('reject')}
        {kecil ? <span className="sr-only">{t('reject')}</span> : null}
      </Button>
    </div>
  );
}

// ─── Tabel ─────────────────────────────────────────────────────────────────

function TabelPemasok({ pemasok, izin, sibuk, sorot, aksi }: Props) {
  const t = useTranslations('supplier');
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('colSupplier')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('colType')}</TableHead>
            <TableHead>{t('colContact')}</TableHead>
            <TableHead className="hidden xl:table-cell">{t('colPajak')}</TableHead>
            <TableHead className="hidden 2xl:table-cell">{t('colRekening')}</TableHead>
            <TableHead className="hidden 2xl:table-cell">{t('address')}</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">{t('colActions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="baris-berurutan">
          {pemasok.map((s) => {
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
                        <CategoryBadge label={s.type?.name} warna={s.type?.color} />
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <CatatanPersetujuan s={s} />
                        <LencanaNonaktif s={s} />
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <CategoryBadge label={s.type?.name} warna={s.type?.color} />
                </TableCell>
                <TableCell className="max-w-[16rem] whitespace-normal text-sm">
                  <Kontak s={s} />
                </TableCell>
                <TableCell className="hidden whitespace-normal text-sm xl:table-cell">
                  <Pajak s={s} />
                </TableCell>
                <TableCell className="hidden whitespace-normal text-sm 2xl:table-cell">
                  <Rekening s={s} />
                </TableCell>
                <TableCell className="hidden max-w-[16rem] whitespace-normal text-sm text-muted-foreground 2xl:table-cell">
                  <span className="line-clamp-2" title={s.address ?? undefined}>{s.address || '—'}</span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <TombolPutusan s={s} izin={izin} sibuk={sibuk} aksi={aksi} />
                    <TombolWa s={s} />
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

function KartuPemasok({ s, izin, sibuk, aksi, sorotProps }: {
  s: BarisPemasok;
  izin: string[];
  sibuk: boolean;
  aksi: AksiTampilanPemasok;
  sorotProps: PropsSorot;
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
      <div
        className={cn('flex h-12 items-center justify-center', nadaKategori(s.type?.name, s.type?.color).className, 'ring-0')}
        style={nadaKategori(s.type?.name, s.type?.color).style}
      >
        <Avatar s={s} besar className="bg-background shadow-sm" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="line-clamp-2 break-words font-medium leading-snug" title={s.name}>{s.name}</p>
            <p className="font-mono text-xs text-muted-foreground">{s.code}</p>
          </div>
          <div className="-mr-2 -mt-1.5 flex shrink-0" onClick={(e) => e.stopPropagation()}>
            <TombolWa s={s} />
            <MenuBaris s={s} aksi={aksi} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryBadge label={s.type?.name} warna={s.type?.color} />
          <CatatanPersetujuan s={s} />
          <LencanaNonaktif s={s} />
        </div>
        <dl className="space-y-1.5 text-xs">
          <div>
            <dt className="text-muted-foreground">{t('colContact')}</dt>
            <dd>
              <Kontak s={s} ringkas />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('colPajak')}</dt>
            <dd>
              <Pajak s={s} />
            </dd>
          </div>
        </dl>
        <div className="mt-auto pt-1">
          <TombolPutusan s={s} izin={izin} sibuk={sibuk} aksi={aksi} />
        </div>
      </div>
    </div>
  );
}

function GaleriPemasok({ pemasok, izin, sibuk, sorot, aksi }: Props) {
  return (
    <div className="baris-berurutan grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
      {pemasok.map((s) => (
        <KartuPemasok
          key={s.id}
          s={s}
          izin={izin}
          sibuk={sibuk}
          aksi={aksi}
          sorotProps={sorot(s.id)}
        />
      ))}
    </div>
  );
}

// ─── Papan ─────────────────────────────────────────────────────────────────

function PapanPemasok({ pemasok, jenis, izin, sibuk, sorot, aksi }: Props) {
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
    ...jenis
      .filter((j) => perJenis.has(j.id))
      .map((j) => ({ id: j.id, name: j.name, color: perJenis.get(j.id)?.[0]?.type?.color ?? null })),
    ...[...perJenis.keys()]
      .filter((id) => !jenis.some((j) => j.id === id))
      .map((id) => ({
        id,
        name: perJenis.get(id)?.[0]?.type?.name ?? t('typeFilter'),
        color: perJenis.get(id)?.[0]?.type?.color ?? null,
      })),
  ];
  return (
    <GulirPapan>
      <div className="flex gap-4 px-1">
        {urutan.map((kol) => {
          const isi = perJenis.get(kol.id) ?? [];
          return (
            <section key={kol.id} aria-label={kol.name} className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/60 p-2">
              <header className="flex items-center justify-between px-1 py-1">
                <CategoryBadge label={kol.name} warna={kol.color} />
                <span className="text-xs tabular-nums text-muted-foreground">{isi.length}</span>
              </header>
              {isi.map((s) => {
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
                        <TombolWa s={s} />
                      </div>
                    </div>
                    <div className="mt-2 text-xs">
                      <Kontak s={s} ringkas />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <CatatanPersetujuan s={s} />
                      <LencanaNonaktif s={s} />
                      <TombolPutusan s={s} izin={izin} sibuk={sibuk} aksi={aksi} kecil />
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </GulirPapan>
  );
}

/**
 * Wadah gulir samping papan, dengan tanda bahwa masih ada kolom di luar layar:
 * tepi yang memudar di sisi yang bisa digeser, dan satu kalimat petunjuk. Dulu
 * kolom keempat terpotong di 1440 px tanpa tanda apa pun.
 */
function GulirPapan({ children }: { children: ReactNode }) {
  const t = useTranslations('supplier');
  const wadah = useRef<HTMLDivElement>(null);
  const [tepi, setTepi] = useState({ kiri: false, kanan: false });
  useEffect(() => {
    const el = wadah.current;
    if (!el) return;
    const ukur = () => {
      const kiri = el.scrollLeft > 4;
      const kanan = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      setTepi((l) => (l.kiri === kiri && l.kanan === kanan ? l : { kiri, kanan }));
    };
    ukur();
    el.addEventListener('scroll', ukur, { passive: true });
    const amati = new ResizeObserver(ukur);
    amati.observe(el);
    if (el.firstElementChild) amati.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', ukur);
      amati.disconnect();
    };
  }, []);
  return (
    <div className="space-y-1.5">
      {tepi.kiri || tepi.kanan ? <p className="text-xs text-muted-foreground">{t('papanGeser')}</p> : null}
      <div className="relative">
        <div ref={wadah} className="-mx-1 overflow-x-auto pb-2">
          {children}
        </div>
        {tepi.kiri ? (
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent" />
        ) : null}
        {tepi.kanan ? (
          <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent" />
        ) : null}
      </div>
    </div>
  );
}

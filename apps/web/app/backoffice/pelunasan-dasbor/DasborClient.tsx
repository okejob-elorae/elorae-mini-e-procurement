'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Clock, PackageOpen, Scale, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import type { Dasbor, TindakanHariIni } from '@/lib/receivables/dashboard-queries';
import type { KeadaanPiutang } from '@/lib/receivables/rules';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const ringkas = (n: number) =>
  n >= 1_000_000_000
    ? `${(n / 1_000_000_000).toFixed(1).replace('.', ',')} M`
    : n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1).replace('.', ',')} jt`
      : n >= 1_000
        ? `${Math.round(n / 1_000)} rb`
        : String(Math.round(n));

const NADA_TINDAKAN: Record<TindakanHariIni['jenis'], StatusTone> = {
  lewat: 'attention',
  keputusan: 'attention',
  klaim: 'waiting',
  tertahan: 'attention',
  cek: 'waiting',
  jodoh: 'progress',
};

const NADA_KEADAAN: Record<KeadaanPiutang, StatusTone> = {
  lunas: 'settled',
  klaim: 'progress',
  tertahan: 'attention',
  lewat: 'attention',
  tt: 'waiting',
  belum: 'inactive',
};

export function DasborClient({ data }: { data: Dasbor }) {
  const t = useTranslations('dasborPelunasan');

  const puncakSales = Math.max(1, ...data.perSales.map((s) => s.nilai));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        meta={t('summary', { count: data.jumlahPiutang, value: rupiah(data.totalPiutang) })}
      />

      <div className="anim-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kartu
          ikon={Wallet}
          label={t('kpiTotal')}
          nilai={rupiah(data.totalPiutang)}
          kaki={t('kpiTotalFoot', { count: data.jumlahPiutang })}
          href="/backoffice/piutang"
        />
        <Kartu
          ikon={AlertTriangle}
          label={t('kpiOverdue')}
          nilai={rupiah(data.nilaiLewatTempo)}
          kaki={t('kpiOverdueFoot', { count: data.lewatTempo })}
          nada={data.lewatTempo > 0 ? 'text-destructive' : undefined}
          href="/backoffice/piutang"
        />
        <Kartu
          ikon={Clock}
          label={t('kpiAwaiting')}
          nilai={rupiah(data.nilaiMenungguVerifikasi)}
          kaki={t('kpiAwaitingFoot', { count: data.menungguVerifikasi })}
          href="/backoffice/pelunasan"
        />
        <Kartu
          ikon={PackageOpen}
          label={t('kpiHeld')}
          nilai={rupiah(data.tertahanRetur)}
          kaki={t('kpiHeldFoot', { count: data.returPerluDikerjakan })}
          nada={data.tertahanRetur > 0 ? 'text-amber-600 dark:text-amber-500' : undefined}
          href="/backoffice/retur-toko"
        />
        <Kartu
          ikon={Scale}
          label={t('kpiCharge')}
          nilai={rupiah(data.nilaiBebanTerbuka)}
          kaki={t('kpiChargeFoot', { count: data.bebanTerbuka })}
          href="/backoffice/beban-selisih"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('todoTitle')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('todoHint')}</p>
        </CardHeader>
        <CardContent className={data.tindakan.length === 0 ? 'p-0' : 'space-y-2'}>
          {data.tindakan.length === 0 ? (
            <EmptyState icon={Wallet} title={t('todoEmptyTitle')} description={t('todoEmptyBody')} />
          ) : (
            data.tindakan.map((a, i) => (
              <Link
                key={`${a.jenis}-${a.judul}-${i}`}
                href={a.tautan}
                className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/50"
              >
                <StatusPill tone={NADA_TINDAKAN[a.jenis]}>
                  {t(`todo_${a.jenis}` as never)}
                </StatusPill>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{a.judul}</span>
                  <span className="block text-xs text-muted-foreground">
                    {/* Kunci "hari ini" dipakai saat selisihnya nol — "0 hari
                        lalu" bukan bahasa Indonesia yang ditulis orang. */}
                    {(t as (k: string, v?: Record<string, string | number>) => string)(
                      a.konteks.hari === 0 ? `why_${a.jenis}_today` : `why_${a.jenis}`,
                      { toko: a.konteks.toko ?? '—', hari: a.konteks.hari ?? 0 },
                    )}
                  </span>
                </span>
                <span className="tabular-nums text-sm font-semibold">{rupiah(a.nilai)}</span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('perSalesTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.perSales.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('perSalesEmpty')}</p>
            ) : (
              data.perSales.map((s) => (
                <div key={s.nama} className="space-y-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{s.nama}</span>
                    <span className="tabular-nums">
                      {rupiah(s.nilai)}
                      {/* Titik pemisah: angka telanjang di sebelah nominal
                          rupiah terbaca sebagai bagian dari nominal itu. */}
                      <span className="ml-2 text-xs text-muted-foreground">
                        · {t('invoiceCount', { count: s.jumlah })}
                      </span>
                    </span>
                  </div>
                  {/* Batang perbandingan, bukan grafik: yang dicari mata adalah
                      siapa yang menonjol, bukan angka pastinya. */}
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(2, (s.nilai / puncakSales) * 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('perStateTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.perKeadaan.map((k) => (
              <div key={k.keadaan} className="flex flex-wrap items-center gap-3">
                <StatusPill tone={NADA_KEADAAN[k.keadaan]}>
                  {t(`state_${k.keadaan}` as never)}
                </StatusPill>
                <span className="flex-1 text-sm tabular-nums text-muted-foreground">
                  {t('invoiceCount', { count: k.jumlah })}
                </span>
                <span className="text-sm tabular-nums">{ringkas(k.nilai)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kartu({
  ikon: Ikon,
  label,
  nilai,
  kaki,
  nada,
  href,
}: {
  ikon: typeof Wallet;
  label: string;
  nilai: string;
  kaki: string;
  nada?: string;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="h-full transition-colors hover:bg-muted/40">
        <CardContent className="space-y-1 py-4">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Ikon className="h-4 w-4" />
            {label}
          </span>
          <p className={cn('text-xl font-semibold tabular-nums', nada)}>{nilai}</p>
          <p className="text-xs text-muted-foreground">{kaki}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

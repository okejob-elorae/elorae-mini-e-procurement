'use client';

import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { StatistikBeranda } from './kartu-beranda';
import type { SalesmenSalesSummary } from '@/lib/dashboard/queries';
import type { MarketplaceKpi } from '@/lib/sales-orders/queries';
import type { ActionItem } from '@/lib/dashboard/action-items-shared';
import { ActionNeededPanel } from './ActionNeededPanel';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { BatangKomposisi } from '@/components/dashboard/BatangKomposisi';
import { KpiDaftar, type BarisKpi } from '@/components/dashboard/KpiDaftar';
import { SalamBeranda } from '@/components/dashboard/SalamBeranda';
import { TrenPenjualan } from '@/components/dashboard/TrenPenjualan';
import type { KelompokUmur, TitikTren } from '@/lib/dashboard/tren';
import type { RingkasPiutangBeranda } from '@/lib/dashboard/piutang-ringkas';
import { formatRupiah as formatIdr } from '@/lib/format/rupiah';

function formatNumber(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

/** Jeda masuk per blok — `anim-rise` global membaca `--anim-delay`. */
const tunda = (ms: number) => ({ '--anim-delay': `${ms}ms` }) as CSSProperties;

/**
 * Warna umur piutang: skala kegentingan, bukan kategori. Yang belum jatuh tempo
 * abu netral — hijau di sini akan dibaca sebagai "Lapangan", warna seri itu di
 * grafik tren. Lalu kuning, oranye, dan merah untuk yang sudah lewat 60 hari.
 */
const WARNA_UMUR: Record<KelompokUmur['kunci'], string> = {
  belum: 'color-mix(in oklab, var(--muted-foreground) 45%, transparent)',
  h1_30: 'var(--viz-4)',
  h31_60: 'var(--viz-2)',
  lebih60: 'var(--destructive)',
};

/**
 * Satu kelompok beranda: judul bagian lalu kartu-kartunya. Judulnya `h2`
 * berukuran biasa — berbeda dari judul kartu yang kecil berhuruf besar — supaya
 * mata menemukan "Penjualan", "Piutang", dst. sebelum membaca angka.
 */
function Kelompok({
  id,
  judul,
  delay,
  children,
}: {
  id: string;
  judul: string;
  delay: number;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="anim-rise space-y-3" style={tunda(delay)}>
      <h2 id={id} className="text-base font-semibold tracking-tight">
        {judul}
      </h2>
      {children}
    </section>
  );
}

/*
 * Prop yang boleh `null` adalah kartu yang TIDAK dimuat server karena
 * penggunanya tidak memegang izinnya (`kartuBeranda`). `null` berarti
 * bagiannya tidak digambar — bukan nol, yang akan terbaca "tidak ada piutang".
 */
type DashboardPageClientProps = {
  initialStats: StatistikBeranda;
  overduePOCount: number;
  initialCogsRawVsFinished: {
    rawValue: number;
    finishedValue: number;
    rawCount: number;
    finishedCount: number;
  } | null;
  shortageCount: number;
  marketplaceKpi: MarketplaceKpi | null;
  actionItems: ActionItem[];
  piutang: RingkasPiutangBeranda | null;
  oversoldCount: number | null;
  initialSalesmenSales: SalesmenSalesSummary | null;
  trenPenjualan: TitikTren[] | null;
  /** Tanggal WIB hari ini (YYYY-MM-DD) — untuk tautan "hari ini" ke daftar pesanan. */
  hariIniWib: string;
  /** Kapan server memuat angka-angka ini — untuk "Diperbarui … lalu". */
  dimuatPada: string;
};

/**
 * Beranda, dalam urutan pertanyaan pagi: apa yang menunggu saya, lalu
 * Penjualan → Piutang → Produksi & pembelian → Stok. Setiap angka muncul di
 * SATU tempat saja — nilai stok di komposisi stok, piutang beredar di kartu
 * umurnya — karena dua tempat untuk satu angka membuat orang membandingkan
 * keduanya alih-alih membacanya. Laporan rinci pindah ke /backoffice/laporan.
 */
export function DashboardPageClient({
  actionItems,
  piutang,
  initialStats,
  overduePOCount,
  initialCogsRawVsFinished,
  shortageCount,
  marketplaceKpi,
  oversoldCount,
  initialSalesmenSales,
  trenPenjualan,
  hariIniWib,
  dimuatPada,
}: DashboardPageClientProps) {
  const { data: session } = useSession();
  const tDashboard = useTranslations('dashboard');
  // Langsung dari prop, bukan disalin ke state: "Diperbarui" memanggil
  // router.refresh(), dan salinan di state akan menahan angka yang lama.
  const s = initialStats;
  const cogsRawVsFinished = initialCogsRawVsFinished;
  const salesmenSales = initialSalesmenSales;

  if (!session) {
    return null;
  }

  // Baris ringkasan penjualan: lapangan hanya bila datanya dikirim, begitu pula marketplace.
  const barisPenjualan: BarisKpi[] = [];
  if (salesmenSales) {
    barisPenjualan.push({
      // Sejak awal, bukan 30 hari — dan disebut begitu, karena ia
      // berdiri tepat di bawah grafik 30 hari.
      label: tDashboard('kpiRealisedAllTime'),
      nilai: salesmenSales.totals.realised.amount,
      format: formatIdr,
      konteks: tDashboard('kpiRealisedCtx', { count: formatNumber(salesmenSales.totals.realised.count) }),
      // Daftar pesanan bawaannya "menunggu persetujuan"; yang
      // terealisasi adalah putus yang sudah disetujui.
      href: '/backoffice/field-sales-orders?status=APPROVED&orderType=PUTUS',
    });
  }
  if (marketplaceKpi) {
    barisPenjualan.push(
      {
        label: tDashboard('kpiMarketplaceToday'),
        nilai: Number(marketplaceKpi.todaySalesTotal),
        format: formatIdr,
        konteks: tDashboard('todaySalesCount', { count: marketplaceKpi.todaySalesCount }),
        href: `/backoffice/sales-orders?dateFrom=${hariIniWib}&dateTo=${hariIniWib}`,
      },
      {
        label: tDashboard('kpiUnshipped'),
        nilai: marketplaceKpi.pendingFulfillmentCount,
        format: formatNumber,
        konteks: tDashboard('kpiUnshippedCtx'),
        href: '/backoffice/fulfillment',
        nada: marketplaceKpi.pendingFulfillmentCount > 0 ? 'perhatian' : 'netral',
      },
    );
  }

  return (
    <div className="viz beranda-halaman space-y-6">
      <div className="anim-rise space-y-3">
        <SalamBeranda nama={session.user.name ?? ''} dimuatPada={dimuatPada} />
        {/* Grafik penjualan paling atas (permintaan pemilik, 2026-10-01): yang
            pertama dibaca adalah arah penjualan, lalu apa yang perlu ditindaklanjuti. */}
        {trenPenjualan ? <TrenPenjualan tren={trenPenjualan} formatIdr={formatIdr} /> : null}
        {/* Terbuka, bukan terlipat di balik tombol. */}
        <ActionNeededPanel items={actionItems} />
      </div>

      {barisPenjualan.length > 0 ? (
      <Kelompok id="beranda-penjualan" judul={tDashboard('groupSales')} delay={80}>
        {/* Tanpa tabel per salesman, ringkasan selebar kartu produksi, bukan sepertiga layar. */}
        <div
          className={cn(
            'grid gap-4',
            salesmenSales ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]' : 'md:grid-cols-2',
          )}
        >
          <KpiDaftar judul={tDashboard('kpiSalesSummary')} baris={barisPenjualan} />
        {salesmenSales ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {tDashboard('salesmanTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {salesmenSales.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">{tDashboard('salesmanEmpty')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tDashboard('colSalesman')}</TableHead>
                    {/* Kolom batang, tanpa judul: yang diukurnya sudah disebut
                        kolom Realised di sebelahnya, dan judul kedua untuk
                        ukuran yang sama justru membingungkan. */}
                    <TableHead className="w-[38%]" aria-hidden />
                    <TableHead className="text-right">{tDashboard('colRealised')}</TableHead>
                    <TableHead className="text-right">{tDashboard('colOutstanding')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    /*
                     * Batangnya SEKARANG DI DALAM tabel, bukan blok terpisah di
                     * atasnya. Sebelumnya dua kisi bertumpuk dengan kolom yang
                     * tidak sejajar sama sekali — dan dua kisi yang berselisih
                     * terbaca sebagai berantakan sebelum sempat terbaca sebagai
                     * data. Satu tabel, satu kisi.
                     *
                     * Diurutkan dari yang terbesar: tabel yang mau menjawab
                     * "siapa paling depan" harus sudah terurut, kalau tidak
                     * batangnya cuma hiasan.
                     */
                    const urut = [...salesmenSales.rows].sort(
                      (a, b) => b.realised.amount - a.realised.amount,
                    );
                    const puncak = Math.max(1, ...urut.map((r) => r.realised.amount));
                    return urut.map((row) => (
                    <TableRow key={row.salesmanId}>
                      <TableCell className="font-medium">{row.salesmanName}</TableCell>
                      <TableCell>
                        {/* `block`, bukan span polos — span inline mengabaikan
                            tinggi dan lebarnya, dan batangnya hilang. */}
                        <span className="block h-2 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${Math.max(2, (row.realised.amount / puncak) * 100)}%`,
                              background: 'var(--viz-3)',
                            }}
                          />
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div className="font-medium">
                          {formatIdr(row.realised.amount)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {tDashboard('txCount', { count: formatNumber(row.realised.count) })}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div
                          className={cn(
                            'font-medium',
                            row.outstanding.count > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
                          )}
                        >
                          {formatIdr(row.outstanding.amount)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {tDashboard('waitingCount', { count: formatNumber(row.outstanding.count) })}
                        </div>
                      </TableCell>
                    </TableRow>
                    ));
                  })()}
                  <TableRow className="border-t-2 hover:bg-transparent">
                    <TableCell className="font-semibold">{tDashboard('totalRow')}</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums">
                      <div className="font-semibold">
                        {formatIdr(salesmenSales.totals.realised.amount)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {tDashboard('txCount', { count: formatNumber(salesmenSales.totals.realised.count) })}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div
                        className={cn(
                          'font-semibold',
                          salesmenSales.totals.outstanding.count > 0
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-muted-foreground',
                        )}
                      >
                        {formatIdr(salesmenSales.totals.outstanding.amount)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {tDashboard('waitingCount', { count: formatNumber(salesmenSales.totals.outstanding.count) })}
                      </div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        ) : null}
        </div>
      </Kelompok>
      ) : null}

      {piutang ? (
      <Kelompok id="beranda-piutang" judul={tDashboard('groupReceivables')} delay={120}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <BatangKomposisi
            judul={tDashboard('agingTitle', {
              // Dihitung dari kelompoknya, bukan `piutang.jumlah`: faktur terbuka
              // yang sisanya nol tidak masuk kelompok mana pun, dan judul yang
              // menyebut 7 di atas keterangan yang menjumlah 6 terbaca sebagai galat.
              count: piutang.umur.reduce((n, u) => n + u.jumlah, 0),
            })}
            total={piutang.total}
            format={formatIdr}
            href="/backoffice/piutang"
            kosong={tDashboard('agingEmpty')}
            bagian={piutang.umur.map((u) => ({
              label: tDashboard(`aging.${u.kunci}`),
              nilai: u.nilai,
              warna: WARNA_UMUR[u.kunci],
              keterangan: u.jumlah ? tDashboard('agingInvoices', { count: u.jumlah }) : undefined,
            }))}
          />
          <KpiDaftar
            judul={tDashboard('kpiReceivablesAttention')}
            baris={[
              {
                label: tDashboard('kpiOverdueReceivable'),
                nilai: piutang.lewatNilai,
                format: formatIdr,
                konteks: tDashboard('kpiOverdueReceivableCtx', { count: formatNumber(piutang.lewatJumlah) }),
                href: '/backoffice/piutang?keadaan=lewat',
                nada: piutang.lewatJumlah > 0 ? 'buruk' : 'netral',
              },
              {
                label: tDashboard('kpiHeld'),
                nilai: piutang.tertahanNilai,
                format: formatIdr,
                konteks: tDashboard('kpiHeldCtx'),
                href: '/backoffice/retur-toko',
                nada: piutang.tertahanNilai > 0 ? 'perhatian' : 'netral',
              },
            ]}
          />
        </div>
      </Kelompok>
      ) : null}

      <Kelompok id="beranda-produksi" judul={tDashboard('groupProduction')} delay={160}>
        <div className="grid gap-4 md:grid-cols-2">
          <KpiDaftar
            judul={tDashboard('kpiProductionOnly')}
            baris={[
              {
                label: tDashboard('kpiWoRunning'),
                nilai: s.workOrders.inProduction,
                format: formatNumber,
                konteks: tDashboard('kpiWoDoneToday', { count: formatNumber(s.workOrders.completedToday) }),
                href: '/backoffice/work-orders',
              },
              {
                label: tDashboard('kpiShortage'),
                nilai: shortageCount,
                format: formatNumber,
                konteks: tDashboard('kpiShortageCtx'),
                // Tabel kekurangannya (per bahan, per vendor) sekarang di Laporan.
                href: '/backoffice/laporan',
                nada: shortageCount > 0 ? 'perhatian' : 'netral',
              },
            ]}
          />
          <KpiDaftar
            judul={tDashboard('kpiPurchasing')}
            baris={[
              {
                label: tDashboard('kpiPoOverdue'),
                nilai: overduePOCount,
                format: formatNumber,
                konteks: tDashboard('kpiPoOverdueCtx'),
                href: '/backoffice/purchase-orders?status=overdue',
                nada: overduePOCount > 0 ? 'buruk' : 'netral',
              },
              {
                label: tDashboard('kpiPoWaiting'),
                nilai: s.po.draft,
                format: formatNumber,
                konteks: tDashboard('kpiPoWaitingCtx'),
                href: '/backoffice/purchase-orders?status=DRAFT',
                nada: s.po.draft > 0 ? 'perhatian' : 'netral',
              },
              {
                label: tDashboard('kpiSuppliers'),
                nilai: s.suppliers.activeCount,
                format: formatNumber,
                konteks: tDashboard('kpiSuppliersCtx', { count: formatNumber(s.grnsThisWeek) }),
                href: '/backoffice/suppliers',
              },
            ]}
          />
        </div>
      </Kelompok>

      {cogsRawVsFinished && oversoldCount !== null && s.items ? (
      <Kelompok id="beranda-stok" judul={tDashboard('groupStock')} delay={200}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <BatangKomposisi
            judul={tDashboard('stockMixTitle')}
            total={cogsRawVsFinished.rawValue + cogsRawVsFinished.finishedValue}
            format={formatIdr}
            href="/backoffice/inventory"
            kosong={tDashboard('stockMixEmpty')}
            bagian={[
              {
                label: tDashboard('kpiRawValue'),
                nilai: cogsRawVsFinished.rawValue,
                // Dua bagian dari SATU ukuran: dua nada satu rona. Biru dan hijau
                // sudah berarti marketplace dan lapangan di grafik tren.
                warna: 'var(--viz-5)',
                keterangan: tDashboard('kpiRawValueCtx', { count: formatNumber(cogsRawVsFinished.rawCount) }),
              },
              {
                label: tDashboard('kpiFinishedValue'),
                nilai: cogsRawVsFinished.finishedValue,
                warna: 'color-mix(in oklab, var(--viz-5) 45%, var(--kpi-surface))',
                keterangan: tDashboard('kpiFinishedValueCtx', {
                  count: formatNumber(cogsRawVsFinished.finishedCount),
                }),
              },
            ]}
          />
          <KpiDaftar
            judul={tDashboard('kpiStockAttention')}
            baris={[
              {
                label: tDashboard('kpiLowStock'),
                nilai: s.items.lowStockCount,
                format: formatNumber,
                konteks: tDashboard('kpiLowStockCtx'),
                href: '/backoffice/inventory',
                nada: s.items.lowStockCount > 0 ? 'perhatian' : 'netral',
              },
              {
                label: tDashboard('oversoldTitle'),
                nilai: oversoldCount,
                format: formatNumber,
                konteks: tDashboard('kpiOversoldCtx'),
                href: '/backoffice/inventory?tab=stock&oversold=1',
                nada: oversoldCount > 0 ? 'buruk' : 'netral',
              },
            ]}
          />
        </div>
      </Kelompok>
      ) : null}

      {/* Laporan rinci (produksi, PO terlambat, pengadaan, setoran CMT,
          inventori) dulu tab di bawah sini; sekarang halamannya sendiri.
          Warna teks biasa dengan garis bawah tema, bukan `text-primary`: tema
          limau di atas krem hanya 1,5:1 — tak terbaca di mode terang. */}
      <div className="anim-rise" style={tunda(240)}>
        <Link
          href="/backoffice/laporan"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline decoration-primary decoration-2 underline-offset-4 hover:decoration-foreground"
        >
          {tDashboard('seeAllReports')}
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

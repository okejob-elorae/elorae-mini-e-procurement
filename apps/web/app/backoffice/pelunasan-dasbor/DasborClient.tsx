'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CalendarClock, Clock, PackageOpen, RotateCcw, Scale, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import type { Dasbor, TindakanHariIni } from '@/lib/receivables/dashboard-queries';
import type { KeadaanTampil } from '@/lib/receivables/jatuh-tempo';
import { tautanPiutang, tautanRetur } from '@/lib/receivables/tindakan-dasbor';
import { dinamis } from '@/lib/i18n/dinamis';

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
  jatuh_tempo: 'attention',
  keputusan: 'attention',
  klaim: 'waiting',
  tertahan: 'attention',
  cek: 'waiting',
  jodoh: 'progress',
};

const NADA_KEADAAN: Record<KeadaanTampil, StatusTone> = {
  lunas: 'settled',
  klaim: 'progress',
  tertahan: 'attention',
  lewat: 'attention',
  jatuh_tempo: 'attention',
  tt: 'waiting',
  belum: 'inactive',
};

export function DasborClient({ data }: { data: Dasbor }) {
  const t = useTranslations('dasborPelunasan');
  const td = dinamis(t);

  const puncakSales = Math.max(1, ...data.perSales.map((s) => s.nilai));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('judulHalaman')}
        meta={t('summary', { count: data.jumlahPiutang, value: rupiah(data.totalPiutang) })}
      />

      {/* Setiap kartu membuka daftar yang SUDAH tersaring pada angka yang ia sebut.
          Baris pertama uang di faktur, baris kedua retur — empat kolom. */}
      <div className="anim-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kartu
          ikon={Wallet}
          label={t('kpiTotal')}
          nilai={rupiah(data.totalPiutang)}
          kaki={t('kpiTotalFoot', { count: data.jumlahPiutang })}
          href={tautanPiutang({})}
        />
        <Kartu
          ikon={AlertTriangle}
          label={t('kpiOverdue')}
          nilai={rupiah(data.nilaiLewatTempo)}
          kaki={t('kpiOverdueFoot', { count: data.lewatTempo })}
          nada={data.lewatTempo > 0 ? 'text-destructive' : undefined}
          href={tautanPiutang({ keadaan: 'lewat' })}
        />
        <Kartu
          ikon={CalendarClock}
          label={t('kpiDue')}
          nilai={rupiah(data.nilaiJatuhTempo)}
          kaki={t('kpiDueFoot', { count: data.jatuhTempo })}
          nada={data.jatuhTempo > 0 ? 'text-destructive' : undefined}
          href={tautanPiutang({ keadaan: 'jatuh_tempo' })}
        />
        <Kartu
          ikon={Clock}
          label={t('kpiAwaiting')}
          nilai={rupiah(data.nilaiMenungguVerifikasi)}
          kaki={t('kpiAwaitingFoot', { count: data.menungguVerifikasi })}
          href="/backoffice/pelunasan?status=DIKIRIM"
        />
        {/* Dua ukuran yang dulu bercampur di satu kartu ("Rp 0 — 2 retur perlu
            dikerjakan"): uang yang ditahan, dan nota retur yang menunggu orang. */}
        <Kartu
          ikon={PackageOpen}
          label={t('kpiHeld')}
          nilai={rupiah(data.tertahanRetur)}
          kaki={t('kpiHeldFootFaktur', { count: data.fakturTertahan })}
          nada={data.tertahanRetur > 0 ? 'text-amber-800 dark:text-amber-400' : undefined}
          href={tautanPiutang({ keadaan: 'tertahan' })}
        />
        <Kartu
          ikon={RotateCcw}
          label={t('kpiReturns')}
          nilai={t('kpiReturnsValue', { count: data.returPerluDikerjakan })}
          kaki={t('kpiReturnsFoot', {
            cek: data.returPerLangkah.cek,
            jodoh: data.returPerLangkah.jodoh,
            keputusan: data.returPerLangkah.keputusan,
          })}
          href={tautanRetur({})}
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
                <StatusPill tone={a.konteks.milikSaya ? 'inactive' : NADA_TINDAKAN[a.jenis]}>
                  {td(`todo_${kunciTindakan(a)}`)}
                </StatusPill>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{a.judul}</span>
                  <span className="block text-xs text-muted-foreground">
                    {/* Kunci "hari ini" dipakai saat selisihnya nol — "0 hari
                        lalu" bukan bahasa Indonesia yang ditulis orang. */}
                    {td(a.konteks.hari === 0 ? `why_${kunciTindakan(a)}_today` : `why_${kunciTindakan(a)}`, {
                      toko: a.konteks.toko ?? '—',
                      hari: a.konteks.hari ?? 0,
                      pelapor: a.konteks.pelapor ?? '—',
                    })}
                  </span>
                </span>
                <span className="tabular-nums text-sm font-semibold">
                  {a.konteks.klaimTersembunyi ? '—' : rupiah(a.nilai)}
                </span>
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
                <div key={s.nama ?? ''} className="space-y-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{s.nama ?? t('noSalesman')}</span>
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
              <Link
                key={k.keadaan}
                href={tautanPiutang({ keadaan: k.keadaan })}
                className="-mx-2 flex flex-wrap items-center gap-3 rounded-md px-2 py-1 transition-colors hover:bg-muted/50"
              >
                <StatusPill tone={NADA_KEADAAN[k.keadaan]}>
                  {td(`state_${k.keadaan}`)}
                </StatusPill>
                <span className="flex-1 text-sm tabular-nums text-muted-foreground">
                  {t('invoiceCount', { count: k.jumlah })}
                </span>
                <span className="text-sm tabular-nums">{ringkas(k.nilai)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * Kunci kalimat sebuah baris tindakan. BKM yang dicatat penonton sendiri
 * berbunyi "menunggu rekan Anda"; BKM yang pelapornya diketahui menyebut
 * namanya — dulu semuanya berbunyi "sales sudah lapor", juga yang dicatat admin.
 */
function kunciTindakan(a: TindakanHariIni): string {
  if (a.jenis !== 'klaim') return a.jenis;
  if (a.konteks.milikSaya) return 'klaim_milikSaya';
  return a.konteks.pelapor ? 'klaim_oleh' : 'klaim';
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
      {/* Jarak atas-bawah dari kartu itu sendiri: `py-4` di isinya dulu
          menumpuk di atas padding kartu, jadi tiap kotak setinggi dua kali isinya. */}
      <Card className="h-full transition-colors hover:bg-muted/40">
        <CardContent className="space-y-1">
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

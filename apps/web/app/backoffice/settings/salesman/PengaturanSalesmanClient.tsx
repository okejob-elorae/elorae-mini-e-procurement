'use client';

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CalendarClock, ListTree, Loader2, Target } from 'lucide-react';
import { simpanBatasHariKunjungan, simpanTargetBulan } from '@/app/actions/settings/salesman';
import { Badge } from "@/components/ui/badge";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BATAS_HARI_BAWAAN } from '@/lib/salesman/pengaturan';
import { formatIDR } from '@/lib/sales-orders/format';
import { cn } from '@/lib/utils';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';

type Props = {
  bolehUbah: boolean;
  batas: { hari: number; diatur: boolean };
  bulan: { kunci: string; target: Record<string, number> }[];
  salesman: { id: string; nama: string; capai: number }[];
  /** SPG: target per orang, pencapaian = total nota SPG bulan ini. */
  spg: { id: string; nama: string; tokoNama: string | null; capai: number }[];
};

const angkaSaja = (s: string) => s.replace(/\D/g, '');
const kelompok = new Intl.NumberFormat('id-ID');

export function PengaturanSalesmanClient({ bolehUbah, batas, bulan, salesman, spg }: Props) {
  const t = useTranslations('settings.salesman');
  const tToasts = useTranslations('toasts');
  const locale = useLocale();
  const router = useRouter();
  const [sibuk, mulai] = useTransition();

  const [hari, setHari] = useState(batas.diatur ? String(batas.hari) : '');
  const [pilihBulan, setPilihBulan] = useState(bulan[0].kunci);
  const awal = useMemo(() => bulan.find((b) => b.kunci === pilihBulan)?.target ?? {}, [bulan, pilihBulan]);
  // Draf per bulan: berpindah bulan tidak membuang angka yang belum disimpan.
  const [draf, setDraf] = useState<Record<string, Record<string, string>>>({});
  const nilaiSel = (id: string) => draf[pilihBulan]?.[id] ?? (awal[id] ? String(awal[id]) : '');

  const namaBulan = (kunci: string) =>
    new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${kunci}-01T00:00:00Z`),
    );

  const berubah = useMemo(() => {
    const isi: Record<string, number | null> = {};
    for (const [id, v] of Object.entries(draf[pilihBulan] ?? {})) {
      const baru = v ? Number(v) : null;
      if ((baru ?? null) !== (awal[id] ?? null)) isi[id] = baru;
    }
    return isi;
  }, [draf, pilihBulan, awal]);

  const galat = (code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'INVALID') =>
    toast.error(code === 'INVALID' ? t('errInvalid') : t('errForbidden'));

  const simpanHari = (nilai: number | null) =>
    mulai(async () => {
      const r = await simpanBatasHariKunjungan(nilai);
      if (!r.ok) {
        galat(r.code);
        return;
      }
      if (nilai === null) setHari('');
      toast.success(tToasts('saved'));
      router.refresh();
    });

  const simpanTarget = () =>
    mulai(async () => {
      const r = await simpanTargetBulan(pilihBulan, berubah);
      if (!r.ok) {
        galat(r.code);
        return;
      }
      setDraf((d) => ({ ...d, [pilihBulan]: {} }));
      toast.success(tToasts('saved'));
      router.refresh();
    });

  const hariValid = /^\d+$/.test(hari) && Number(hari) >= 1 && Number(hari) <= 365;
  const bulanIni = pilihBulan === bulan[0].kunci;

  // Satu bentuk baris untuk salesman dan SPG: target keduanya disimpan di peta
  // yang sama (per userId per bulan), hanya sumber pencapaiannya yang berbeda.
  const barisTarget = (s: { id: string; nama: string; capai: number }, keterangan?: ReactNode) => {
    const v = nilaiSel(s.id);
    const target = v ? Number(v) : 0;
    return (
      <TableRow key={s.id}>
        <TableCell className="whitespace-normal font-medium">
          {s.nama}
          {keterangan}
        </TableCell>
        {bulanIni ? <TableCell className="text-right tabular-nums">{formatIDR(s.capai)}</TableCell> : null}
        <TableCell>
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              Rp
            </span>
            <Input
              type="text"
              inputMode="numeric"
              aria-label={`${t("colTarget")} ${s.nama}`}
              className="pl-9 text-right tabular-nums"
              value={v ? kelompok.format(Number(v)) : ""}
              placeholder="0"
              onChange={(e) =>
                setDraf((d) => ({
                  ...d,
                  [pilihBulan]: { ...(d[pilihBulan] ?? {}), [s.id]: angkaSaja(e.target.value).slice(0, 13) },
                }))
              }
              disabled={!bolehUbah || sibuk}
            />
          </div>
        </TableCell>
        {bulanIni ? (
          <TableCell className="text-right tabular-nums text-muted-foreground">
            {target > 0 ? `${Math.round((s.capai / target) * 100)}%` : "—"}
          </TableCell>
        ) : null}
      </TableRow>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <TombolBantuan judul={t('title')} />
        </div>
        {!bolehUbah ? <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{t('readOnly')}</p> : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            {t('visitTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="text"
              inputMode="numeric"
              aria-label={t('visitTitle')}
              className="w-24 tabular-nums"
              value={hari}
              placeholder={String(BATAS_HARI_BAWAAN)}
              onChange={(e) => setHari(angkaSaja(e.target.value).slice(0, 3))}
              disabled={!bolehUbah || sibuk}
            />
            <span className="text-sm text-muted-foreground">{t('visitDays')}</span>
            <Button onClick={() => simpanHari(Number(hari))} disabled={!bolehUbah || sibuk || !hariValid || Number(hari) === (batas.diatur ? batas.hari : -1)}>
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t('visitSave')}
            </Button>
            {batas.diatur ? (
              <Button variant="ghost" onClick={() => simpanHari(null)} disabled={!bolehUbah || sibuk}>
                {t('visitUseDefault', { days: BATAS_HARI_BAWAAN })}
              </Button>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {batas.diatur ? t('visitNow', { days: batas.hari }) : t('visitNotSet', { days: BATAS_HARI_BAWAAN })}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            {t('targetTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div role="group" aria-label={t('targetTitle')} className="inline-flex rounded-lg border p-0.5">
            {bulan.map((b) => (
              <button
                key={b.kunci}
                type="button"
                aria-pressed={b.kunci === pilihBulan}
                onClick={() => setPilihBulan(b.kunci)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  b.kunci === pilihBulan ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {namaBulan(b.kunci)}
              </button>
            ))}
          </div>

          {salesman.length === 0 && spg.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noSalesman")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{spg.length > 0 ? t("spgColPerson") : t("colSalesman")}</TableHead>
                  {bulanIni ? <TableHead className="text-right">{t("colAchieved")}</TableHead> : null}
                  <TableHead className="w-48">{t("colTarget")}</TableHead>
                  {bulanIni ? <TableHead className="w-24 text-right">{t("colProgress")}</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {salesman.map((s) => barisTarget(s))}
                {spg.length > 0 ? (
                  <>
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={bulanIni ? 4 : 2} className="whitespace-normal bg-muted/40 py-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {t("spgGroup")}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">{t("spgGroupHint")}</span>
                      </TableCell>
                    </TableRow>
                    {spg.map((s) =>
                      barisTarget(
                        s,
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs font-normal text-muted-foreground">
                          <Badge variant="secondary">{t("spgBadge")}</Badge>
                          {s.tokoNama ?? t("spgNoStore")}
                        </span>,
                      ),
                    )}
                  </>
                ) : null}
              </TableBody>
            </Table>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={simpanTarget} disabled={!bolehUbah || sibuk || Object.keys(berubah).length === 0}>
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t('targetSave')}
            </Button>
            {/* Rincian per kategori/barang hidup di halamannya sendiri; target total tetap di sini. */}
            <Button asChild variant="link">
              <Link href={`/backoffice/target-sales?bulan=${pilihBulan}`}>
                <ListTree className="h-4 w-4" aria-hidden />
                {t("targetRinciLink")}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DocType } from '@elorae/db';
import {
  getDocNumberConfigs,
  simpanNomorDokumenAction,
  type DocNumberConfigRow,
  type IsianNomorDokumen,
} from '@/app/actions/settings/doc-numbers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FileDigit, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import {
  contohNomorBerikutnya,
  kelompokDokumen,
  periksaIsianNomor,
  urutkanJenisDokumen,
  type PeriodeReset,
} from './jenis-dokumen';

type Draf = { prefix: string; resetPeriod: PeriodeReset; padding: string };

const keDraf = (c: DocNumberConfigRow): Draf => ({
  prefix: c.prefix,
  resetPeriod: (c.resetPeriod as PeriodeReset) ?? 'YEARLY',
  padding: String(c.padding),
});

export default function DocumentNumbersSettingsPage() {
  const t = useTranslations('documents');
  const tToasts = useTranslations('toasts');
  const { data: session, status } = useSession();
  const router = useRouter();
  const [configs, setConfigs] = useState<DocNumberConfigRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [menyimpan, setMenyimpan] = useState(false);
  const [edits, setEdits] = useState<Partial<Record<DocType, Draf>>>({});
  // Pratinjau memakai jam peramban; dibaca sekali saat halaman dibuka.
  const [kini] = useState(() => new Date());

  const bolehUbah = hasPermission(session?.user?.permissions ?? [], PERMISSIONS.SETTINGS_DOCUMENTS_MANAGE);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    if (status !== 'authenticated') return;
    getDocNumberConfigs()
      .then(setConfigs)
      .catch(() => toast.error(t('loadError')))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t from useTranslations
  }, [status, router]);

  const configOf = (docType: DocType) => configs.find((c) => c.docType === docType);
  // Semua baris dari server (generator punya semua jenis), urut per kelompok.
  const daftarJenis = urutkanJenisDokumen(configs.map((c) => c.docType));
  // Jenis baru yang belum diberi nama tampil dengan kodenya.
  const namaJenis = (d: DocType) => (t.has(`docTypes.${d}`) ? t(`docTypes.${d}`) : d);
  const getEdit = (docType: DocType): Draf | null => {
    const e = edits[docType];
    if (e) return e;
    const c = configOf(docType);
    return c ? keDraf(c) : null;
  };

  const setEdit = (docType: DocType, field: keyof Draf, value: string) => {
    const lama = getEdit(docType);
    if (!lama) return;
    setEdits((prev) => ({ ...prev, [docType]: { ...lama, [field]: value } }));
  };

  // Tanpa useMemo: React Compiler yang menyimpan hasilnya.
  /** Baris yang benar-benar berubah dari yang tersimpan. */
  const berubah = daftarJenis.filter((d) => {
    const e = edits[d];
    const c = configs.find((x) => x.docType === d);
    if (!e || !c) return false;
    const asal = keDraf(c);
    return e.prefix !== asal.prefix || e.resetPeriod !== asal.resetPeriod || e.padding !== asal.padding;
  });

  // Alasan pertama tombol Simpan mati, dalam urutan tabel.
  const galatPertama =
    berubah
      .map((d) => ({ docType: d, kode: periksaIsianNomor({ prefix: edits[d]!.prefix, padding: edits[d]!.padding }) }))
      .find((x) => x.kode !== null) ?? null;

  const handleSave = async () => {
    if (!session?.user?.id || berubah.length === 0 || galatPertama) return;
    setMenyimpan(true);
    try {
      const isian: IsianNomorDokumen[] = berubah.map((d) => {
        const e = edits[d]!;
        return { docType: d, prefix: e.prefix.trim(), resetPeriod: e.resetPeriod, padding: Number(e.padding) };
      });
      const r = await simpanNomorDokumenAction(isian);
      if (!r.ok) {
        toast.error(
          r.docType
            ? t('errRow', { jenis: namaJenis(r.docType), pesan: t(`err.${r.code}`) })
            : t(`err.${r.code}`),
        );
        return;
      }
      toast.success(t('savedCount', { count: r.diubah }));
      setConfigs(await getDocNumberConfigs());
      setEdits({});
    } catch {
      toast.error(tToasts('failedToSave'));
    } finally {
      setMenyimpan(false);
    }
  };

  if (status === 'loading' || isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h1>
          <TombolBantuan judul={t('pageTitle')} />
        </div>
        {bolehUbah ? (
          <div className="flex flex-col items-end gap-1">
            <Button onClick={() => void handleSave()} disabled={menyimpan || berubah.length === 0 || galatPertama !== null}>
              {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {berubah.length > 0 ? t('saveCount', { count: berubah.length }) : t('save')}
            </Button>
            <p className="text-xs text-muted-foreground">
              {galatPertama
                ? t('errRow', { jenis: namaJenis(galatPertama.docType), pesan: t(`err.${galatPertama.kode}`) })
                : berubah.length === 0
                  ? t('noChanges')
                  : null}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('readOnly')}</p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileDigit className="h-5 w-5" />
            {t('configTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('documentType')}</TableHead>
                  <TableHead>{t('prefix')}</TableHead>
                  <TableHead>{t('resetPeriod')}</TableHead>
                  <TableHead>{t('padding')}</TableHead>
                  <TableHead>{t('lastNumber')}</TableHead>
                  <TableHead>{t('nextExample')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {daftarJenis.map((docType, i) => {
                  const c = configOf(docType);
                  const e = getEdit(docType);
                  if (!c || !e) return null;
                  const label = namaJenis(docType);
                  const kelompok = kelompokDokumen(docType);
                  const kelompokBaru = i === 0 || kelompokDokumen(daftarJenis[i - 1]) !== kelompok;
                  const galat = periksaIsianNomor({ prefix: e.prefix, padding: e.padding });
                  const contoh = galat
                    ? null
                    : contohNomorBerikutnya(
                        { prefix: e.prefix.trim(), resetPeriod: e.resetPeriod, padding: Number(e.padding), lastNumber: c.lastNumber, year: c.year, month: c.month },
                        kini,
                      );
                  return [
                    kelompokBaru ? (
                      <TableRow key={`k-${kelompok}`} className="hover:bg-transparent">
                        <TableCell colSpan={6} className="bg-muted/40 py-2">
                          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {t(`group.${kelompok}`)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ) : null,
                    <TableRow key={docType}>
                      <TableCell className="whitespace-normal font-medium">
                        {label}
                        {berubah.includes(docType) ? (
                          <Badge variant="secondary" className="ml-2">
                            {t('changed')}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`${t('prefix')} — ${label}`}
                          aria-invalid={galat === 'AWALAN_KOSONG' || galat === 'AWALAN_PANJANG'}
                          value={e.prefix}
                          onChange={(ev) => setEdit(docType, 'prefix', ev.target.value)}
                          className="max-w-[140px] font-mono"
                          disabled={!bolehUbah || menyimpan}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={e.resetPeriod}
                          onValueChange={(v) => setEdit(docType, 'resetPeriod', v)}
                          disabled={!bolehUbah || menyimpan}
                        >
                          <SelectTrigger className="w-[150px]" aria-label={`${t('resetPeriod')} — ${label}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="YEARLY">{t('period.YEARLY')}</SelectItem>
                            <SelectItem value="MONTHLY">{t('period.MONTHLY')}</SelectItem>
                            <SelectItem value="NEVER">{t('period.NEVER')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="text"
                          inputMode="numeric"
                          aria-label={`${t('padding')} — ${label}`}
                          aria-invalid={galat === 'DIGIT_TIDAK_SAH'}
                          value={e.padding}
                          onChange={(ev) => setEdit(docType, 'padding', ev.target.value.replace(/\D/g, '').slice(0, 1))}
                          className="w-16 tabular-nums"
                          disabled={!bolehUbah || menyimpan}
                        />
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {c.id ? c.lastNumber.toLocaleString('id-ID') : t('notUsedYet')}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {contoh ?? <span className="font-sans text-xs text-destructive">{t(`err.${galat}`)}</span>}
                      </TableCell>
                    </TableRow>,
                  ];
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

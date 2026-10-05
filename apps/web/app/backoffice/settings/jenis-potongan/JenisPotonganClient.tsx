'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Tags } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { dinamis } from '@/lib/i18n/dinamis';
import {
  nonaktifkanJenisPotonganAction,
  simpanJenisPotonganAction,
} from '@/app/actions/deduction-types';
import type { BarisJenisPotongan, CaraPotongan } from '@/lib/receivables/deduction-types';

const CARA: CaraPotongan[] = ['NOMINAL', 'PERSEN', 'DARI_RETUR'];

const KOSONG = {
  id: null as string | null,
  nama: '',
  cara: 'NOMINAL' as CaraPotongan,
  bolehManual: true,
  hanyaPkp: false,
  wajibCatatan: false,
  aktif: true,
};

export function JenisPotonganClient({ baris }: { baris: BarisJenisPotongan[] }) {
  const t = useTranslations('jenisPotongan');
  const td = dinamis(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<typeof KOSONG | null>(null);

  const jalankan = (fn: () => Promise<{ ok: boolean; kode?: string }>, pesan: string, bersih: () => void) => {
    startTransition(async () => {
      const hasil = await fn();
      if (hasil.ok) {
        toast.success(pesan);
        bersih();
        router.refresh();
      } else {
        toast.error(td(`err${hasil.kode}`));
      }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pageTitle')}
        meta={t('summary', { count: baris.filter((b) => b.aktif).length })}
        actions={
          <Button onClick={() => setForm({ ...KOSONG })}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('add')}
          </Button>
        }
      />

      <Card>
        <CardContent className={baris.length === 0 ? 'p-0' : 'px-0'}>
          {baris.length === 0 ? (
            <EmptyState icon={Tags} title={t('emptyTitle')} description={t('emptyBody')} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colName')}</TableHead>
                    <TableHead>{t('colMethod')}</TableHead>
                    <TableHead>{t('colRules')}</TableHead>
                    <TableHead className="text-right">{t('colUsed')}</TableHead>
                    <TableHead className="text-right">{t('colAction')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow key={b.id} className={cn(!b.aktif && 'opacity-60')}>
                      <TableCell className="min-w-[180px] max-w-[320px] whitespace-normal font-medium">
                        {b.nama}
                        {!b.aktif && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {t('inactive')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={b.cara === 'DARI_RETUR' ? 'attention' : 'inactive'}>
                          {td(`method_${b.cara}`)}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="min-w-[180px] whitespace-normal text-xs text-muted-foreground">
                        {[
                          b.wajibCatatan && t('ruleNote'),
                          b.hanyaPkp && t('rulePkp'),
                          !b.bolehManual && t('ruleNoManual'),
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{b.jumlahDipakai}</TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => setForm({ ...b, id: b.id })}
                          >
                            {t('edit')}
                          </Button>
                          {b.aktif && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() =>
                                jalankan(
                                  () => nonaktifkanJenisPotonganAction(b.id),
                                  t('okDisabled'),
                                  () => {},
                                )
                              }
                            >
                              {t('disable')}
                            </Button>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? t('editTitle') : t('addTitle')}</DialogTitle>
            <DialogDescription>{t('formBody')}</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="jp-nama">{t('colName')}</Label>
                <Input
                  id="jp-nama"
                  value={form.nama}
                  onChange={(e) => setForm({ ...form, nama: e.target.value })}
                  placeholder={t('namePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="jp-cara">{t('colMethod')}</Label>
                <Select
                  value={form.cara}
                  onValueChange={(v) => setForm({ ...form, cara: v as CaraPotongan })}
                >
                  <SelectTrigger id="jp-cara">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CARA.map((c) => (
                      <SelectItem key={c} value={c}>
                        {td(`method_${c}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{td(`methodHint_${form.cara}`)}</p>
              </div>

              <Saklar
                label={t('ruleNote')}
                petunjuk={t('ruleNoteHint')}
                nilai={form.wajibCatatan}
                onChange={(v) => setForm({ ...form, wajibCatatan: v })}
              />
              <Saklar
                label={t('rulePkp')}
                petunjuk={t('rulePkpHint')}
                nilai={form.hanyaPkp}
                onChange={(v) => setForm({ ...form, hanyaPkp: v })}
              />
              <Saklar
                label={t('ruleManual')}
                petunjuk={t('ruleManualHint')}
                nilai={form.bolehManual}
                onChange={(v) => setForm({ ...form, bolehManual: v })}
              />
              <Saklar
                label={t('ruleActive')}
                petunjuk={t('ruleActiveHint')}
                nilai={form.aktif}
                onChange={(v) => setForm({ ...form, aktif: v })}
              />
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={pending || !form?.nama.trim()}
              onClick={() =>
                form &&
                jalankan(
                  () => simpanJenisPotonganAction(form),
                  t('okSaved'),
                  () => setForm(null),
                )
              }
            >
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Saklar({
  label,
  petunjuk,
  nilai,
  onChange,
}: {
  label: string;
  petunjuk: string;
  nilai: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{petunjuk}</span>
      </span>
      <Switch checked={nilai} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

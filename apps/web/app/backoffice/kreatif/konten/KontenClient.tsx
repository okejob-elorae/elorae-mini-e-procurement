'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CalendarRange, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import {
  Dialog,
  DialogContent,
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
import { simpanKontenAction } from '@/app/actions/creative';
import type { BarisKonten, RingkasanKreatif } from '@/lib/creative/queries';

const PLATFORM = ['INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA'] as const;
const FORMAT = ['FEED', 'REELS', 'STORY', 'VIDEO', 'LIVE', 'CAROUSEL'] as const;
const STATUS = ['IDE', 'DRAFT', 'REVIEW', 'DIJADWALKAN', 'TAYANG', 'BATAL'] as const;

const NADA: Record<string, StatusTone> = {
  IDE: 'inactive',
  DRAFT: 'inactive',
  REVIEW: 'waiting',
  DIJADWALKAN: 'waiting',
  TAYANG: 'settled',
  BATAL: 'inactive',
};

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        timeZone: 'Asia/Jakarta',
      })
    : '—';

type Draf = {
  title: string;
  platform: (typeof PLATFORM)[number];
  format: (typeof FORMAT)[number];
  status: (typeof STATUS)[number];
  scheduledAt: string;
  caption: string;
  note: string;
  briefId: string;
};

const KOSONG: Draf = {
  title: '',
  platform: 'INSTAGRAM',
  format: 'REELS',
  status: 'IDE',
  scheduledAt: '',
  caption: '',
  note: '',
  briefId: '',
};

export function KontenClient({
  baris,
  ringkas,
  brief,
  bolehMengelola,
}: {
  baris: BarisKonten[];
  ringkas: RingkasanKreatif;
  brief: { id: string; label: string }[];
  bolehMengelola: boolean;
}) {
  const t = useTranslations('creative');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [buka, setBuka] = useState(false);
  const [draf, setDraf] = useState<Draf>(KOSONG);
  const [saring, setSaring] = useState<string>('SEMUA');

  const terlihat = useMemo(
    () => (saring === 'SEMUA' ? baris : baris.filter((b) => b.status === saring)),
    [baris, saring],
  );

  const simpan = () => {
    startTransition(async () => {
      const hasil = await simpanKontenAction(null, {
        title: draf.title,
        platform: draf.platform,
        format: draf.format,
        status: draf.status,
        scheduledAt: draf.scheduledAt || null,
        caption: draf.caption || null,
        note: draf.note || null,
        briefId: draf.briefId || null,
      });
      if (hasil.ok) {
        toast.success(t('okSaved'));
        setBuka(false);
        setDraf(KOSONG);
        router.refresh();
      } else {
        toast.error(t(`err${hasil.kode}` as never));
      }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('contentTitle')}
        description={t('contentDescription')}
        meta={t('contentMeta', {
          count: baris.length,
          scheduled: ringkas.kontenTerjadwal,
          late: ringkas.kontenTerlambat,
        })}
        actions={
          bolehMengelola ? (
            <Button onClick={() => setBuka(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t('newContent')}
            </Button>
          ) : undefined
        }
      />

      {/*
        Beban yang SUDAH diakui dan fee yang baru dijanjikan berdiri sebagai dua
        angka, tidak dijumlahkan. Menjumlahkannya membuat marketing terbaca sudah
        menghabiskan uang yang belum keluar.
      */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Angka label={t('kpiRunningBrief')} nilai={String(ringkas.briefBerjalan)} />
        <Angka label={t('kpiFeeRecognised')} nilai={rupiah(ringkas.bebanDiakui)} />
        <Angka
          label={t('kpiFeeCommitted')}
          nilai={rupiah(ringkas.feeBelumDiakui)}
          kaki={t('kpiFeeCommittedHint')}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={saring} onValueChange={setSaring}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="SEMUA">{t('filterAll')}</SelectItem>
            {STATUS.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`status${s}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className={terlihat.length === 0 ? 'p-0' : 'px-0'}>
          {terlihat.length === 0 ? (
            <EmptyState
              icon={CalendarRange}
              title={t('contentEmptyTitle')}
              description={t('contentEmptyBody')}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colTitle')}</TableHead>
                    <TableHead>{t('colPlatform')}</TableHead>
                    <TableHead>{t('colSchedule')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead>{t('colBrief')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {terlihat.map((k) => (
                    <TableRow key={k.id} className={cn(k.terlambat && 'bg-destructive/[0.05]')}>
                      <TableCell>
                        <span className="font-medium">{k.title}</span>
                        {k.itemNama && (
                          <span className="block text-xs text-muted-foreground">{k.itemNama}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {t(`platform${k.platform}` as never)}
                        <span className="block text-xs text-muted-foreground">
                          {t(`format${k.format}` as never)}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {tanggal(k.scheduledAt)}
                        {k.terlambat && (
                          <span className="block text-xs text-destructive">{t('late')}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={NADA[k.status] ?? 'inactive'}>
                          {t(`status${k.status}` as never)}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {k.briefDocNo ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={buka} onOpenChange={setBuka}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('newContent')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="judul">{t('colTitle')}</Label>
              <Input
                id="judul"
                value={draf.title}
                onChange={(e) => setDraf((d) => ({ ...d, title: e.target.value }))}
                placeholder={t('titlePlaceholder')}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Pilih
                label={t('colPlatform')}
                value={draf.platform}
                onChange={(v) => setDraf((d) => ({ ...d, platform: v as Draf['platform'] }))}
                opsi={PLATFORM.map((p) => ({ value: p, label: t(`platform${p}` as never) }))}
              />
              <Pilih
                label={t('colFormat')}
                value={draf.format}
                onChange={(v) => setDraf((d) => ({ ...d, format: v as Draf['format'] }))}
                opsi={FORMAT.map((f) => ({ value: f, label: t(`format${f}` as never) }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="jadwal">{t('colSchedule')}</Label>
                <Input
                  id="jadwal"
                  type="date"
                  value={draf.scheduledAt}
                  onChange={(e) => setDraf((d) => ({ ...d, scheduledAt: e.target.value }))}
                />
              </div>
              <Pilih
                label={t('colStatus')}
                value={draf.status}
                onChange={(v) => setDraf((d) => ({ ...d, status: v as Draf['status'] }))}
                opsi={STATUS.map((s) => ({ value: s, label: t(`status${s}` as never) }))}
              />
            </div>
            {brief.length > 0 && (
              <Pilih
                label={t('colBrief')}
                value={draf.briefId || 'none'}
                onChange={(v) => setDraf((d) => ({ ...d, briefId: v === 'none' ? '' : v }))}
                opsi={[
                  { value: 'none', label: t('briefNone') },
                  ...brief.map((b) => ({ value: b.id, label: b.label })),
                ]}
              />
            )}
            <div className="space-y-1.5">
              <Label htmlFor="caption">{t('colCaption')}</Label>
              <Textarea
                id="caption"
                rows={3}
                value={draf.caption}
                onChange={(e) => setDraf((d) => ({ ...d, caption: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={pending || draf.title.trim().length === 0} onClick={simpan}>
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Angka({ label, nilai, kaki }: { label: string; nilai: string; kaki?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums">{nilai}</p>
        {kaki && <p className="text-xs text-muted-foreground">{kaki}</p>}
      </CardContent>
    </Card>
  );
}

function Pilih({
  label,
  value,
  onChange,
  opsi,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  opsi: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opsi.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

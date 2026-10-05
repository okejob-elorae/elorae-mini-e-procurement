'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Users, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
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
import { simpanKolAction } from '@/app/actions/creative';
import type { BarisKol } from '@/lib/creative/queries';

const PLATFORM = ['INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA'] as const;

/** Tier makin tinggi makin menonjol, tapi tidak ada yang "buruk" — nano bukan cacat. */
const NADA_TIER: Record<string, StatusTone> = {
  nano: 'inactive',
  mikro: 'waiting',
  makro: 'settled',
  mega: 'settled',
};

const ringkasAngka = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} jt` : n >= 1_000 ? `${(n / 1_000).toFixed(0)} rb` : String(n);
const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

type Akun = { platform: (typeof PLATFORM)[number]; handle: string; followers: number };

export function KolClient({
  baris,
  bolehMengelola,
}: {
  baris: BarisKol[];
  bolehMengelola: boolean;
}) {
  const t = useTranslations('creative');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [buka, setBuka] = useState(false);
  const [nama, setNama] = useState('');
  const [niche, setNiche] = useState('');
  const [kota, setKota] = useState('');
  const [telepon, setTelepon] = useState('');
  const [rate, setRate] = useState('');
  const [akun, setAkun] = useState<Akun[]>([{ platform: 'INSTAGRAM', handle: '', followers: 0 }]);

  const reset = () => {
    setNama('');
    setNiche('');
    setKota('');
    setTelepon('');
    setRate('');
    setAkun([{ platform: 'INSTAGRAM', handle: '', followers: 0 }]);
  };

  const simpan = () => {
    startTransition(async () => {
      const hasil = await simpanKolAction(null, {
        name: nama,
        niche: niche || null,
        city: kota || null,
        phone: telepon || null,
        rateCard: rate ? Number(rate) : null,
        akun: akun.filter((a) => a.handle.trim()),
      });
      if (hasil.ok) {
        toast.success(t('okSaved'));
        setBuka(false);
        reset();
        router.refresh();
      } else {
        toast.error(t(`err${hasil.kode}` as never));
      }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('kolTitle')}
        meta={t('kolMeta', { count: baris.length })}
        actions={
          bolehMengelola ? (
            <Button onClick={() => setBuka(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t('newKol')}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className={baris.length === 0 ? 'p-0' : 'px-0'}>
          {baris.length === 0 ? (
            <EmptyState icon={Users} title={t('kolEmptyTitle')} description={t('kolEmptyBody')} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colName')}</TableHead>
                    <TableHead>{t('colAccounts')}</TableHead>
                    <TableHead>{t('colTier')}</TableHead>
                    <TableHead className="text-right">{t('colRate')}</TableHead>
                    <TableHead className="text-right">{t('colBriefCount')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell>
                        <span className="font-medium">{k.name}</span>
                        {(k.niche || k.city) && (
                          <span className="block text-xs text-muted-foreground">
                            {[k.niche, k.city].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {k.akun.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          k.akun.map((a) => (
                            <span key={`${a.platform}${a.handle}`} className="block">
                              @{a.handle}
                              <span className="ml-1.5 text-xs text-muted-foreground">
                                {t(`platform${a.platform}` as never)} · {ringkasAngka(a.followers)}
                              </span>
                            </span>
                          ))
                        )}
                      </TableCell>
                      <TableCell>
                        {/* Dihitung dari pengikut terbanyak, tidak disimpan — tier
                            yang diketik akan basi tanpa ada yang memperbaruinya. */}
                        <StatusPill tone={NADA_TIER[k.tier] ?? 'inactive'}>
                          {t(`tier_${k.tier}` as never)}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {k.rateCard === null ? (
                          <span className="text-muted-foreground">{t('rateUnset')}</span>
                        ) : (
                          rupiah(k.rateCard)
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{k.jumlahBrief}</TableCell>
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
            <DialogTitle>{t('newKol')}</DialogTitle>
            <DialogDescription>{t('newKolHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="nama-kol">{t('colName')}</Label>
              <Input id="nama-kol" value={nama} onChange={(e) => setNama(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="niche">{t('colNiche')}</Label>
                <Input
                  id="niche"
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  placeholder={t('nichePlaceholder')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kota">{t('colCity')}</Label>
                <Input id="kota" value={kota} onChange={(e) => setKota(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="telp">{t('colPhone')}</Label>
                <Input id="telp" value={telepon} onChange={(e) => setTelepon(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rate">{t('colRate')}</Label>
                <Input
                  id="rate"
                  type="number"
                  min={0}
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('colAccounts')}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setAkun((l) => [...l, { platform: 'TIKTOK', handle: '', followers: 0 }])
                  }
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {t('addAccount')}
                </Button>
              </div>
              {akun.map((a, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <Select
                    value={a.platform}
                    onValueChange={(v) =>
                      setAkun((l) =>
                        l.map((r, n) => (n === i ? { ...r, platform: v as Akun['platform'] } : r)),
                      )
                    }
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLATFORM.map((p) => (
                        <SelectItem key={p} value={p}>
                          {t(`platform${p}` as never)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="min-w-32 flex-1"
                    placeholder={t('handlePlaceholder')}
                    value={a.handle}
                    onChange={(e) =>
                      setAkun((l) => l.map((r, n) => (n === i ? { ...r, handle: e.target.value } : r)))
                    }
                  />
                  <Input
                    className="w-32"
                    type="number"
                    min={0}
                    placeholder={t('followers')}
                    value={a.followers || ''}
                    onChange={(e) =>
                      setAkun((l) =>
                        l.map((r, n) => (n === i ? { ...r, followers: Number(e.target.value) } : r)),
                      )
                    }
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setAkun((l) => l.filter((_, n) => n !== i))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button disabled={pending || nama.trim().length === 0} onClick={simpan}>
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

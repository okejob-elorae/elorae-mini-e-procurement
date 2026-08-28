'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Megaphone, PackageCheck, Plus, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
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
import { pindahStatusBriefAction, buatBriefAction } from '@/app/actions/creative';
import { langkahBerikutBrief, type StatusBrief } from '@/lib/creative/aturan';
import type { BarisBrief } from '@/lib/creative/queries';

const PLATFORM = ['INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LAINNYA'] as const;
const FORMAT = ['FEED', 'REELS', 'STORY', 'VIDEO', 'LIVE', 'CAROUSEL'] as const;

const NADA: Record<string, StatusTone> = {
  DRAFT: 'inactive',
  DIKIRIM: 'waiting',
  DISETUJUI: 'waiting',
  KONTEN_DITERIMA: 'waiting',
  TAYANG: 'settled',
  SELESAI: 'settled',
  BATAL: 'inactive',
};

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

type Deliverable = { platform: (typeof PLATFORM)[number]; format: (typeof FORMAT)[number]; qty: number };
type Barang = { itemId: string; qty: number };

export function BriefClient({
  baris,
  kol,
  katalog,
  bolehMengelola,
}: {
  baris: BarisBrief[];
  kol: { id: string; name: string }[];
  katalog: { value: string; label: string; nama: string }[];
  bolehMengelola: boolean;
}) {
  const t = useTranslations('creative');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [buka, setBuka] = useState(false);
  const [kolId, setKolId] = useState('');
  const [campaign, setCampaign] = useState('');
  const [fee, setFee] = useState('');
  const [briefText, setBriefText] = useState('');
  const [deliverables, setDeliverables] = useState<Deliverable[]>([
    { platform: 'INSTAGRAM', format: 'REELS', qty: 1 },
  ]);
  const [barang, setBarang] = useState<Barang[]>([]);

  const [pindah, setPindah] = useState<{ brief: BarisBrief; ke: StatusBrief } | null>(null);
  const [alasan, setAlasan] = useState('');

  const buat = () => {
    startTransition(async () => {
      const hasil = await buatBriefAction({
        kolId,
        campaign,
        fee: fee ? Number(fee) : 0,
        briefText: briefText || null,
        deliverables,
        barang: barang.filter((b) => b.itemId && b.qty > 0),
      });
      if (hasil.ok) {
        toast.success(t('okBriefCreated', { doc: hasil.docNo ?? '' }));
        setBuka(false);
        setKolId('');
        setCampaign('');
        setFee('');
        setBriefText('');
        setDeliverables([{ platform: 'INSTAGRAM', format: 'REELS', qty: 1 }]);
        setBarang([]);
        router.refresh();
      } else {
        toast.error(t(`err${hasil.kode}` as never) + (hasil.detail ? ` (${hasil.detail})` : ''));
      }
    });
  };

  const jalankanPindah = () => {
    if (!pindah) return;
    const { brief, ke } = pindah;
    startTransition(async () => {
      const hasil = await pindahStatusBriefAction(brief.id, ke, alasan || null);
      if (hasil.ok) {
        toast.success(
          hasil.stokKeluar
            ? t('okSentWithStock', { qty: hasil.stokKeluar })
            : t('okStatusMoved'),
        );
        setPindah(null);
        setAlasan('');
        router.refresh();
      } else {
        toast.error(t(`err${hasil.kode}` as never) + (hasil.detail ? ` (${hasil.detail})` : ''));
      }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('briefTitle')}
        description={t('briefDescription')}
        meta={t('briefMeta', { count: baris.length })}
        actions={
          bolehMengelola && kol.length > 0 ? (
            <Button onClick={() => setBuka(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t('newBrief')}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className={baris.length === 0 ? 'p-0' : 'px-0'}>
          {baris.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title={t('briefEmptyTitle')}
              description={kol.length === 0 ? t('briefEmptyNoKol') : t('briefEmptyBody')}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colDoc')}</TableHead>
                    <TableHead>{t('colKol')}</TableHead>
                    <TableHead>{t('colDeliverable')}</TableHead>
                    <TableHead className="text-right">{t('colFee')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead className="text-right">{t('colAction')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <span className="font-medium">{b.docNo}</span>
                        <span className="block text-xs text-muted-foreground">{b.campaign}</span>
                      </TableCell>
                      <TableCell className="text-sm">{b.kolNama}</TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {t('deliverableCount', { count: b.jumlahDeliverable })}
                        {b.jumlahBarang > 0 && (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <PackageCheck className="h-3 w-3" />
                            {b.barangSudahBerangkat
                              ? t('goodsSent', { qty: b.jumlahBarang })
                              : t('goodsPlanned', { qty: b.jumlahBarang })}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {rupiah(b.fee)}
                        {/* Aturan 1 di layar: fee yang belum tayang belum jadi
                            beban, dan itu dikatakan, bukan disembunyikan. */}
                        <span className="block text-xs text-muted-foreground">
                          {b.bebanDiakui > 0 ? t('feeRecognised') : t('feeNotYet')}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={NADA[b.status] ?? 'inactive'}>
                          {t(`briefStatus${b.status}` as never)}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="text-right">
                        {bolehMengelola && (
                          <span className="inline-flex flex-wrap justify-end gap-1.5">
                            {langkahBerikutBrief(b.status).map((ke) => (
                              <Button
                                key={ke}
                                size="sm"
                                variant={ke === 'BATAL' ? 'outline' : 'default'}
                                disabled={pending}
                                onClick={() => {
                                  setPindah({ brief: b, ke });
                                  setAlasan('');
                                }}
                              >
                                {t(`move${ke}` as never)}
                              </Button>
                            ))}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Konfirmasi pindah status */}
      <Dialog open={pindah !== null} onOpenChange={(o) => !o && setPindah(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pindah ? t(`move${pindah.ke}` as never) + ` · ${pindah.brief.docNo}` : ''}
            </DialogTitle>
            <DialogDescription>
              {pindah?.ke === 'DIKIRIM' && pindah.brief.jumlahBarang > 0
                ? t('confirmSendWithStock', { qty: pindah.brief.jumlahBarang })
                : pindah?.ke === 'BATAL' && pindah.brief.barangSudahBerangkat
                  ? t('confirmCancelAfterSent')
                  : t('confirmMove')}
            </DialogDescription>
          </DialogHeader>
          {pindah?.ke === 'BATAL' && (
            <div className="space-y-2">
              <Label htmlFor="alasan-batal">{t('cancelReason')}</Label>
              <Textarea
                id="alasan-batal"
                rows={3}
                value={alasan}
                onChange={(e) => setAlasan(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button
              variant={pindah?.ke === 'BATAL' ? 'destructive' : 'default'}
              disabled={pending || (pindah?.ke === 'BATAL' && alasan.trim().length === 0)}
              onClick={jalankanPindah}
            >
              {pindah ? t(`move${pindah.ke}` as never) : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Brief baru */}
      <Dialog open={buka} onOpenChange={setBuka}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('newBrief')}</DialogTitle>
            <DialogDescription>{t('newBriefHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('colKol')}</Label>
                <Select value={kolId} onValueChange={setKolId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('pickKol')} />
                  </SelectTrigger>
                  <SelectContent>
                    {kol.map((k) => (
                      <SelectItem key={k.id} value={k.id}>
                        {k.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fee">{t('colFee')}</Label>
                <Input
                  id="fee"
                  type="number"
                  min={0}
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign">{t('colCampaign')}</Label>
              <Input
                id="campaign"
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
                placeholder={t('campaignPlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('colDeliverable')}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setDeliverables((l) => [...l, { platform: 'INSTAGRAM', format: 'FEED', qty: 1 }])
                  }
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {t('addRow')}
                </Button>
              </div>
              {deliverables.map((d, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <Select
                    value={d.platform}
                    onValueChange={(v) =>
                      setDeliverables((l) =>
                        l.map((r, n) => (n === i ? { ...r, platform: v as Deliverable['platform'] } : r)),
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
                  <Select
                    value={d.format}
                    onValueChange={(v) =>
                      setDeliverables((l) =>
                        l.map((r, n) => (n === i ? { ...r, format: v as Deliverable['format'] } : r)),
                      )
                    }
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FORMAT.map((f) => (
                        <SelectItem key={f} value={f}>
                          {t(`format${f}` as never)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="w-20"
                    type="number"
                    min={1}
                    value={d.qty}
                    onChange={(e) =>
                      setDeliverables((l) =>
                        l.map((r, n) => (n === i ? { ...r, qty: Number(e.target.value) } : r)),
                      )
                    }
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setDeliverables((l) => l.filter((_, n) => n !== i))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            {katalog.length > 0 && (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>{t('colGoods')}</Label>
                    {/* Aturan 2 dikatakan tepat di tempat barangnya dipilih. */}
                    <p className="text-xs text-muted-foreground">{t('goodsHint')}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setBarang((l) => [...l, { itemId: '', qty: 1 }])}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {t('addRow')}
                  </Button>
                </div>
                {barang.map((b, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <div className="min-w-48 flex-1">
                      <SearchableCombobox
                        options={katalog}
                        value={b.itemId}
                        onValueChange={(v: string) =>
                          setBarang((l) => l.map((r, n) => (n === i ? { ...r, itemId: v } : r)))
                        }
                        placeholder={t('pickItem')}
                      />
                    </div>
                    <Input
                      className="w-20"
                      type="number"
                      min={1}
                      value={b.qty}
                      onChange={(e) =>
                        setBarang((l) =>
                          l.map((r, n) => (n === i ? { ...r, qty: Number(e.target.value) } : r)),
                        )
                      }
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => setBarang((l) => l.filter((_, n) => n !== i))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="isi-brief">{t('colBriefText')}</Label>
              <Textarea
                id="isi-brief"
                rows={4}
                value={briefText}
                onChange={(e) => setBriefText(e.target.value)}
                placeholder={t('briefTextPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={pending || !kolId || campaign.trim().length === 0}
              onClick={buat}
            >
              {t('saveDraft')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

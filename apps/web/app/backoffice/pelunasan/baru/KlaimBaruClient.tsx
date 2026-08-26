'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/ui/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UnggahFoto, type NilaiFoto } from '@/components/foto/UnggahFoto';
import { cn } from '@/lib/utils';
import { buatKlaimAction } from '@/app/actions/receivables';
import type { BahanKlaimBaru } from '@/lib/receivables/claim-queries';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

function hariIniWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

const CARA = ['transfer', 'tunai', 'giro'] as const;

type Potongan = {
  nama: string;
  nilai: number;
  deductionTypeId: string;
  storeReturnId: string;
  catatan: string;
};

export function KlaimBaruClient({
  bahan,
  kembaliKe = '/backoffice/pelunasan',
}: {
  bahan: BahanKlaimBaru;
  /** Ke mana kembali setelah kirim — berbeda antara kantor dan lapangan. */
  kembaliKe?: string;
}) {
  const t = useTranslations('payments');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [storeId, setStoreId] = useState('');
  const [tglTransfer, setTglTransfer] = useState(hariIniWib());
  const [cara, setCara] = useState<(typeof CARA)[number]>('transfer');
  const [dipilih, setDipilih] = useState<Record<string, number>>({});
  const [potongan, setPotongan] = useState<Potongan[]>([]);
  const [fotoTransfer, setFotoTransfer] = useState<NilaiFoto>(null);
  const [fotoRincian, setFotoRincian] = useState<NilaiFoto>(null);

  const piutang = bahan.piutangPerToko[storeId] ?? [];
  const retur = bahan.returPerToko[storeId] ?? [];
  const jenis = bahan.jenisPotongan;

  const nilaiFaktur = useMemo(
    () => Object.values(dipilih).reduce((s, n) => s + (n || 0), 0),
    [dipilih],
  );
  const totalPotongan = useMemo(
    () => potongan.reduce((s, p) => s + (p.nilai || 0), 0),
    [potongan],
  );
  const diterima = nilaiFaktur - totalPotongan;

  const gantiToko = (id: string) => {
    // Faktur dan nota retur keduanya milik satu toko; membawanya lintas toko
    // akan ditolak penulis, jadi dibersihkan di sini.
    setStoreId(id);
    setDipilih({});
    setPotongan([]);
  };

  const alihkan = (p: { id: string; outstanding: number }) =>
    setDipilih((lama) => {
      const baru = { ...lama };
      if (baru[p.id] !== undefined) delete baru[p.id];
      else baru[p.id] = p.outstanding;
      return baru;
    });

  const simpan = () => {
    startTransition(async () => {
      const hasil = await buatKlaimAction({
        storeId,
        claimedTransferAt: tglTransfer,
        method: cara,
        pelunasan: Object.entries(dipilih).map(([receivableId, nilai]) => ({ receivableId, nilai })),
        potongan: potongan.map((p) => ({
          nama: p.nama,
          nilai: p.nilai,
          deductionTypeId: p.deductionTypeId || null,
          storeReturnId: p.storeReturnId || null,
          catatan: p.catatan,
        })),
        transferPhotoUrl: fotoTransfer?.url ?? null,
        breakdownPhotoUrl: fotoRincian?.url ?? null,
      });
      if (hasil.ok) {
        toast.success(t('okClaimCreated', { doc: hasil.docNo }));
        router.push(kembaliKe);
      } else {
        toast.error(t(`err${hasil.kode}` as never));
      }
    });
  };

  const bisaSimpan =
    !pending &&
    storeId !== '' &&
    Object.keys(dipilih).length > 0 &&
    nilaiFaktur > 0 &&
    diterima >= 0 &&
    fotoTransfer !== null &&
    potongan.every((p) => p.nama.trim() && p.nilai > 0);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href={kembaliKe}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t('backToList')}
        </Link>
      </Button>

      <PageHeader title={t('newTitle')} description={t('newBody')} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('sectionWho')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="bkm-toko">{t('colStore')}</Label>
            <Select value={storeId} onValueChange={gantiToko}>
              <SelectTrigger id="bkm-toko">
                <SelectValue placeholder={t('storePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {bahan.toko.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bkm-tgl">{t('transferDate')}</Label>
            <Input
              id="bkm-tgl"
              type="date"
              value={tglTransfer}
              onChange={(e) => setTglTransfer(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bkm-cara">{t('method')}</Label>
            <Select value={cara} onValueChange={(v) => setCara(v as never)}>
              <SelectTrigger id="bkm-cara">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CARA.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`method_${c}` as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {storeId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('sectionInvoices')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('sectionInvoicesHint')}</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {piutang.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noOpenInvoices')}</p>
            ) : (
              piutang.map((p) => {
                const aktif = dipilih[p.id] !== undefined;
                return (
                  <div
                    key={p.id}
                    className={cn(
                      'flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2',
                      aktif && 'border-primary/50 bg-primary/[0.04]',
                    )}
                  >
                    <Checkbox checked={aktif} onCheckedChange={() => alihkan(p)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{p.invoiceNo}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t('dueOn', { date: tanggal(p.dueDate) })} · {t('outstanding', { value: rupiah(p.outstanding) })}
                      </span>
                    </span>
                    {aktif && (
                      <span className="w-40 space-y-1">
                        <span className="block text-xs text-muted-foreground">{t('settledAmount')}</span>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={p.outstanding}
                          value={dipilih[p.id]}
                          onChange={(e) =>
                            setDipilih((lama) => ({ ...lama, [p.id]: Number(e.target.value) }))
                          }
                        />
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      )}

      {storeId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              {t('sectionDeductions')}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setPotongan((lama) => [
                    ...lama,
                    { nama: '', nilai: 0, deductionTypeId: '', storeReturnId: '', catatan: '' },
                  ])
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('addDeduction')}
              </Button>
            </CardTitle>
            <p className="text-sm text-muted-foreground">{t('sectionDeductionsHint')}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {potongan.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noDeductions')}</p>
            ) : (
              potongan.map((p, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-40 flex-1 space-y-1">
                    <span className="text-xs text-muted-foreground">{t('deductionName')}</span>
                    {/*
                      Dipilih dari master, bukan diketik. Nama bebas membuat
                      "Retur barang" dan "retur brg" jadi dua hal berbeda, dan
                      laporan apa pun di atas potongan pecah.
                    */}
                    {jenis.length > 0 ? (
                      <Select
                        value={p.deductionTypeId || 'lainnya'}
                        onValueChange={(v) =>
                          setPotongan((lama) =>
                            lama.map((r, n) => {
                              if (n !== i) return r;
                              const dipilih = jenis.find((j) => j.id === v);
                              return {
                                ...r,
                                deductionTypeId: dipilih ? v : '',
                                nama: dipilih ? dipilih.nama : r.nama,
                              };
                            }),
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {jenis.map((j) => (
                            <SelectItem key={j.id} value={j.id}>
                              {j.nama}
                            </SelectItem>
                          ))}
                          <SelectItem value="lainnya">{t('deductionOther')}</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={p.nama}
                        placeholder={t('deductionNamePlaceholder')}
                        onChange={(e) =>
                          setPotongan((lama) =>
                            lama.map((r, n) => (n === i ? { ...r, nama: e.target.value } : r)),
                          )
                        }
                      />
                    )}
                    {p.deductionTypeId === '' && jenis.length > 0 && (
                      <Input
                        value={p.nama}
                        placeholder={t('deductionNamePlaceholder')}
                        onChange={(e) =>
                          setPotongan((lama) =>
                            lama.map((r, n) => (n === i ? { ...r, nama: e.target.value } : r)),
                          )
                        }
                      />
                    )}
                  </div>
                  <div className="w-36 space-y-1">
                    <span className="text-xs text-muted-foreground">{t('deductionAmount')}</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={p.nilai}
                      onChange={(e) =>
                        setPotongan((lama) =>
                          lama.map((r, n) => (n === i ? { ...r, nilai: Number(e.target.value) } : r)),
                        )
                      }
                    />
                  </div>
                  {/* Tautan ke nota retur. INI yang membuat Aturan 2 bisa
                      bekerja: tanpa tautannya, potongan ini cuma pengurang
                      harga biasa dan tidak pernah ditahan. */}
                  <div className="min-w-48 flex-1 space-y-1">
                    <span className="text-xs text-muted-foreground">{t('deductionReturn')}</span>
                    <Select
                      value={p.storeReturnId || 'none'}
                      onValueChange={(v) =>
                        setPotongan((lama) =>
                          lama.map((r, n) =>
                            n === i ? { ...r, storeReturnId: v === 'none' ? '' : v } : r,
                          ),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('deductionNoReturn')}</SelectItem>
                        {retur.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.noNrt} · {rupiah(r.nilaiKlaim)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t('removeDeduction')}
                    onClick={() => setPotongan((lama) => lama.filter((_, n) => n !== i))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
            {potongan.some((p) => p.storeReturnId) && (
              <p className="text-xs text-muted-foreground">{t('deductionReturnHint')}</p>
            )}
          </CardContent>
        </Card>
      )}

      {storeId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('sectionProof')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <UnggahFoto
              label={t('transferPhoto')}
              petunjuk={t('transferPhotoHint')}
              nilai={fotoTransfer}
              onChange={setFotoTransfer}
              wajib
              disabled={pending}
            />
            <UnggahFoto
              label={t('breakdownPhoto')}
              petunjuk={t('breakdownPhotoHint')}
              nilai={fotoRincian}
              onChange={setFotoRincian}
              disabled={pending}
            />
          </CardContent>
        </Card>
      )}

      {storeId && (
        <Card className={cn(diterima < 0 && 'border-destructive/50')}>
          <CardContent className="space-y-2 py-4">
            <Baris label={t('totalInvoice')} value={rupiah(nilaiFaktur)} />
            <Baris label={t('totalDeduction')} value={`− ${rupiah(totalPotongan)}`} />
            <div className="flex items-baseline justify-between border-t pt-2">
              <span className="font-medium">{t('totalReceived')}</span>
              <span
                className={cn(
                  'text-lg font-semibold tabular-nums',
                  diterima < 0 && 'text-destructive',
                )}
              >
                {rupiah(diterima)}
              </span>
            </div>
            {diterima < 0 && <p className="text-xs text-destructive">{t('negativeReceived')}</p>}
            <p className="text-xs text-muted-foreground">{t('claimNotSettled')}</p>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button disabled={!bisaSimpan} onClick={simpan}>
          {t('saveClaim')}
        </Button>
      </div>
    </div>
  );
}

function Baris({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

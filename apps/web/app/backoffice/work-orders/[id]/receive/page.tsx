'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { getBahanWo, getDasarBiayaPenerimaan, getWorkOrderById, terimaBarangJadi } from '@/app/actions/production';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import { formatRupiah } from '@/lib/format/rupiah';
import { rincianBiayaPenerimaan, type DasarBiayaPenerimaan } from '@/lib/production/biaya-penerimaan';
import { angkaSetoranWo, lebihDariTarget } from '@/lib/production/setoran-wo';
import { CatatanTanpaDokumen, RingkasSetoran } from '../../RingkasSetoran';
import { WoTidakDitemukan } from '../../WoTidakDitemukan';

export default function WorkOrderReceivePage() {
  const t = useTranslations('toasts');
  const tRc = useTranslations('workOrders.receive');
  const tTolak = useTranslations('productionErrors');
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const id = typeof params.id === 'string' ? params.id : '';
  const [wo, setWO] = useState<Awaited<ReturnType<typeof getWorkOrderById>>>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Σ nilai bahan yang sudah kembali ke gudang — tidak ikut dipikul barang jadi. */
  const [nilaiKembali, setNilaiKembali] = useState(0);
  /** Dasar biaya penerimaan dari server — pratinjau memakai rumus yang sama dengan yang dicatat. */
  const [dasarBiaya, setDasarBiaya] = useState<DasarBiayaPenerimaan | null>(null);

  const [qtyReceived, setQtyReceived] = useState('');
  const [qtyRejected, setQtyRejected] = useState('0');
  const [qcNotes, setQcNotes] = useState('');
  const [qcPhotos, _setQcPhotos] = useState<string[]>([]);
  void _setQcPhotos;
  const [variantQtys, setVariantQtys] = useState<Array<{ variantSku: string; qty: number }>>([]);
  const [rejectedVariantQtys, setRejectedVariantQtys] = useState<Array<{ variantSku: string; qty: number }>>([]);

  useEffect(() => {
    if (!id) return;
    getBahanWo(id)
      .then((r) => setNilaiKembali((r?.riwayat ?? []).reduce((s, b) => s + b.nilai, 0)))
      .catch(() => setNilaiKembali(0));
    getDasarBiayaPenerimaan(id)
      .then(setDasarBiaya)
      .catch(() => setDasarBiaya(null));
    getWorkOrderById(id)
      .then((data) => {
        setWO(data);
        const sb = (data as { skuBreakdown?: unknown })?.skuBreakdown;
        if (Array.isArray(sb) && sb.length > 0) {
          const rows = sb.map((x: { variantSku?: string }) => ({ variantSku: String((x as { variantSku?: string }).variantSku ?? ''), qty: 0 }));
          setVariantQtys(rows);
          setRejectedVariantQtys(rows.map((r) => ({ ...r })));
        } else {
          setVariantQtys([]);
          setRejectedVariantQtys([]);
        }
      })
      .catch(() => {
        toast.error(t('failedToLoadWorkOrder'));
        router.push('/backoffice/work-orders');
      })
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- id, router drive fetch
  }, [id, router]);

  // "Disetor" = semua yang diserahkan CMT, TERMASUK yang cacat; yang masuk
  // stok = disetor − cacat (sama dengan rumus penulis receiveFG).
  const received = Number(qtyReceived) || 0;
  const rejected = Number(qtyRejected) || 0;
  const accepted = Math.max(0, received - rejected);
  const cacatMelebihi = rejected > received;
  const issuesArr = Array.isArray(wo?.issues) ? wo.issues : [];
  const receiptsArr = (Array.isArray(wo?.receipts) ? wo.receipts : []) as Array<{
    qtyReceived: unknown;
    qtyRejected?: unknown;
    qtyAccepted: unknown;
  }>;
  // Satu definisi angka setoran (lib/production/setoran-wo.ts), sama dengan rincian WO dan daftar.
  const setoran = angkaSetoranWo({
    plannedQty: (wo as { plannedQty?: unknown } | null)?.plannedQty,
    actualQty: (wo as { actualQty?: unknown } | null)?.actualQty,
    receipts: receiptsArr,
  });
  const lebih = lebihDariTarget(setoran, accepted);
  const totalMaterialCost = Math.max(
    0,
    (issuesArr as Array<{ totalCost?: unknown }>).reduce((sum, i) => sum + Number(i.totalCost ?? 0), 0) - nilaiKembali
  );
  // Pratinjau memakai rumus yang sama dengan yang dicatat: bahan sebanding
  // setoran, jasa langkah WO dan biaya tambahan per pcs lolos.
  const pratinjau = dasarBiaya
    ? rincianBiayaPenerimaan(dasarBiaya, { qtyDiterima: received, qtyLolos: accepted, tanggal: new Date() })
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id || !wo) return;
    if (received <= 0) {
      toast.error(t('qtyReceivedMustBePositive'));
      return;
    }
    if (cacatMelebihi) {
      toast.error(tRc('cacatMelebihi'));
      return;
    }
    const sb = (wo as { skuBreakdown?: unknown })?.skuBreakdown;
    const needsVariantBreakdown = Array.isArray(sb) && sb.length > 1;
    const singleVariantSku =
      Array.isArray(sb) && sb.length === 1
        ? String((sb[0] as { variantSku?: string }).variantSku ?? "")
        : "";
    if (needsVariantBreakdown) {
      const sumAccepted = variantQtys.reduce((s, x) => s + x.qty, 0);
      if (Math.abs(sumAccepted - accepted) > 0.01) {
        toast.error(tRc('variantSumMismatch'));
        return;
      }
      if (rejected > 0) {
        const sumRejected = rejectedVariantQtys.reduce((s, x) => s + x.qty, 0);
        if (Math.abs(sumRejected - rejected) > 0.01) {
          toast.error(tRc('rejectedSumMismatch'));
          return;
        }
      }
    }
    setIsSubmitting(true);
    try {
      // Penolakan berkode (WO batal/draf) dikembalikan, bukan dilempar:
      // di build produksi pesan lemparan aksi server disamarkan.
      const hasil = await terimaBarangJadi(
        {
          woId: String(wo.id),
          qtyReceived: received,
          qtyRejected: rejected,
          qcNotes: qcNotes.trim() || undefined,
          qcPhotos: qcPhotos.length > 0 ? qcPhotos : undefined,
          skuBreakdown:
            needsVariantBreakdown && variantQtys.length > 0
              ? variantQtys
              : singleVariantSku && accepted > 0
                ? [{ variantSku: singleVariantSku, qty: accepted }]
                : undefined,
          rejectedSkuBreakdown:
            needsVariantBreakdown && rejected > 0 && rejectedVariantQtys.length > 0
              ? rejectedVariantQtys
              : undefined
        }
      );
      if (!hasil.ok) {
        toast.error(tTolak.has(hasil.code) ? tTolak(hasil.code) : t('failedToReceive'));
        return;
      }
      toast.success(t('fgReceived'));
      router.replace(`/backoffice/work-orders/${id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('failedToReceive'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!wo) return <WoTidakDitemukan />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="icon">
          <Link href={`/backoffice/work-orders/${id}`} aria-label={tRc('backToWO')} title={tRc('backToWO')}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-bold">{tRc('title')}</h1>
            <TombolBantuan judul={tRc('title')} />
          </div>
          <p className="text-muted-foreground">{String(wo.docNumber ?? '')}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tRc('cardTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-1 rounded-lg border p-3 text-sm">
              <RingkasSetoran angkaWo={setoran} />
              <CatatanTanpaDokumen angkaWo={setoran} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="qty-disetor">{tRc('qtyReceived')}</Label>
                <Input
                  id="qty-disetor"
                  type="number"
                  min={0}
                  step={1}
                  value={qtyReceived}
                  onChange={(e) => setQtyReceived(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="qty-cacat">{tRc('qtyRejected')}</Label>
                <Input
                  id="qty-cacat"
                  type="number"
                  min={0}
                  step={1}
                  value={qtyRejected}
                  onChange={(e) => setQtyRejected(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="qty-masuk">{tRc('qtyAccepted')}</Label>
                <Input
                  id="qty-masuk"
                  type="text"
                  readOnly
                  value={accepted.toLocaleString('id-ID')}
                  className="bg-muted"
                />
              </div>
            </div>
            <div className="space-y-1 text-sm">
              <p className="font-medium">{tRc('masukStok', { qty: accepted.toLocaleString('id-ID') })}</p>
              {cacatMelebihi ? <p className="text-destructive">{tRc('cacatMelebihi')}</p> : null}
              {lebih > 0 ? (
                <p className="text-amber-800 dark:text-amber-300">
                  {tRc('lebihTargetMasukStok', { lebih: lebih.toLocaleString('id-ID') })}
                </p>
              ) : null}
            </div>
            <div className="rounded-lg border bg-muted/50 p-4">
              <p className="text-sm font-medium">{tRc('costAllocation')}</p>
              <p className="text-muted-foreground">
                {tRc('totalMaterialCost', { value: formatRupiah(totalMaterialCost) })}
                {nilaiKembali > 0 ? ` ${tRc('sudahKembali', { value: formatRupiah(nilaiKembali) })}` : ''} →{' '}
                {accepted > 0 && pratinjau
                  ? tRc('costPerUnit', {
                      cost: formatRupiah(pratinjau.perUnit.toNumber()),
                      accepted: accepted.toLocaleString('id-ID'),
                      total: formatRupiah(pratinjau.total.toNumber()),
                    })
                  : tRc('notAvailable')}
              </p>
              {accepted > 0 && pratinjau ? (
                <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground tabular-nums">
                  <li>{tRc('rincianBahan', { value: formatRupiah(pratinjau.bahan.toNumber()) })}</li>
                  {pratinjau.jasa.perLangkah.length > 0 ? (
                    <li>
                      {tRc('rincianJasa', {
                        langkah: pratinjau.jasa.perLangkah.length,
                        value: formatRupiah(pratinjau.jasa.tagihan.toNumber()),
                      })}
                      {pratinjau.ppnMasukan.gt(0)
                        ? ` ${tRc('rincianPpnMasukan', { value: formatRupiah(pratinjau.ppnMasukan.toNumber()) })}`
                        : ''}
                    </li>
                  ) : null}
                  {pratinjau.tambahan.gt(0) ? (
                    <li>{tRc('rincianTambahan', { value: formatRupiah(pratinjau.tambahan.toNumber()) })}</li>
                  ) : null}
                </ul>
              ) : null}
              {/* Status PKP pemasok jasa belum diisi: PPN jasa dihitung seolah ia memungut PPN. */}
              {dasarBiaya?.langkah.some((l) => l.pemasokPkp == null) ? (
                <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
                  {tRc('pkpPemasokBelumDiisi', {
                    nama: [...new Set(dasarBiaya.langkah.filter((l) => l.pemasokPkp == null).map((l) => l.namaPemasok ?? '?'))].join(', '),
                  })}
                </p>
              ) : null}
            </div>
            {variantQtys.length > 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{tRc('variantBreakdown')}</Label>
                  {variantQtys.map((row, i) => (
                    <div key={row.variantSku} className="flex items-center gap-2">
                      <span className="w-48 truncate text-sm">{row.variantSku}</span>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={row.qty === 0 ? '' : row.qty}
                        onChange={(e) => {
                          const v = Number(e.target.value) || 0;
                          setVariantQtys((prev) => prev.map((p, j) => (j === i ? { ...p, qty: v } : p)));
                        }}
                        placeholder="0"
                        aria-label={tRc('labelVarianMasuk', { sku: row.variantSku })}
                        className="w-24"
                      />
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    {tRc('sumAccepted', {
                      sum: variantQtys.reduce((s, x) => s + x.qty, 0).toLocaleString('id-ID'),
                      accepted: accepted.toLocaleString('id-ID'),
                    })}
                  </p>
                </div>
                {rejected > 0 && (
                  <div className="space-y-2">
                    <Label>{tRc('variantRejected')}</Label>
                    {rejectedVariantQtys.map((row, i) => (
                      <div key={row.variantSku} className="flex items-center gap-2">
                        <span className="w-48 truncate text-sm">{row.variantSku}</span>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={row.qty === 0 ? '' : row.qty}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 0;
                            setRejectedVariantQtys((prev) =>
                              prev.map((p, j) => (j === i ? { ...p, qty: v } : p))
                            );
                          }}
                          placeholder="0"
                          aria-label={tRc('labelVarianCacat', { sku: row.variantSku })}
                          className="w-24"
                        />
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      {tRc('sumRejected', {
                        sum: rejectedVariantQtys.reduce((s, x) => s + x.qty, 0).toLocaleString('id-ID'),
                        rejected: rejected.toLocaleString('id-ID'),
                      })}
                    </p>
                  </div>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="catatan-qc">{tRc('qcNotes')}</Label>
              <Textarea
                id="catatan-qc"
                value={qcNotes}
                onChange={(e) => setQcNotes(e.target.value)}
                placeholder={tRc('qcNotesPlaceholder')}
                rows={3}
              />
            </div>
            <div className="flex gap-4">
              <Button type="submit" disabled={isSubmitting || received <= 0 || cacatMelebihi}>
                {isSubmitting ? tRc('saving') : tRc('save')}
              </Button>
              <Button asChild variant="outline">
                <Link href={`/backoffice/work-orders/${id}`}>{tRc('cancel')}</Link>
              </Button>
            </div>
            {received <= 0 ? <p className="text-xs text-muted-foreground">{tRc('isiDisetorDulu')}</p> : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

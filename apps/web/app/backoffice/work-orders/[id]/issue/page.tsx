'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Barcode, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { BarcodeScanner } from '@/components/scanners/BarcodeScanner';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  getAvailableFabricRolls,
  getBahanWo,
  getWorkOrderById,
  keluarkanBahan,
  type KeluarkanBahanResult,
} from '@/app/actions/production';
import { MaterialRollAllocation, type MaterialRollEntry } from '@/components/work-orders/MaterialRollAllocation';
import { rollShortfalls, withRollItemIds, type RollEntry } from '@/lib/production/roll-allocation';
import { getItemsByType } from '@/app/actions/items';
import { getItemAvgCosts } from '@/app/actions/inventory';
import { ItemType } from '@/lib/constants/enums';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import { newLocalId } from '@/lib/pwa/id-lokal';
import { WoTidakDitemukan } from '../../WoTidakDitemukan';

/** Angka bahan Indonesia ("10,5"), bukan format peramban. */
const fmt = (n: number, maks = 2) => n.toLocaleString('id-ID', { maximumFractionDigits: maks });

interface PlanRow {
  itemId: string;
  itemName: string;
  uomId: string;
  uomCode?: string;
  plannedQty: number;
  issuedQty: number;
  availableStock?: number;
}

interface IssueLine {
  itemId: string;
  itemName: string;
  uomId: string;
  qty: number;
  maxQty: number;
  unitPrice?: number;
}

/** The WO's planned rolls that still have length left, each at what remains on it (#437: per material). */
function plannedRollsStillAvailable(
  planned: MaterialRollEntry[],
  availableByItem: Map<string, Array<{ rollCode: string; rollRef: string; remainingLength: number }>>
): MaterialRollEntry[] {
  const out: MaterialRollEntry[] = [];
  for (const row of planned) {
    const ref = (row.rollRef ?? "").trim();
    if (!ref) continue;
    const live = (availableByItem.get(row.itemId) ?? []).find((r) => r.rollCode === ref || r.rollRef === ref);
    if (!live || live.remainingLength <= 0) continue;
    out.push({
      itemId: row.itemId,
      rollRef: ref,
      qty: live.remainingLength,
      notes: typeof row.notes === "string" ? row.notes : "",
    });
  }
  return out;
}

export default function WorkOrderIssuePage() {
  const t = useTranslations('toasts');
  const tWO = useTranslations('workOrders');
  const tF = useTranslations('workOrders.form');
  const tI = useTranslations('workOrders.issuePage');
  const tTolak = useTranslations('productionErrors');
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const id = typeof params.id === 'string' ? params.id : '';
  const [wo, setWO] = useState<Awaited<ReturnType<typeof getWorkOrderById>>>(null);
  /** Keluar/kembali per bahan dari DOKUMEN (bukan salinan di rencana). */
  const [bahanDok, setBahanDok] = useState<Map<string, { keluar: number; kembali: number }>>(new Map());
  const [materials, setMaterials] = useState<Array<{ id: string; sku: string; nameId: string; uom: { id: string } }>>([]);
  const [lines, setLines] = useState<IssueLine[]>([]);
  const [issueType, setIssueType] = useState<'FABRIC' | 'ACCESSORIES'>('FABRIC');
  const [isPartial, setIsPartial] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [itemAvgCosts, setItemAvgCosts] = useState<Record<string, number>>({});
  const [rollBreakdown, setRollBreakdown] = useState<MaterialRollEntry[]>([]);
  const prefilledWoIdRef = useRef<string | null>(null);
  // Kunci idempotensi per isian: simpan ulang sesudah galat (mis. jawaban hilang) tidak mengeluarkan bahan dua kali.
  const [kunciIsian, setKunciIsian] = useState(() => newLocalId());

  useEffect(() => {
    if (!id) return;
    getBahanWo(id)
      .then((r) => setBahanDok(new Map((r?.baris ?? []).map((b) => [b.itemId, { keluar: b.keluar, kembali: b.kembali }]))))
      .catch(() => setBahanDok(new Map()));
    Promise.all([getWorkOrderById(id), getItemsByType(ItemType.FABRIC)])
      .then(([woData, fabricItems]) => {
        setWO(woData);
        setMaterials((fabricItems as any) || []);
        const plan = (woData?.consumptionPlan as any[]) || [];
        const ids = [
          ...new Set(
            (plan as { itemId?: string }[])
              .map((p) => p.itemId)
              .filter((id): id is string => typeof id === 'string')
          )
        ];
        if (ids.length > 0) {
          getItemAvgCosts(ids).then(setItemAvgCosts);
        }
      })
      .catch(() => {
        toast.error(t('failedToLoadData'));
        router.push('/backoffice/work-orders');
      })
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- id, router drive fetch
  }, [id, router]);

  const consumptionMaterialId =
    wo && typeof wo === "object" && "consumptionMaterialId" in wo
      ? String((wo as { consumptionMaterialId?: string | null }).consumptionMaterialId ?? "")
      : "";

  // Prefill once with the WO's planned rolls that still have length left, per material (#437).
  useEffect(() => {
    if (!wo || prefilledWoIdRef.current === id) return;
    prefilledWoIdRef.current = id;
    const raw = (wo as { rollBreakdown?: unknown }).rollBreakdown;
    const planned = withRollItemIds(Array.isArray(raw) ? (raw as RollEntry[]) : [], consumptionMaterialId || null);
    if (planned.length === 0) return;
    const ids = [...new Set(planned.map((p) => p.itemId))];
    Promise.all(
      ids.map((itemId) =>
        getAvailableFabricRolls(itemId)
          .then((rows): [string, typeof rows] => [itemId, rows])
          .catch((): [string, Awaited<ReturnType<typeof getAvailableFabricRolls>>] => [itemId, []])
      )
    ).then((pairs) => {
      const byItem = new Map(pairs);
      setRollBreakdown((prev) => (prev.length > 0 ? prev : plannedRollsStillAvailable(planned, byItem)));
    });
  }, [wo, consumptionMaterialId, id]);

  const plan = (wo?.consumptionPlan as any[]) || [];
  // A WO on a colour-scoped BOM has one fabric per colour (#437), so any FABRIC item counts, plus
  // the consumption material as before (it may be an accessory).
  const isFabricItem = (itemId: string) =>
    materials.some((m) => m.id === itemId) ||
    (consumptionMaterialId.length > 0 && itemId === consumptionMaterialId);
  const planWithRemaining: PlanRow[] = plan.map((p: any) => ({
    itemId: p.itemId,
    itemName: p.itemName,
    uomId: p.uomId ?? '',
    uomCode: p.uomCode,
    plannedQty: Number(p.plannedQty ?? 0),
    // Dari dokumen bila ada: keluar − yang sudah kembali ke gudang.
    issuedQty: bahanDok.has(p.itemId)
      ? (bahanDok.get(p.itemId)!.keluar - bahanDok.get(p.itemId)!.kembali)
      : Number(p.issuedQty ?? 0),
    availableStock: undefined
  }));

  const switchIssueType = (nextType: "FABRIC" | "ACCESSORIES") => {
    if (nextType === issueType) return;
    if (lines.length > 0) {
      toast.info(tI('typeChanged'));
      setLines([]);
    }
    setIssueType(nextType);
  };

  const addLine = (itemId?: string) => {
    const p = planWithRemaining.find((x) => x.itemId === itemId || !itemId);
    if (!p) return;
    const existing = lines.find((l) => l.itemId === p.itemId);
    if (existing) return;
    const remaining = p.plannedQty - p.issuedQty;
    const defaultPrice = itemAvgCosts[p.itemId];
    const nextLine = {
      itemId: p.itemId,
      itemName: p.itemName,
      uomId: p.uomId,
      qty: remaining > 0 ? Math.min(1, remaining) : 0,
      maxQty: remaining,
      unitPrice: defaultPrice != null && defaultPrice > 0 ? Math.round(defaultPrice * 100) / 100 : undefined,
    };
    const nextType = isFabricItem(p.itemId) ? "FABRIC" : "ACCESSORIES";
    if (nextType !== issueType) {
      switchIssueType(nextType);
      setLines([nextLine]);
      return;
    }
    setLines((prev) => [...prev, nextLine]);
  };

  const updateLineQty = (itemId: string, qty: number) => {
    setLines((prev) =>
      prev.map((l) =>
        l.itemId === itemId
          ? { ...l, qty: Math.max(0, qty) }
          : l
      )
    );
  };

  const removeLine = (itemId: string) => {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));
  };

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const updateLinePrice = (itemId: string, unitPrice: number | '') => {
    setLines((prev) =>
      prev.map((l) =>
        l.itemId === itemId
          ? { ...l, unitPrice: unitPrice === '' ? undefined : round2(unitPrice) }
          : l
      )
    );
  };

  const autoFillRemaining = () => {
    const withRemaining = planWithRemaining.filter((p) => {
      const remaining = p.plannedQty - p.issuedQty;
      if (remaining <= 0) return false;
      return issueType === "FABRIC" ? isFabricItem(p.itemId) : !isFabricItem(p.itemId);
    });
    if (withRemaining.length === 0) {
      toast.info(tI('nothingRemaining'));
      return;
    }
    setLines(
      withRemaining.map((p) => {
        const remaining = p.plannedQty - p.issuedQty;
        const defaultPrice = itemAvgCosts[p.itemId];
        return {
          itemId: p.itemId,
          itemName: p.itemName,
          uomId: p.uomId,
          qty: remaining,
          maxQty: remaining,
          unitPrice: defaultPrice != null && defaultPrice > 0 ? Math.round(defaultPrice * 100) / 100 : undefined,
        };
      })
    );
    toast.success(tI('linesFilled', { count: withRemaining.length }));
  };

  const handleScan = (skuOrId: string) => {
    const bySku = materials.find((m) => m.sku === skuOrId);
    const byId = planWithRemaining.find((p) => p.itemId === skuOrId);
    const itemId = bySku?.id ?? byId?.itemId;
    if (itemId) addLine(itemId);
    setScanOpen(false);
  };

  // Rolls for the staged lines only, per material (#437); a material without rolls is not checked.
  const lineRolls = rollBreakdown.filter((r) => lines.some((l) => l.itemId === r.itemId));
  const rollGaps = rollShortfalls(
    lines.filter((l) => l.qty > 0).map((l) => ({ itemId: l.itemId, qty: l.qty })),
    lineRolls
  );
  const rollValid = rollGaps.length === 0;

  /** Pesan untuk penolakan berkode dari `keluarkanBahan` (pesan lemparan disamarkan di produksi). */
  const pesanTolak = (hasil: Extract<KeluarkanBahanResult, { ok: false }>) => {
    const angka = (n?: number) => fmt(n ?? 0);
    switch (hasil.code) {
      case 'ROLL_KURANG_DARI_KAIN':
        return tI('rollBelowFabric', { roll: angka(hasil.roll), fabric: angka(hasil.kain) });
      case 'STOK_BAHAN_KURANG':
        return tTolak('STOK_BAHAN_KURANG', { barang: hasil.barang ?? '' });
      case 'ROLL_TIDAK_CUKUP':
        return tTolak('ROLL_TIDAK_CUKUP', { kurang: angka(hasil.kurang) });
      default:
        return tTolak.has(hasil.code) ? tTolak(hasil.code) : t('failedToIssue');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id || !wo || lines.length === 0) return;
    const valid = lines.filter((l) => l.qty > 0);
    if (valid.length === 0) {
      toast.error(t('addAtLeastOneLine'));
      return;
    }
    if (rollGaps.length > 0) {
      const gap = rollGaps[0];
      toast.error(
        tI('rollBelowFabric', {
          roll: fmt(gap.allocated),
          fabric: fmt(gap.required),
        })
      );
      return;
    }
    setIsSubmitting(true);
    try {
      // Pelaku dibaca dari sesi di server; penolakan dikembalikan sebagai kode.
      const hasil = await keluarkanBahan({
        woId: String(wo.id),
        issueType,
        isPartial,
        items: valid.map((l) => ({
          itemId: l.itemId,
          qty: l.qty,
          uomId: l.uomId,
          ...(l.unitPrice != null && l.unitPrice > 0 ? { unitPrice: l.unitPrice } : {}),
        })),
        // Always explicit: the picker was prefilled from the WO plan, so an empty list means no rolls.
        rollBreakdown: lineRolls,
        idempotencyKey: kunciIsian,
      });
      if (!hasil.ok) {
        toast.error(pesanTolak(hasil));
        return;
      }
      setKunciIsian(newLocalId());
      toast.success(t('materialsIssued'));
      router.push(`/backoffice/work-orders/${id}`);
      router.refresh();
    } catch {
      toast.error(t('failedToIssue'));
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

  // Tombol simpan yang mati menyebut alasannya (kekurangan pertama menurut urutan isian).
  const alasanMati = isSubmitting
    ? null
    : lines.length === 0
      ? tI('alasanBelumAdaBahan')
      : !rollValid
        ? tI('alasanRollKurang')
        : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="icon">
          <Link href={`/backoffice/work-orders/${id}`} aria-label={tWO('recon.backToWO')} title={tWO('recon.backToWO')}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-bold">{tWO('issueMaterials')}</h1>
            <TombolBantuan judul={tWO('issueMaterials')} />
          </div>
          <p className="text-muted-foreground">{String(wo.docNumber ?? '')}</p>
        </div>
      </div>

      {/* Bertumpuk di bawah 2xl: di 1280–1440 kolom setengah lebar memotong kolom Sisa. */}
      <div className="grid gap-6 2xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{tF('materialPlanTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tWO('material')}</TableHead>
                  <TableHead className="text-right">{tI('kolomRencana')}</TableHead>
                  <TableHead className="text-right">{tI('kolomKeluar')}</TableHead>
                  <TableHead className="text-right">{tI('colRemaining')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {planWithRemaining.map((p) => (
                  <TableRow key={p.itemId}>
                    <TableCell className="whitespace-normal">{p.itemName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(p.plannedQty)} {p.uomCode ?? ''}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(p.issuedQty)} {p.uomCode ?? ''}
                    </TableCell>
                    <TableCell
                      className={
                        p.plannedQty - p.issuedQty < 0
                          ? 'text-right font-medium tabular-nums text-amber-800 dark:text-amber-300'
                          : 'text-right tabular-nums'
                      }
                    >
                      {p.plannedQty - p.issuedQty < 0
                        ? tI('lebihDariRencana', {
                            qty: `${fmt(Math.abs(p.plannedQty - p.issuedQty))} ${p.uomCode ?? ''}`.trim(),
                          })
                        : `${fmt(p.plannedQty - p.issuedQty)} ${p.uomCode ?? ''}`.trim()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{tI('formTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>{tI('issueType')}</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={issueType === "FABRIC" ? "default" : "outline"}
                    onClick={() => switchIssueType("FABRIC")}
                  >
                    {tI('fabric')}
                  </Button>
                  <Button
                    type="button"
                    variant={issueType === "ACCESSORIES" ? "default" : "outline"}
                    onClick={() => switchIssueType("ACCESSORIES")}
                  >
                    {tI('accessories')}
                  </Button>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="partial"
                  checked={isPartial}
                  onCheckedChange={(c) => setIsPartial(!!c)}
                />
                <Label htmlFor="partial">{tI('partial')}</Label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Label>{tI('tambahBahan')}</Label>
                <SearchableCombobox
                  options={planWithRemaining
                    .filter((p) => !lines.some((l) => l.itemId === p.itemId))
                    .map((p) => ({
                      value: p.itemId,
                      label: tI('materialRemaining', {
                        name: p.itemName,
                        qty: `${fmt(p.plannedQty - p.issuedQty)} ${p.uomCode ?? ''}`.trim(),
                      }),
                    }))}
                  value=""
                  onValueChange={(itemId) => addLine(itemId)}
                  placeholder={tI('pilihBahan')}
                  triggerClassName="w-[200px]"
                />
                <Dialog open={scanOpen} onOpenChange={setScanOpen}>
                  <DialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={tI('pindaiBarcode')}
                      title={tI('pindaiBarcode')}
                    >
                      <Barcode className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{tI('pindaiBarcode')}</DialogTitle>
                    </DialogHeader>
                    <BarcodeScanner
                      onScan={handleScan}
                      onClose={() => setScanOpen(false)}
                    />
                  </DialogContent>
                </Dialog>
                <Button type="button" variant="secondary" onClick={autoFillRemaining}>
                  {tI('autoFill')}
                </Button>
              </div>
              {lines.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tWO('material')}</TableHead>
                      <TableHead className="text-right">{tWO('qty')}</TableHead>
                      <TableHead className="text-right">{tI('kolomHargaSatuan')}</TableHead>
                      <TableHead className="w-12">
                        <span className="sr-only">{tWO('detail.colActions')}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l) => (
                      <TableRow key={l.itemId}>
                        <TableCell>{l.itemName}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={l.qty === 0 ? '' : l.qty}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateLineQty(l.itemId, v === '' ? 0 : Number(v));
                            }}
                            className="w-24 text-right"
                            placeholder={l.maxQty > 0 ? tI('maxQty', { max: fmt(l.maxQty) }) : tI('overIssueOk')}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder={itemAvgCosts[l.itemId] != null ? Number(itemAvgCosts[l.itemId]).toFixed(2) : tI('avgCost')}
                            value={l.unitPrice != null ? l.unitPrice.toFixed(2) : ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateLinePrice(l.itemId, v === '' ? '' : Number(v));
                            }}
                            className="w-28 text-right"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLine(l.itemId)}
                          >
                            {tF('remove')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <MaterialRollAllocation
                lines={lines.map((l) => ({ itemId: l.itemId, itemName: l.itemName, qty: l.qty }))}
                value={lineRolls}
                onChange={setRollBreakdown}
                description="Pilih roll utuh per bahan. Total per bahan minimal sama dengan qty yang di-issue."
              />
              <div className="space-y-1">
                <Button type="submit" disabled={isSubmitting || lines.length === 0 || !rollValid}>
                  {isSubmitting ? tI('issuing') : tWO('issueMaterials')}
                </Button>
                {alasanMati ? (
                  <p className="text-sm text-muted-foreground" aria-live="polite">{alasanMati}</p>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

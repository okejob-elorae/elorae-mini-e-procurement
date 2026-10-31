'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ItemForm } from '@/components/forms/ItemForm';
import { updateItem, saveConsumptionRules } from '@/app/actions/items';
import { pushItemStockToJubelio } from '@/app/actions/jubelio-outbox';
import { createItemInJubelio } from '@/app/actions/jubelio-product-push';
import type { ItemFormData } from '@/lib/items/mutations';
import type { JubelioCreateEligibility } from '@/lib/items/jubelio-create-eligibility';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArrowLeft, Barcode, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { ItemType } from '@/lib/constants/enums';
import { PriceHistoryTable } from './PriceHistoryTable';
import { alamatLabel } from "@/lib/items/label";
import { GaleriBelumSimpanContext } from '@/components/items/ItemGalleryEditor';
import type { HppBarang } from "@/lib/items/hpp-barang";

type ItemDetailClientProps = {
  initialData: Parameters<typeof ItemForm>[0]['initialData'];
  /** HPP per pcs barang jadi (hanya dibaca); null untuk bahan/aksesoris. */
  hpp?: HppBarang | null;
  itemType: ItemType;
  nameId: string;
  nameEn: string;
  isActive: boolean;
  gallerySlot?: React.ReactNode;
  jubelioStockPushEnabled: boolean;
  /* null when the viewer lacks items:edit; only `eligible` and `category_unmapped` render anything. */
  jubelioCreateState: JubelioCreateEligibility | null;
};

export function ItemDetailClient({
  initialData,
  hpp = null,
  itemType,
  nameId,
  nameEn,
  isActive,
  gallerySlot,
  jubelioStockPushEnabled,
  jubelioCreateState,
}: ItemDetailClientProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const tItems = useTranslations('items');
  const tLabel = useTranslations("labelBarcode");
  const [isSaving, setIsSaving] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isCreatingInJubelio, setIsCreatingInJubelio] = useState(false);
  const [jubelioCreated, setJubelioCreated] = useState(false);
  const [konfirmasiPush, setKonfirmasiPush] = useState(false);
  const tDetail = useTranslations('itemDetail');
  const tForm = useTranslations('itemForm');
  const itemTypeLabel = tForm(`typeName.${itemType}`);
  // Galeri foto punya tombol simpan sendiri; jumlah perubahannya dilaporkan lewat konteks.
  const [galeriBelumSimpan, setGaleriBelumSimpan] = useState(0);
  const isAdmin = session?.user?.permissions?.includes("*") ?? false;
  const showCreateInJubelio =
    (jubelioCreateState === 'eligible' || jubelioCreateState === 'category_unmapped') && !jubelioCreated;

  const handlePushStock = async () => {
    if (!initialData?.id) return;
    setKonfirmasiPush(false);
    setIsPushing(true);
    try {
      const r = await pushItemStockToJubelio(initialData.id);
      if (r.ok) toast.success(tItems("pushToJubelioQueued"));
      else if (r.reason === "push_disabled") toast.error(tItems("pushToJubelioDisabledHint"));
      else if (r.reason === "not_admin") toast.error(tItems("pushToJubelioFailed"));
      else toast.error(tItems("pushToJubelioUnexpectedFailed"));
    } catch {
      toast.error(tItems("pushToJubelioUnexpectedFailed"));
    } finally {
      setIsPushing(false);
    }
  };

  const handleCreateInJubelio = async () => {
    if (!initialData?.id) return;
    if (!confirm(tItems("createInJubelioConfirm"))) return;
    setIsCreatingInJubelio(true);
    try {
      const r = await createItemInJubelio(initialData.id);
      if (r.ok) {
        setJubelioCreated(true);
        toast.success(tItems("createInJubelioQueued"));
      } else if (r.reason === "already_queued" || r.reason === "already_mapped") {
        setJubelioCreated(true);
        toast.info(tItems("createInJubelioAlready"));
      } else if (r.reason === "category_unmapped") {
        toast.error(tItems("createInJubelioNeedsCategory"));
      } else {
        toast.error(tItems("createInJubelioFailed"));
      }
    } catch {
      toast.error(tItems("createInJubelioFailed"));
    } finally {
      setIsCreatingInJubelio(false);
    }
  };

  const handleSubmit = async (
    data: ItemFormData,
    consumptionRules?: Array<{
      materialId: string;
      qtyRequired: number;
      wastePercent: number;
      notes?: string;
      colorId?: string | null;
      size?: string | null;
    }>
  ) => {
    if (!initialData?.id) return;
    setIsSaving(true);
    try {
      const result = await updateItem(initialData.id, data);
      if (!result.success) {
        toast.error(tItems(`saveRefusal.${result.code}`, { detail: result.detail }));
        return;
      }
      if (data.type === ItemType.FINISHED_GOOD && consumptionRules) {
        await saveConsumptionRules(initialData.id, consumptionRules);
      }
      if (galeriBelumSimpan > 0) {
        // Tetap di halaman: pindah ke daftar membuang gambar yang belum disimpan.
        toast.warning(tDetail('tersimpanGaleriBelum'), { duration: 10000 });
        router.refresh();
        return;
      }
      toast.success(tDetail('tersimpan'));
      router.push('/backoffice/items');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : tDetail('gagalSimpan');
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/backoffice/items">
            <Button
              variant="ghost"
              size="icon"
              aria-label={tDetail('kembali')}
              title={tDetail('kembali')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <h1 className="text-2xl font-bold tracking-tight">{nameId}</h1>
              <TombolBantuan judul={nameId} />
            </div>
            {/* Nama Inggris kosong diisi nama Indonesia — jangan ditulis dua kali. */}
            {nameEn.trim() && nameEn.trim() !== nameId.trim() ? <p className="text-muted-foreground">{nameEn}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {itemType === ItemType.FINISHED_GOOD && initialData?.id ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={alamatLabel({ itemId: initialData.id })}>
                <Barcode className="h-4 w-4" />
                {tLabel("tombolHalamanBarang")}
              </Link>
            </Button>
          ) : null}
          {showCreateInJubelio && (
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={isCreatingInJubelio || jubelioCreateState === 'category_unmapped'}
                onClick={() => void handleCreateInJubelio()}
              >
                {isCreatingInJubelio ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                {tItems('createInJubelio')}
              </Button>
              {jubelioCreateState === 'category_unmapped' && (
                <p className="max-w-xs text-right text-xs text-muted-foreground">
                  {tItems('createInJubelioNeedsCategory')}
                </p>
              )}
            </div>
          )}
          {isAdmin && (
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={!jubelioStockPushEnabled || isPushing}
                onClick={() => setKonfirmasiPush(true)}
              >
                {isPushing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                {tItems('detail.pushStock')}
              </Button>
              {!jubelioStockPushEnabled && (
                <p className="max-w-xs text-right text-xs text-muted-foreground">
                  {tItems("pushToJubelioDisabledHint")}
                </p>
              )}
            </div>
          )}
          <Badge variant={isActive ? 'default' : 'secondary'}>{itemTypeLabel}</Badge>
        </div>
      </div>

      <Tabs defaultValue="details" className="space-y-4">
        <TabsList>
          <TabsTrigger value="details">{tItems('detail.tabDetails')}</TabsTrigger>
          <TabsTrigger value="price-history">{tDetail('tabRiwayatHarga')}</TabsTrigger>
        </TabsList>
        {/* Tetap terpasang saat tab lain dibuka: isian formulir dan gambar yang
            belum disimpan tidak boleh hilang hanya karena melihat riwayat harga. */}
        <TabsContent value="details" forceMount className="space-y-4 data-[state=inactive]:hidden">
          <GaleriBelumSimpanContext.Provider value={setGaleriBelumSimpan}>
            <ItemForm initialData={initialData} hpp={hpp} onSubmit={handleSubmit} isLoading={isSaving} />
            {gallerySlot}
          </GaleriBelumSimpanContext.Provider>
        </TabsContent>
        <TabsContent value="price-history">
          {initialData?.id ? (
            <PriceHistoryTable itemId={initialData.id} />
          ) : (
            <div className="text-sm text-muted-foreground">
              {tItems('detail.saveFirst')}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={konfirmasiPush} onOpenChange={setKonfirmasiPush}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tItems('detail.pushStock')}</AlertDialogTitle>
            <AlertDialogDescription>{tDetail('pushStockConfirmV2')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tDetail('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handlePushStock()}>{tDetail('pushConfirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

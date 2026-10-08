'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ItemForm } from '@/components/forms/ItemForm';
import { updateItem, saveConsumptionRules } from '@/app/actions/items';
import { pushItemStockToJubelio } from '@/app/actions/jubelio-outbox';
import type { ItemFormData } from '@/lib/items/mutations';
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
import { ArrowLeft, Barcode } from 'lucide-react';
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
};

export function ItemDetailClient({
  initialData,
  hpp = null,
  itemType,
  nameId,
  nameEn,
  isActive,
  gallerySlot,
}: ItemDetailClientProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const tItems = useTranslations('items');
  const tLabel = useTranslations("labelBarcode");
  const [isSaving, setIsSaving] = useState(false);
  const [konfirmasiPush, setKonfirmasiPush] = useState(false);
  const tDetail = useTranslations('itemDetail');
  const tForm = useTranslations('itemForm');
  const itemTypeLabel = tForm(`typeName.${itemType}`);
  // Galeri foto punya tombol simpan sendiri; jumlah perubahannya dilaporkan lewat konteks.
  const [galeriBelumSimpan, setGaleriBelumSimpan] = useState(0);
  const isAdmin = session?.user?.permissions?.includes("*") ?? false;

  const handlePushStock = async () => {
    if (!initialData?.id) return;
    setKonfirmasiPush(false);
    const r = await pushItemStockToJubelio(initialData.id);
    if (r.ok) toast.success(tItems('detail.pushStockQueued'));
    else toast.error(tItems('detail.pushStockFailed'));
  };

  const handleSubmit = async (
    data: ItemFormData,
    consumptionRules?: Array<{
      materialId: string;
      qtyRequired: number;
      wastePercent: number;
      notes?: string;
    }>
  ) => {
    if (!initialData?.id) return;
    setIsSaving(true);
    try {
      await updateItem(initialData.id, data);
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
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
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-2xl font-bold tracking-tight">{nameId}</h1>
              <TombolBantuan judul={nameId} />
            </div>
            {/* Nama Inggris kosong diisi nama Indonesia — jangan ditulis dua kali. */}
            {nameEn.trim() && nameEn.trim() !== nameId.trim() ? <p className="text-muted-foreground">{nameEn}</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {itemType === ItemType.FINISHED_GOOD && initialData?.id ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={alamatLabel({ itemId: initialData.id })}>
                <Barcode className="h-4 w-4" />
                {tLabel("tombolHalamanBarang")}
              </Link>
            </Button>
          ) : null}
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setKonfirmasiPush(true)}>
              {tItems('detail.pushStock')}
            </Button>
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

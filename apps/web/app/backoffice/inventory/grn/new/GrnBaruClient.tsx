'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { GRNForm } from '@/components/grn/GRNForm';
import { Button } from '@/components/ui/button';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { offlineDB } from '@/lib/offline/db';
import { isOnline } from '@/lib/offline/sync';
import { getPemasokPilihan } from '@/app/actions/purchase-orders';
import { useTranslations } from 'next-intl';
import { useSession } from 'next-auth/react';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';

interface Supplier {
  id: string;
  code: string;
  name: string;
  disetujui?: boolean;
}

/**
 * Formulir GRN baru. `poIdAwal` dari `?poId=` (tombol "Terima barang" di
 * rincian PO). Pemasok: yang disetujui DAN yang punya dokumen — saringan "disetujui saja"
 * dulu membuat pemasok PO yang sedang diterima tidak ada di pilihan.
 */
export function GrnBaruClient({ poIdAwal }: { poIdAwal: string }) {
  const router = useRouter();
  const t = useTranslations('inventory.grnForm');
  const tToasts = useTranslations('toasts');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(true);

  useEffect(() => {
    const fetchSuppliers = async () => {
      try {
        const cached = await offlineDB.suppliers.toArray();
        if (cached.length > 0) {
          setSuppliers(cached.map((s) => ({ id: s.id, code: s.code, name: s.name })));
        }
        if (isOnline()) {
          const list = await getPemasokPilihan();
          setSuppliers(list.map((s) => ({ id: s.id, code: s.code, name: s.name, disetujui: s.disetujui })));
        }
      } catch (error) {
        console.error('Failed to fetch suppliers:', error);
        toast.error(tToasts('failedToLoadSuppliers'));
      } finally {
        setIsLoadingSuppliers(false);
      }
    };
    fetchSuppliers();
  }, [tToasts]);

  // Dibuka dari rincian PO → kembali ke PO itu (kartu GRN-nya) bila boleh membukanya;
  // selain itu ke tab Penerimaan Barang (gudang biasanya tanpa purchase_orders:view).
  const { data: session } = useSession();
  const bolehBukaPo = hasPermission(session?.user?.permissions ?? [], PERMISSIONS.PURCHASE_ORDERS_VIEW);
  const tujuanKembali =
    poIdAwal && bolehBukaPo
      ? `/backoffice/purchase-orders/${encodeURIComponent(poIdAwal)}`
      : '/backoffice/inventory?tab=grn';

  const handleSuccess = () => {
    router.push(tujuanKembali);
    router.refresh();
  };

  if (isLoadingSuppliers) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href={tujuanKembali} aria-label={t('backToInventory')} title={t('backToInventory')}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('judulHalaman')}</h1>
          <TombolBantuan judul={t('judulHalaman')} />
        </div>
      </div>

      <GRNForm suppliers={suppliers} onSuccess={handleSuccess} poIdAwal={poIdAwal} />
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { POForm } from "@/components/forms/POForm";
import { createPO } from "@/app/actions/purchase-orders";
import { offlineDB, savePOLocally } from "@/lib/offline/db";
import { isOnline } from "@/lib/offline/sync";
import { getSuppliersForSelect } from "@/app/actions/suppliers";
import { getPpnRatePercent } from "@/app/actions/settings/ppn";
import { bulatkanTarifPpn } from "@/lib/purchase-orders/ppn";
import type { IsiPoDariTahap } from "@/lib/purchase-orders/isi-dari-tahap";

interface Supplier {
  id: string;
  code: string;
  name: string;
}

type DataPo = Parameters<typeof POForm>[0]["onSubmit"] extends (data: infer T) => unknown ? T : never;

/**
 * Formulir PO baru. `dariTahap` datang dari `?planStageId=` ("Buat PO" di ruang
 * kerja tahap produksi), sudah diperiksa server: tahapnya, kebutuhan bahannya,
 * dan — bila diminta `isi=kurang` — baris kekurangan bahan. `tahapHilang` =
 * alamatnya menunjuk tahap yang tidak ada, jadi PO dibuat tanpa tahap.
 */
export function PoBaruClient({ dariTahap, tahapHilang }: { dariTahap: IsiPoDariTahap | null; tahapHilang: boolean }) {
  const router = useRouter();
  const { data: session } = useSession();
  const tPO = useTranslations("purchaseOrders");
  const tToasts = useTranslations("toasts");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(true);
  // Tarif PPN Pengaturan → Pajak untuk pratinjau total; server tetap membaca tarifnya sendiri.
  // `undefined` = belum diketahui (belum termuat / luring) — PPN tetap dihitung saat disimpan.
  const [ppnRatePercent, setPpnRatePercent] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!isOnline()) return;
    getPpnRatePercent()
      .then((tarif) => setPpnRatePercent(bulatkanTarifPpn(tarif)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const fetchSuppliers = async () => {
      try {
        // Try to get from cache first (for offline)
        const cached = await offlineDB.suppliers.toArray();
        if (cached.length > 0) {
          setSuppliers(cached.map((s) => ({ id: s.id, code: s.code, name: s.name })));
        }

        // Fetch from API if online
        if (isOnline()) {
          const data = await getSuppliersForSelect({ sync: true, approvedOnly: true });
          const list = Array.isArray(data) ? data : [];
          setSuppliers(list.map((s: { id: string; code: string; name: string }) => ({ id: s.id, code: s.code, name: s.name })));
        }
      } catch (error) {
        console.error("Failed to fetch suppliers:", error);
        toast.error(tPO("loadSuppliersFailed"));
      } finally {
        setIsLoadingSuppliers(false);
      }
    };

    fetchSuppliers();
  }, [tPO]);

  const handleSubmit = async (data: DataPo) => {
    if (!session?.user?.id) {
      toast.error(tToasts("youMustBeLoggedIn"));
      return;
    }

    setIsLoading(true);
    try {
      const hasil = await createPO(data, session.user.id);
      if (!hasil.ok) {
        // Tahapnya dihapus sejak formulir dibuka: lepas tahap lalu simpan lagi.
        toast.error(tPO("tahap.errTahapTidakAda"));
        return;
      }
      toast.success(tPO("toastCreated"));
      router.push(`/backoffice/purchase-orders/${hasil.id}`);
    } catch (error: unknown) {
      toast.error((error instanceof Error && error.message) || tPO("createFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveLocally = async (
    data: DataPo,
    context: {
      enrichedItems: Array<{
        itemId: string;
        qty: number;
        price: number;
        uomId: string;
        sku?: string;
        itemName?: string;
        uomCode?: string;
      }>;
      totalAmount: number;
      supplier?: Supplier;
    }
  ) => {
    setIsLoading(true);
    try {
      await savePOLocally({
        supplierId: data.supplierId,
        supplierName: context.supplier?.name,
        etaDate: data.etaDate || undefined,
        paymentDueDate: data.paymentDueDate || undefined,
        items: context.enrichedItems.map((item) => ({
          itemId: item.itemId,
          qty: item.qty,
          price: item.price,
          uomId: item.uomId,
          sku: item.sku,
          itemName: item.itemName,
        })),
        totalAmount: context.totalAmount,
        notes: data.notes,
        planStageId: data.planStageId || undefined,
        status: "PENDING_SYNC",
      });
      toast.success(tPO("savedLocally"));
      router.push("/backoffice/purchase-orders");
    } catch (error: unknown) {
      toast.error((error instanceof Error && error.message) || tPO("saveLocallyFailed"));
    } finally {
      setIsLoading(false);
    }
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
      <PageHeader title={tPO("newPageTitle")} />

      {tahapHilang && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{tPO("tahap.tidakDitemukan")}</AlertDescription>
        </Alert>
      )}
      {dariTahap?.isi && dariTahap.isi.items.length === 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{tPO("kebutuhan.tidakAdaKurang")}</AlertDescription>
        </Alert>
      )}

      <POForm
        suppliers={suppliers}
        ppnRatePercent={ppnRatePercent}
        tahap={dariTahap?.tahap ?? null}
        kebutuhanTahap={dariTahap?.kebutuhan ?? null}
        isiAwal={dariTahap?.isi ?? null}
        onSubmit={handleSubmit}
        onSaveLocally={handleSaveLocally}
        isLoading={isLoading}
      />
    </div>
  );
}

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formatDisplayDateTime } from "@/lib/date-only";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { riwayatGudangRusak, saldoGudangRusak } from "@/lib/spg/gudang-rusak-queries";
import { GudangRusakClient } from "./GudangRusakClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ tab?: string }> };

/**
 * Gudang barang rusak: saldo per barang × varian dan gerakan terakhir.
 * Melihat = `inventory:view` (juga dipetakan di `ROUTE_PERMISSIONS`);
 * memutuskan = `inventory:manage` — aksinya memeriksa ulang izinnya.
 */
export default async function GudangRusakPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.INVENTORY_VIEW)) redirect("/backoffice");
  const bolehPutuskan = hasPermission(izin, PERMISSIONS.INVENTORY_MANAGE);

  const { tab } = await searchParams;
  const [saldo, riwayat] = await Promise.all([saldoGudangRusak(), riwayatGudangRusak()]);

  return (
    <GudangRusakClient
      tab={tab === "riwayat" ? "riwayat" : "saldo"}
      bolehPutuskan={bolehPutuskan}
      saldo={saldo}
      // Tanggal diformat di server (WIB) — format di klien bisa berbeda antara Node dan peramban.
      riwayat={riwayat.map((g) => ({
        id: g.id,
        waktu: formatDisplayDateTime(g.createdAt),
        productName: g.productName,
        variantSku: g.variantSku,
        jenis: g.jenis,
        qty: g.qty,
        nilai: g.nilai,
        catatan: g.catatan,
        oleh: g.oleh,
        masuk: g.masuk,
        penyesuaian: g.penyesuaian,
      }))}
    />
  );
}

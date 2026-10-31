import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarRusakKantor, type BarisRusakKantor } from "@/lib/spg/rusak-queries";
import { DaftarRusakClient, type BarisRusakTampil } from "./DaftarRusakClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ tab?: string }> };

/**
 * Barang rusak yang dicatat SPG saat menerima kiriman. Halaman ini memagari
 * dirinya sendiri (tidak ada di `ROUTE_PERMISSIONS`): pengawas SPG
 * (`spg_sales:view`) ATAU gudang (`inventory:manage`) boleh melihat, dan hanya
 * gudang yang memutuskan — aksinya memeriksa ulang izinnya.
 */
export default async function SpgKirimanRusakPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  const bolehPutuskan = hasPermission(izin, PERMISSIONS.INVENTORY_MANAGE);
  if (!bolehPutuskan && !hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const { tab } = await searchParams;
  const data = await daftarRusakKantor();

  // Tanggal diformat di server (WIB) — format di klien bisa berbeda antara Node dan peramban.
  const tampil = (b: BarisRusakKantor): BarisRusakTampil => ({
    id: b.id,
    toko: b.toko,
    sourceType: b.sourceType,
    docNo: b.docNo,
    diterima: formatDisplayDate(b.diterimaPada),
    penerima: b.penerima,
    productName: b.productName,
    variantSku: b.variantSku,
    katalog: b.itemId !== null,
    qtyReceived: b.qtyReceived,
    qty: b.qty,
    keterangan: b.keterangan,
    fotoUrl: b.fotoUrl,
    status: b.status,
    diputuskanOleh: b.diputuskanOleh,
    diputuskanPada: b.diputuskanPada ? formatDisplayDateTime(b.diputuskanPada) : null,
    catatanKeputusan: b.catatanKeputusan,
    dikembalikan: b.dikembalikan,
    notaRetur: b.notaRetur,
  });

  return (
    <DaftarRusakClient
      tab={tab === "riwayat" ? "riwayat" : "terbuka"}
      terbuka={data.terbuka.map(tampil)}
      riwayat={data.riwayat.map(tampil)}
      bolehPutuskan={bolehPutuskan}
    />
  );
}

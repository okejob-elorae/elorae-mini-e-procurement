import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { pilihanBarangInden, rincianJendelaInden } from "@/lib/field-sales/inden-queries";
import { bacaIdInden, bolehDiubah, isianTanggal } from "@/lib/field-sales/inden";
import { RincianIndenClient } from "./RincianIndenClient";

export const dynamic = "force-dynamic";

export default async function RincianIndenPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.FIELD_SALES_ORDERS_VIEW)) redirect("/backoffice");

  const id = bacaIdInden((await params).id);
  const rincian = id ? await rincianJendelaInden(id) : null;
  if (!rincian) notFound();

  const canManage = hasPermission(permissions, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE);
  const bisaUbah = canManage && bolehDiubah(rincian.keadaan);
  // Daftar barang untuk formulir ubah hanya dimuat bila formulirnya memang bisa dibuka.
  const pilihan = bisaUbah ? await pilihanBarangInden() : [];

  return (
    <RincianIndenClient
      rincian={rincian}
      canManage={canManage}
      bisaUbah={bisaUbah}
      pilihan={pilihan}
      awal={{
        id: rincian.id,
        name: rincian.name,
        note: rincian.note,
        opensOn: isianTanggal(rincian.opensAt),
        closesOn: isianTanggal(rincian.closesAt),
        shipFrom: isianTanggal(rincian.shipFrom),
        shipTo: isianTanggal(rincian.shipTo),
        isActive: rincian.isActive,
        items: rincian.barang.map((b) => ({ itemId: b.itemId, sku: b.sku, nameId: b.nameId, plannedQty: b.rencana })),
      }}
      // Barang yang sudah dipesan (pesanan belum ditolak) tidak bisa dikeluarkan — penulis menolaknya juga.
      dipesanItemIds={rincian.barang.filter((b) => b.dipesan > 0).map((b) => b.itemId)}
    />
  );
}

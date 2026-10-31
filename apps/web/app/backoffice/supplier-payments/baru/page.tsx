import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { urutPemasok } from "@/lib/suppliers/label-pemasok";
import { rekeningKasBank } from "@/lib/finance/pajak/setoran-queries";
import { bacaTarifPajakKreatif } from "@/lib/creative/pajak-pengaturan";
import { bacaHutangPemasok, type HutangPemasok } from "@/lib/purchasing/pembayaran-hutang-queries";
import { FormPembayaranPemasok } from "./FormPembayaranPemasok";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;
const satu = (v: Param) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Pembelian → Pembayaran pemasok → Bayar: satu pembayaran ke satu pemasok,
 * sebagian atau penuh, ke banyak dokumen hutang (penerimaan barang, jasa
 * produksi/CMT, hutang saldo awal) plus uang muka, dengan potongan PPh.
 * `?pemasok=` memilih pemasok, `?po=` mengisi penerimaan PO itu sebesar sisanya.
 * Butuh `supplier_payments:create`.
 */
export default async function BayarPemasokPage({ searchParams }: { searchParams: Promise<{ pemasok?: Param; po?: Param }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.SUPPLIER_PAYMENTS_CREATE)) redirect("/backoffice/supplier-payments");

  const sp = await searchParams;
  const pemasokId = satu(sp.pemasok).slice(0, 64);
  const poId = satu(sp.po).slice(0, 64);
  const [pemasok, rekening, tarif] = await Promise.all([
    prisma.supplier.findMany({
      where: { OR: [{ status: "ACTIVE" }, { purchaseOrders: { some: {} } }, { grns: { some: {} } }, { workOrderSteps: { some: {} } }] },
      select: { id: true, code: true, name: true, status: true },
    }),
    rekeningKasBank(),
    bacaTarifPajakKreatif(),
  ]);
  let awal: HutangPemasok | null = null;
  let apBelumDipetakan = false;
  if (pemasokId) {
    const h = await bacaHutangPemasok({ supplierIds: [pemasokId] });
    awal = h.pemasok[0] ?? null;
    apBelumDipetakan = h.apBelumDipetakan;
  }
  return (
    <FormPembayaranPemasok
      pemasok={urutPemasok(pemasok).map((p) => ({ id: p.id, kode: p.code, nama: p.name, disetujui: p.status === "ACTIVE" }))}
      rekening={rekening}
      tarif={tarif}
      hariIni={hariIniWib()}
      awal={awal}
      apBelumDipetakanAwal={apBelumDipetakan}
      poAwal={poId || null}
    />
  );
}

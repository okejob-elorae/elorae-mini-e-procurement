import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { urutPemasok } from "@/lib/suppliers/label-pemasok";
import { rekeningKasBank } from "@/lib/finance/pajak/setoran-queries";
import { bacaTarifPajakKreatif } from "@/lib/creative/pajak-pengaturan";
import { bacaHutangPemasok, type HutangPemasok } from "@/lib/purchasing/pembayaran-hutang-queries";
import { bacaInvoiceUntukBayar, type DataBayarInvoice } from "@/lib/vendor-billing/invoice-bayar-queries";
import { FormPembayaranPemasok } from "./FormPembayaranPemasok";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;
const satu = (v: Param) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Pembelian → Pembayaran pemasok → Bayar: satu pembayaran ke satu pemasok,
 * sebagian atau penuh, ke banyak dokumen hutang (penerimaan barang, jasa
 * produksi/CMT, hutang saldo awal) plus uang muka, dengan potongan PPh.
 * `?pemasok=` memilih pemasok, `?po=` mengisi penerimaan PO itu sebesar sisanya,
 * `?invoice=` mencentang tagihan terbuka pemasok itu di "Bayar per invoice" (Q19, P20);
 * tagihan yang sudah lunas → "Invoice ini sudah lunas"; id lain diabaikan.
 * Butuh `supplier_payments:create`.
 */
export default async function BayarPemasokPage({ searchParams }: { searchParams: Promise<{ pemasok?: Param; po?: Param; invoice?: Param }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.SUPPLIER_PAYMENTS_CREATE)) redirect("/backoffice/supplier-payments");

  const sp = await searchParams;
  const pemasokId = satu(sp.pemasok).slice(0, 64);
  const poId = satu(sp.po).slice(0, 64);
  const invoiceId = satu(sp.invoice).slice(0, 64);
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
  // Basis data tanpa tabel tagihan vendor (PostgreSQL): formulir tanpa kartu invoice.
  let invoiceAwal: DataBayarInvoice | null = null;
  let invoicePilihAwal: string | null = null;
  let invoiceLunasDariUrl: string | null = null;
  if (pemasokId) {
    try {
      invoiceAwal = await bacaInvoiceUntukBayar(pemasokId);
      if (invoiceId) {
        if (invoiceAwal.invoice.some((i) => i.id === invoiceId)) invoicePilihAwal = invoiceId;
        else {
          const b = await prisma.vendorBill.findFirst({ where: { id: invoiceId, supplierId: pemasokId, status: { not: "VOID" } }, select: { vendorInvoiceNo: true } });
          invoiceLunasDariUrl = b?.vendorInvoiceNo ?? null;
        }
      }
    } catch (e) {
      console.error("[supplier-payments/baru] invoice", e);
      invoiceAwal = null;
    }
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
      invoiceAwal={invoiceAwal}
      invoicePilihAwal={invoicePilihAwal}
      invoiceLunasDariUrl={invoiceLunasDariUrl}
      bolehBukaTagihan={hasPermission(izin, PERMISSIONS.VENDOR_BILLS_VIEW)}
    />
  );
}

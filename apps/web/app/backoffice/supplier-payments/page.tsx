import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { registerUtangPo, daftarPembayaran, type RegisterUtang, type HalamanPembayaran } from "@/lib/purchasing/pembayaran-queries";
import { urutPemasok } from "@/lib/suppliers/label-pemasok";
import { tanggalKalenderSah } from "@/lib/finance/kas/aturan";
import { PembayaranPemasokClient, type SaringanPembayaranPemasok } from "./PembayaranPemasokClient";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;
type PageProps = {
  searchParams: Promise<{ tab?: Param; pemasok?: Param; dari?: Param; sampai?: Param; status?: Param; cari?: Param; halaman?: Param }>;
};

const satu = (v: Param) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Pembelian → Pembayaran pemasok. Dua tab:
 * - `?tab=po` (bawaan): register utang per PO — saringan, ringkasan, dan halaman
 *   dihitung di SERVER atas seluruh hasil saring (dulu kartu ringkasan dihitung
 *   dari baris halaman yang tampil, halaman 2 bisa membaca Rp 0).
 * - `?tab=pembayaran`: dokumen pembayaran BYR/… (sebagian, banyak dokumen,
 *   uang muka, potong PPh), termasuk cermin tombol lama "Tandai lunas".
 * Semua saringan dan halaman tersimpan di alamat. Melihat
 * `supplier_payments:view`; membayar `supplier_payments:create`; tombol lama
 * "Tandai lunas" `purchase_orders:edit`.
 */
export default async function SupplierPaymentsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.SUPPLIER_PAYMENTS_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const tab = satu(sp.tab) === "pembayaran" ? "pembayaran" : "po";
  const tanggal = (v: Param) => (tanggalKalenderSah(satu(v)) ? satu(v) : "");
  const halaman = Math.max(1, Number.parseInt(satu(sp.halaman), 10) || 1);
  const statusMentah = satu(sp.status);
  const saringan: SaringanPembayaranPemasok = {
    tab,
    pemasok: satu(sp.pemasok).slice(0, 64),
    dari: tanggal(sp.dari),
    sampai: tanggal(sp.sampai),
    status: tab === "po" ? (statusMentah === "lunas" || statusMentah === "belum" ? statusMentah : "") : statusMentah === "POSTED" || statusMentah === "CANCELLED" ? statusMentah : "",
    cari: satu(sp.cari).trim().slice(0, 100),
    halaman,
  };

  const pemasok = urutPemasok(
    await prisma.supplier.findMany({
      where: { OR: [{ status: "ACTIVE" }, { purchaseOrders: { some: {} } }, { grns: { some: {} } }] },
      select: { id: true, code: true, name: true, status: true },
    }),
  ).map((p) => ({ id: p.id, kode: p.code, nama: p.name, disetujui: p.status === "ACTIVE" }));

  let register: RegisterUtang | null = null;
  let pembayaran: HalamanPembayaran | null = null;
  let gagal = false;
  try {
    if (tab === "po") {
      register = await registerUtangPo({
        pemasokId: saringan.pemasok || null,
        jatuhTempoDari: saringan.dari || null,
        jatuhTempoSampai: saringan.sampai || null,
        status: saringan.status === "lunas" ? "lunas" : saringan.status === "belum" ? "belum" : "semua",
        cari: saringan.cari || null,
        halaman,
      });
    } else {
      pembayaran = await daftarPembayaran({
        pemasokId: saringan.pemasok || null,
        dari: saringan.dari || null,
        sampai: saringan.sampai || null,
        status: saringan.status === "POSTED" || saringan.status === "CANCELLED" ? saringan.status : null,
        cari: saringan.cari || null,
        halaman,
      });
    }
  } catch (e) {
    console.error("[supplier-payments] gagal memuat", e);
    gagal = true;
  }

  return (
    <PembayaranPemasokClient
      key={JSON.stringify(saringan)}
      saringan={saringan}
      pemasok={pemasok}
      register={register}
      pembayaran={pembayaran}
      gagal={gagal}
      akses={{
        bayar: hasPermission(izin, PERMISSIONS.SUPPLIER_PAYMENTS_CREATE),
        tandaiLunas: hasPermission(izin, PERMISSIONS.PURCHASE_ORDERS_EDIT),
      }}
    />
  );
}

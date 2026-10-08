import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { listPOs } from '@/lib/purchase-orders/queries';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import { parsePOStatusFilter } from '@/lib/purchase-orders/overdue';
import { bacaCariPo, bacaHalamanPo, jepitHalaman } from '@/lib/purchase-orders/cari-po';
import { PurchaseOrdersPageClient, type PurchaseOrder } from './PurchaseOrdersPageClient';

export const dynamic = 'force-dynamic';

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cari?: string; halaman?: string }>;
}) {
  const session = await auth();
  if (!session) redirect('/login');

  // `?status=` (tautan beranda dan lencana menu), `?cari=` dan `?halaman=` dibaca
  // di server juga: daftar pertama yang tampil sudah tersaring dan terpotong,
  // tidak berkedip dari "semua PO" ke yang dimaksud.
  const sp = await searchParams;
  const status = parsePOStatusFilter(sp.status);
  const cari = bacaCariPo(sp.cari);
  const filters = {
    ...(status === 'overdue' ? { overdue: true } : status ? { status } : {}),
    ...(cari ? { cari } : {}),
  };
  let halaman = bacaHalamanPo(sp.halaman);
  let result = await listPOs(filters, { page: halaman, pageSize: DEFAULT_PAGE_SIZE });
  const hitung = (r: unknown) =>
    r != null && typeof r === 'object' && 'totalCount' in r ? Number((r as { totalCount: number }).totalCount) || 0 : 0;
  // Halaman di alamat melewati halaman terakhir (mis. tautan lama): tampilkan halaman terakhir.
  const dijepit = jepitHalaman(halaman, hitung(result), DEFAULT_PAGE_SIZE);
  if (dijepit !== halaman) {
    halaman = dijepit;
    result = await listPOs(filters, { page: halaman, pageSize: DEFAULT_PAGE_SIZE });
  }
  const initialPOs =
    result != null && typeof result === 'object' && 'items' in result
      ? (result as { items: unknown[] }).items
      : [];

  return (
    <PurchaseOrdersPageClient
      // Dipasang ulang saat alamat berubah lewat navigasi (lencana menu, tautan
      // beranda) — state awal hanya dibaca sekali saat dipasang.
      key={`${status || 'all'}|${cari}|${halaman}`}
      initialPOs={initialPOs as PurchaseOrder[]}
      initialTotalCount={hitung(result)}
      initialPage={halaman}
      initialStatus={status}
      initialCari={cari}
    />
  );
}

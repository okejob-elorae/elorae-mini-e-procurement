import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { daftarSalesman } from "@/lib/salesman/queries";
import { bacaStatusTukar, bolehMelihatTukar } from "@/lib/salesman/tukar-barang";
import { daftarTukarKantor } from "@/lib/salesman/tukar-queries";
import { TukarBarangClient } from "./TukarBarangClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ status?: string; salesman?: string; q?: string }>;
};

/**
 * Tukar barang — kantor. Penjualan menyetujui/menolak, gudang menyelesaikan
 * (stok bergerak); keduanya dari daftar yang sama, disaring lewat alamat.
 */
export default async function TukarBarangPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!bolehMelihatTukar(izin)) redirect("/backoffice");

  const sp = await searchParams;
  const status = bacaStatusTukar(sp.status);
  const salesmanId = sp.salesman?.trim() || null;
  const cari = sp.q?.trim().slice(0, 100) || null;

  const [data, salesman] = await Promise.all([daftarTukarKantor({ status, salesmanId, cari }), daftarSalesman()]);

  return <TukarBarangClient status={status} salesmanId={salesmanId} cari={cari} salesman={salesman} data={data} />;
}

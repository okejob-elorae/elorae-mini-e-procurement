import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  bacaBulan,
  bolehMelihatBiaya,
  bolehMembayarBiaya,
  bolehMenyetujuiBiaya,
  daftarBulanTerakhir,
  labelBulan,
  STATUS_BIAYA,
  type StatusBiaya,
} from "@/lib/salesman/biaya";
import { daftarBiayaKantor } from "@/lib/salesman/biaya-queries";
import { daftarSalesman } from "@/lib/salesman/queries";
import { BiayaPerjalananClient } from "./BiayaPerjalananClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ bulan?: string; status?: string; salesman?: string }>;
};

/**
 * Biaya perjalanan salesman — kantor. Atasan menyetujui/menolak, keuangan
 * menandai dibayar; keduanya dari daftar yang sama, disaring per bulan
 * (tanggal struk), status, dan salesman lewat alamat.
 */
export default async function BiayaPerjalananPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!bolehMelihatBiaya(izin)) redirect("/backoffice");

  const sp = await searchParams;
  const sekarang = new Date();
  const bulan = bacaBulan(sp.bulan, sekarang);
  const status = STATUS_BIAYA.includes(sp.status as StatusBiaya) ? (sp.status as StatusBiaya) : null;
  const salesmanId = sp.salesman?.trim() || null;

  const [data, salesman] = await Promise.all([daftarBiayaKantor({ bulan, status, salesmanId }), daftarSalesman()]);
  const pilihan = daftarBulanTerakhir(12, sekarang);
  if (!pilihan.includes(bulan)) pilihan.push(bulan);

  return (
    <BiayaPerjalananClient
      bulan={bulan}
      status={status}
      salesmanId={salesmanId}
      pilihanBulan={pilihan.map((b) => ({ kunci: b, label: labelBulan(b) }))}
      salesman={salesman}
      data={data}
      bolehSetujui={bolehMenyetujuiBiaya(izin)}
      bolehBayar={bolehMembayarBiaya(izin)}
    />
  );
}

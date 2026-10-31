import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { kunciHariWib } from "@/lib/dashboard/tren";
import {
  bacaBulan,
  bolehMelihatBiaya,
  bolehMembayarBiaya,
  bolehMenyetujuiBiaya,
  daftarBulanTerakhir,
  labelBulan,
  ringkasPerStatus,
  STATUS_BIAYA,
  type StatusBiaya,
} from "@/lib/salesman/biaya";
import { daftarBiayaKantor, type BarisBiayaKantor } from "@/lib/salesman/biaya-queries";
import { daftarSalesman } from "@/lib/salesman/queries";
import { daftarAkunKasBank } from "@/lib/finance/operasional/akun-kas";
import { BiayaPerjalananClient } from "./BiayaPerjalananClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ bulan?: string; status?: string; salesman?: string }>;
};

/** `?bulan=semua`: semua bulan — tautan Beranda ke klaim yang menunggu, berapa pun umurnya. */
const SEMUA_BULAN = "semua";

/**
 * Daftar kantor lintas bulan: `daftarBiayaKantor` per bulan yang punya klaim
 * yang cocok, lalu digabung — urutan "yang menunggu tindakan di atas" tetap.
 */
async function daftarBiayaSemuaBulan(saring: { status: StatusBiaya | null; salesmanId: string | null }) {
  const tanggal = await prisma.expenseClaim.findMany({
    where: {
      ...(saring.status ? { status: saring.status } : {}),
      ...(saring.salesmanId ? { userId: saring.salesmanId } : {}),
    },
    select: { spentAt: true },
  });
  const bulanAda = [...new Set(tanggal.map((r) => kunciHariWib(r.spentAt).slice(0, 7)))].sort().reverse();
  const perBulan = await Promise.all(bulanAda.map((bulan) => daftarBiayaKantor({ bulan, ...saring })));
  const bobot: Record<string, number> = { DIAJUKAN: 0, DISETUJUI: 1 };
  const baris: BarisBiayaKantor[] = perBulan
    .flatMap((d) => d.baris)
    .sort((a, b) => (bobot[a.status] ?? 2) - (bobot[b.status] ?? 2));
  return { baris, ...ringkasPerStatus(baris) };
}

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
  const semuaBulan = sp.bulan === SEMUA_BULAN;
  const bulan = semuaBulan ? SEMUA_BULAN : bacaBulan(sp.bulan, sekarang);
  const status = STATUS_BIAYA.includes(sp.status as StatusBiaya) ? (sp.status as StatusBiaya) : null;
  const salesmanId = sp.salesman?.trim() || null;

  const bolehBayar = bolehMembayarBiaya(izin);
  const [data, salesman, akunKas] = await Promise.all([
    semuaBulan ? daftarBiayaSemuaBulan({ status, salesmanId }) : daftarBiayaKantor({ bulan, status, salesmanId }),
    daftarSalesman(),
    bolehBayar ? daftarAkunKasBank() : Promise.resolve([]),
  ]);
  const pilihan = daftarBulanTerakhir(12, sekarang);
  if (!semuaBulan && !pilihan.includes(bulan)) pilihan.push(bulan);

  return (
    <BiayaPerjalananClient
      bulan={bulan}
      status={status}
      salesmanId={salesmanId}
      pilihanBulan={pilihan.map((b) => ({ kunci: b, label: labelBulan(b) }))}
      salesman={salesman}
      data={data}
      bolehSetujui={bolehMenyetujuiBiaya(izin)}
      bolehBayar={bolehBayar}
      akunKas={akunKas.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
    />
  );
}

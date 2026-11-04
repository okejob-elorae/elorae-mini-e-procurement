import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { bacaBulan, daftarBulanTerakhir, labelBulan } from "@/lib/salesman/biaya";
import { bolehMelihatIzin, bolehMemutuskanIzin, JENIS_IZIN, STATUS_IZIN, type JenisIzin, type StatusIzin } from "@/lib/salesman/izin";
import { daftarIzinKantor, izinById, orangLapangan } from "@/lib/salesman/izin-queries";
import { IzinClient } from "./IzinClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ status?: string; jenis?: string; orang?: string; bulan?: string; id?: string }>;
};

/**
 * Izin, sakit & cuti tim lapangan — kantor. Antrean ajuan dari HP (salesman
 * dan SPG), disaring status/jenis/orang/bulan lewat alamat. `?id=` (tautan
 * lonceng) membuka satu ajuan walau tersaring keluar dari daftar.
 *
 * Penjaga di halaman ini sendiri; rute juga perlu masuk `ROUTE_PERMISSIONS`
 * (`field_sales_orders:view`) — lihat laporan kabel.
 */
export default async function IzinPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!bolehMelihatIzin(izin)) redirect("/backoffice");

  const sp = await searchParams;
  const sekarang = new Date();
  const status = (STATUS_IZIN as readonly string[]).includes(sp.status ?? "") ? (sp.status as StatusIzin) : null;
  const jenis = (JENIS_IZIN as readonly string[]).includes(sp.jenis ?? "") ? (sp.jenis as JenisIzin) : null;
  const userId = sp.orang?.trim() || null;
  // Tanpa `?bulan=` = semua bulan: antrean yang menunggu tidak boleh tersembunyi di bulan lain.
  const bulan = sp.bulan ? bacaBulan(sp.bulan, sekarang) : null;
  const id = sp.id?.trim() || null;

  const [data, orang, terpilih] = await Promise.all([
    daftarIzinKantor({ status, jenis, userId, bulan }),
    orangLapangan(),
    id ? izinById(id) : Promise.resolve(null),
  ]);
  const pilihan = daftarBulanTerakhir(12, sekarang);
  // Cuti direncanakan ke depan: dua bulan berikutnya ikut ditawarkan.
  const [y, m] = pilihan[0].split("-").map(Number);
  for (const n of [2, 1]) {
    const total = y * 12 + (m - 1) + n;
    pilihan.unshift(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`);
  }
  if (bulan && !pilihan.includes(bulan)) pilihan.push(bulan);

  return (
    <IzinClient
      saring={{ status, jenis, userId, bulan }}
      pilihanBulan={pilihan.map((b) => ({ kunci: b, label: labelBulan(b) }))}
      orang={orang}
      data={data}
      terpilih={terpilih}
      idDiminta={id}
      bolehPutuskan={bolehMemutuskanIzin(izin)}
      penggunaId={session.user.id}
    />
  );
}

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { bacaBulan, daftarBulanTerakhir, labelBulan } from "@/lib/salesman/biaya";
import { biayaSaya, pengaturanBiayaDb } from "@/lib/salesman/biaya-queries";
import { BiayaSayaClient } from "./BiayaSayaClient";

export const dynamic = "force-dynamic";

/**
 * Biaya perjalanan saya — klaim bensin/parkir/tol/makan milik salesman sendiri,
 * per bulan (menurut tanggal struk), dengan jumlah per status.
 */
export default async function BiayaSayaPage({ searchParams }: { searchParams: Promise<{ bulan?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  // Layar salesman keliling: SPG (toko tetap) dikembalikan ke berandanya.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");

  const sekarang = new Date();
  const bulan = bacaBulan((await searchParams).bulan, sekarang);
  const [data, pengaturan] = await Promise.all([biayaSaya(session.user.id, bulan), pengaturanBiayaDb()]);
  const pilihan = daftarBulanTerakhir(12, sekarang);
  // Bulan dari alamat yang lebih tua dari 12 bulan tetap bisa dipilih ulang.
  if (!pilihan.includes(bulan)) pilihan.push(bulan);

  return (
    <BiayaSayaClient
      bulan={bulan}
      pilihanBulan={pilihan.map((b) => ({ kunci: b, label: labelBulan(b) }))}
      aktif={pengaturan.aktif}
      data={data}
    />
  );
}

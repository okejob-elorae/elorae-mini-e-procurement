import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { daftarTukarSaya } from "@/lib/salesman/tukar-queries";
import { TukarSayaClient } from "./TukarSayaClient";

export const dynamic = "force-dynamic";

/**
 * Tukar barang saya — semua pengajuan milik salesman ini, dengan statusnya.
 * Pengajuan baru dibuat dari halaman toko saat check-in (bukan dari sini),
 * karena penukaran harus disaksikan di toko.
 */
export default async function TukarSayaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  // Layar salesman keliling: SPG (toko tetap) dikembalikan ke berandanya.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");

  return <TukarSayaClient baris={await daftarTukarSaya(session.user.id)} />;
}

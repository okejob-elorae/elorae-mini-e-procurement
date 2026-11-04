import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { bacaFilterRekomendasi, daftarRekomendasiSaya } from "@/lib/salesman/rekomendasi-queries";
import { RekomendasiSayaClient } from "./RekomendasiSayaClient";

export const dynamic = "force-dynamic";

/**
 * Rekomendasi saya — semua rekomendasi barang yang dikirim salesman ini ke
 * toko, dengan statusnya. Rekomendasi baru dibuat dari analisa toko, bukan
 * dari sini. SPG (toko tetap) dikembalikan ke berandanya: layarnya
 * `/pwa/spg/rekomendasi`.
 */
export default async function RekomendasiSayaPage({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa/spg/rekomendasi");

  const { status } = await searchParams;
  const filter = bacaFilterRekomendasi(status);
  const data = await daftarRekomendasiSaya(session.user.id, filter);
  return <RekomendasiSayaClient filter={filter} baris={data.baris} jumlah={data.jumlah} />;
}

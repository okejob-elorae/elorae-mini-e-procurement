import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { aturanMutasi, daftarMutasiHp } from "@/lib/spg/mutasi-queries";
import { tokoSpg } from "@/lib/spg/queries";
import { getActiveVisit } from "@/lib/stores/queries";
import { MutasiClient, type TabMutasi } from "./MutasiClient";

export const dynamic = "force-dynamic";

const TAB: TabMutasi[] = ["keluar", "masuk", "jalan"];

/**
 * Mutasi antar toko di HP SPG: barang yang keluar dari toko ini, yang masuk
 * dari toko lain, dan yang sedang di jalan. Toko selalu toko tetap SPG.
 */
export default async function SpgMutasiPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const sp = await searchParams;
  const [data, aturan, aktif] = await Promise.all([daftarMutasiHp(toko.id), aturanMutasi(), getActiveVisit(session.user.id)]);
  const diminta = TAB.find((t) => t === sp.tab);
  // Tanpa pilihan: buka tab yang menunggu tindakan lebih dulu.
  const tab: TabMutasi = diminta ?? (data.diJalan.length > 0 ? "jalan" : "keluar");

  // Kunjungan berjalan menurut server — untuk menandai dikirim ajuan yang masih di HP.
  const kunjungan = aktif && aktif.storeId === toko.id ? { id: aktif.id, checkinAtMs: aktif.checkinAt.getTime() } : null;

  return (
    <MutasiClient storeId={toko.id} kunjunganServer={kunjungan} namaToko={toko.name} tab={tab} data={data} bolehAjukan={aturan.aktif} />
  );
}

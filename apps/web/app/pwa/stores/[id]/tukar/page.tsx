import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { getActiveVisit, getStore } from "@/lib/stores/queries";
import { bahanTukarToko } from "@/lib/salesman/tukar-queries";
import { TukarBaruClient } from "./TukarBaruClient";

export const dynamic = "force-dynamic";

/**
 * Ajukan tukar barang dari toko yang sedang dikunjungi.
 *
 * Toko konsinyasi dan kunjungan yang tidak berjalan TIDAK dialihkan diam-diam:
 * halaman menjelaskan kenapa formulirnya tidak ada dan jalur mana yang benar,
 * karena salesman yang membuka tautan ini sedang menghadapi barang di depannya.
 */
export default async function TukarBaruPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  // Pesanan dan tukar barang milik salesman keliling: SPG menjual dari layarnya sendiri.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");

  const { id } = await params;
  const store = await getStore(id);
  if (!store) notFound();
  const toko = { id: store.id, nama: store.name };

  if (store.termsType !== "PUTUS") return <TukarBaruClient keadaan="KONSI" toko={toko} bahan={null} />;

  const aktif = await getActiveVisit(session.user.id);
  if (!aktif || aktif.storeId !== store.id) return <TukarBaruClient keadaan="TANPA_KUNJUNGAN" toko={toko} bahan={null} />;

  return <TukarBaruClient keadaan="SIAP" toko={toko} bahan={await bahanTukarToko(store.id)} />;
}

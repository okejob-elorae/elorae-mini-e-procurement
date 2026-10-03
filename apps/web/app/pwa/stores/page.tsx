import { auth } from "@/lib/auth";
import { tokoSaya, tokoTerkunci } from "@/lib/salesman/queries";
import { listActiveStoresForPwa } from "@/lib/stores/queries";
import { StoreList } from "./StoreList";

export const dynamic = "force-dynamic";

export default async function PwaStoreList() {
  const session = await auth();
  const userId = session?.user?.id;
  // "Toko saya" = sama persis dengan rencana kunjungan di beranda: riwayat 90
  // hari, piutang terbuka, dan toko yang ditugaskan admin.
  // Kunci "hanya toko sendiri" menyala: daftar HANYA toko yang ia pegang —
  // toko lain tidak dikirim ke HP sama sekali, bukan cuma disembunyikan.
  const terkunci = await tokoTerkunci();
  const [stores, saya] = await Promise.all([
    listActiveStoresForPwa(terkunci && userId ? { hanyaMilik: userId } : undefined),
    userId ? tokoSaya(userId, new Date()) : null,
  ]);
  return (
    <StoreList
      terkunci={terkunci}
      milikSaya={saya ? saya.rencana.map(r => r.storeId) : []}
      stores={stores.map(s => ({
        id: s.id,
        name: s.name,
        code: s.code,
        termsType: s.termsType,
        storeClass: s.storeClass,
        lat: s.lat,
        lng: s.lng,
      }))}
    />
  );
}

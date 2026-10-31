import { auth } from "@/lib/auth";
import { tokoSaya, tokoTerkunci } from "@/lib/salesman/queries";
import { getStore, listActiveStoresForPwa, type StoreListItem } from "@/lib/stores/queries";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { StoreList } from "./StoreList";

export const dynamic = "force-dynamic";

export default async function PwaStoreList() {
  const session = await auth();
  const userId = session?.user?.id;
  // SPG hanya punya satu toko tetap: daftar berisi toko itu saja (kalau masih
  // aktif) — toko lain tidak dikirim ke HP-nya sama sekali.
  const tokoTetap = userId ? await ambilTokoTetap(userId) : null;
  if (tokoTetap) {
    const toko = await getStore(tokoTetap);
    return <StoreList terkunci milikSaya={[tokoTetap]} stores={toko?.isActive ? [untukDaftar(toko)] : []} />;
  }
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
      stores={stores.map(untukDaftar)}
    />
  );
}

/** Hanya kolom yang dipakai daftar — margin, tempo, dan pemegang tidak ikut ke HP. */
function untukDaftar(s: StoreListItem) {
  return {
    id: s.id,
    name: s.name,
    code: s.code,
    termsType: s.termsType,
    storeClass: s.storeClass,
    lat: s.lat,
    lng: s.lng,
  };
}

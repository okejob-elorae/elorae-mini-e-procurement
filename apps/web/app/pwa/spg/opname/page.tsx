import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { stokToko, tokoSpg } from "@/lib/spg/queries";
import { getActiveVisit } from "@/lib/stores/queries";
import { pilihanBarang } from "../stok/pilihan";
import { OpnameClient } from "./OpnameClient";

export const dynamic = "force-dynamic";

/** Opname toko oleh SPG: hitung barang di rak, saldo sistem disesuaikan. */
export default async function SpgOpnamePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const aktif = await getActiveVisit(session.user.id);
  const kunjungan = aktif && aktif.storeId === toko.id ? { id: aktif.id, checkinAtMs: aktif.checkinAt.getTime() } : null;
  // Katalog SELALU dimuat, juga sebelum check-in: halaman ini disimpan Service
  // Worker, dan SPG yang check-in TANPA sinyal menghitung dari halaman tersimpan
  // itu. Tanpa check-in (di server maupun di HP) layar tetap hanya menampilkan
  // pesan check-in.
  const stok = await stokToko(toko.id);
  const pilihan = await pilihanBarang(stok);

  return (
    <OpnameClient
      storeId={toko.id}
      namaToko={toko.name}
      sudahCheckIn={kunjungan !== null}
      kunjunganServer={kunjungan}
      opnamePertama={stok.length === 0}
      pilihan={pilihan}
    />
  );
}

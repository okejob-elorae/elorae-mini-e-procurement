import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { tokoSpg } from "@/lib/spg/queries";
import { getSellableCatalogForSpg } from "@/lib/spg/sale-queries";
import { bacaDiskonManual, KUNCI_DISKON_MANUAL } from "@/lib/spg/pengaturan";
import { promoKonterUntukToko } from "@/lib/spg/promo-konter-queries";
import { getActiveVisit } from "@/lib/stores/queries";
import { SpgSaleShell } from "./SpgSaleShell";

export const dynamic = "force-dynamic";

export default async function SpgSalePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/pwa/spg/sale");

  // Hanya SPG (punya toko tetap) yang menjual dari layar ini.
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  // Menjual adalah pekerjaan DI toko. Tanpa check-in di server, katalog TETAP
  // dimuat: check-in yang dicatat tanpa sinyal hanya diketahui HP, dan halaman
  // ini (dari cache) harus bisa menjual di bawahnya. Layar yang memutuskan —
  // tanpa kunjungan server maupun kunjungan di HP, ia menampilkan alasannya dan
  // jalan ke check-in. Aksi simpan menjaga hal yang sama di server
  // (NO_ACTIVE_VISIT / KUNJUNGAN_TIDAK_SAH), jadi tab lama yang basi pun tertolak.
  const aktifSemua = await getActiveVisit(session.user.id);
  const aktif = aktifSemua && aktifSemua.storeId === toko.id ? aktifSemua : null;

  const [katalog, gerakanPertama, promos, setelanManual] = await Promise.all([
    getSellableCatalogForSpg(toko.id),
    // Toko tanpa satu gerakan pun belum dilacak stoknya: semua saldonya 0, dan
    // menampilkan "Stok toko: 0" di setiap baris hanya jadi peringatan palsu.
    prisma.storeStockMovement.findFirst({ where: { storeId: toko.id }, select: { id: true } }),
    // Promo ikut halaman (termasuk yang baru mulai beberapa hari lagi): HP yang
    // menjual tanpa sinyal menghitung promo dari daftar ini pada waktu jualnya.
    promoKonterUntukToko(toko.id, new Date()),
    prisma.systemSetting.findUnique({ where: { key: KUNCI_DISKON_MANUAL }, select: { value: true } }),
  ]);

  return (
    <SpgSaleShell
      katalog={katalog}
      storeId={toko.id}
      namaToko={toko.name}
      stokDilacak={gerakanPertama !== null}
      promos={promos}
      aturanManual={bacaDiskonManual(setelanManual?.value)}
      visitId={aktif?.id ?? null}
      checkinAtMs={aktif ? aktif.checkinAt.getTime() : null}
    />
  );
}

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { promoKonterHp } from "@/lib/spg/promo-konter-kantor-queries";
import { tokoSpg } from "@/lib/spg/queries";
import { PromoSpgClient } from "./PromoSpgClient";

export const dynamic = "force-dynamic";

/**
 * Promo konter di toko SPG ini: yang berlaku hari ini dan yang akan datang,
 * supaya SPG bisa menawarkannya ke pembeli. Hanya SPG; toko SELALU toko tetap
 * dari sesi, tidak pernah dari alamat. Sasaran dikirim sebagai nama.
 */
export default async function SpgPromoPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!(await ambilTokoTetap(session.user.id))) redirect("/pwa");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const promos = await promoKonterHp(toko.id);
  return <PromoSpgClient namaToko={toko.name} promos={promos} />;
}

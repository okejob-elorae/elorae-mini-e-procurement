import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { getSellableVanStock } from "@/lib/canvassing/sale-queries";
import { listActiveStoresForPwa } from "@/lib/stores/queries";
import { tokoTerkunci } from "@/lib/salesman/queries";
import { VanSellShell } from "./VanSellShell";

export const dynamic = "force-dynamic";

export default async function VanSellPage() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  // Layar salesman keliling: SPG (toko tetap) dikembalikan ke berandanya.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");

  // Van-sale price = PUTUS = item sellingPrice (buyer-independent — store margin only
  // affects KONSI, which van sales never are), so a single fetch prices every row.
  // Kunci "hanya toko sendiri": pembeli terdaftar hanya dari tokonya sendiri.
  // Pembeli langsung (bukan toko terdaftar) tetap boleh.
  const terkunci = await tokoTerkunci();
  const [stock, stores] = await Promise.all([
    getSellableVanStock(session.user.id),
    listActiveStoresForPwa(terkunci ? { hanyaMilik: session.user.id } : undefined),
  ]);

  return (
    <VanSellShell
      userId={session.user.id}
      stock={stock}
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
    />
  );
}

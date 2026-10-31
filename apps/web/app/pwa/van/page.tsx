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

  // Initial load has no buyer selected yet (VanSellShell defaults to walk-in/"adhoc"), so this
  // prices at list (no storeId → no priceDiscountPercent). Once the salesman picks a store buyer
  // in the shell, it re-prices client-side via getVanStockForStoreAction (apps/web/app/actions/van-sale.ts)
  // to reflect that store's discount — the same discount recordVanSale will actually charge.
  // Kunci "hanya toko sendiri": pembeli terdaftar hanya dari tokonya sendiri.
  // Pembeli langsung (bukan toko terdaftar) tetap boleh.
  const terkunci = await tokoTerkunci();
  const [stockResult, stores] = await Promise.all([
    getSellableVanStock(session.user.id),
    listActiveStoresForPwa(terkunci ? { hanyaMilik: session.user.id } : undefined),
  ]);

  /* No storeId was passed, so STORE_NOT_FOUND cannot occur here; the empty list is only the type's other arm. */
  const stock = stockResult.ok ? stockResult.rows : [];

  return (
    <VanSellShell
      userId={session.user.id}
      stock={stock}
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
    />
  );
}

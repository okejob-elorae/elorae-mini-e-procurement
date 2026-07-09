import { auth } from "@/lib/auth";
import { getSellableVanStock } from "@/lib/canvassing/sale-queries";
import { listActiveStoresForPwa } from "@/lib/stores/queries";
import { VanSellShell } from "./VanSellShell";

export const dynamic = "force-dynamic";

export default async function VanSellPage() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Van-sale price = PUTUS = item sellingPrice (buyer-independent — store margin only
  // affects KONSI, which van sales never are), so a single fetch prices every row.
  const [stock, stores] = await Promise.all([
    getSellableVanStock(session.user.id),
    listActiveStoresForPwa(),
  ]);

  return (
    <VanSellShell
      stock={stock}
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
    />
  );
}

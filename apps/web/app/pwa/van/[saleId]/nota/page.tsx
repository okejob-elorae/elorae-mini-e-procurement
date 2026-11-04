import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { getVanSaleById } from "@/lib/canvassing/sale-queries";
import { NotaView } from "./NotaView";

export const dynamic = "force-dynamic";

export default async function VanSaleNotaPage({ params }: { params: Promise<{ saleId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  // Layar salesman keliling: SPG (toko tetap) dikembalikan ke berandanya.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");
  const { saleId } = await params;

  const sale = await getVanSaleById(saleId, { salesmanId: session.user.id });
  if (!sale) notFound();

  // COGS (unitCost) is not shown on the nota — strip it so it never reaches the client payload.
  const safeSale = { ...sale, lines: sale.lines.map((l) => ({ ...l, unitCost: 0 })) };

  return <NotaView sale={safeSale} />;
}

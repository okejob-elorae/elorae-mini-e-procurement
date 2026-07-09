import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getVanSaleById } from "@/lib/canvassing/sale-queries";
import { NotaView } from "./NotaView";

export const dynamic = "force-dynamic";

export default async function VanSaleNotaPage({ params }: { params: Promise<{ saleId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const { saleId } = await params;

  const sale = await getVanSaleById(saleId);
  if (!sale) notFound();

  return <NotaView sale={sale} />;
}

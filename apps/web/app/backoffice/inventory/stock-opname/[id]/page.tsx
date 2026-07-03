import { StockOpnameDetailClient } from "./StockOpnameDetailClient";

export const dynamic = "force-dynamic";

export default async function StockOpnameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StockOpnameDetailClient opnameId={id} />;
}

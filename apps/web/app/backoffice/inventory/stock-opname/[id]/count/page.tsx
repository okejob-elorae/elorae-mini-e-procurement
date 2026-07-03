import StockOpnameCountPageClient from "./StockOpnameCountPageClient";

export const dynamic = "force-dynamic";

export default async function StockOpnameCountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StockOpnameCountPageClient opnameId={id} />;
}

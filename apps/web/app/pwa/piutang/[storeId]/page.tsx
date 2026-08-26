import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { fakturToko } from "@/lib/receivables/pwa-queries";
import { FakturTokoClient } from "./FakturTokoClient";

export const dynamic = "force-dynamic";

export default async function FakturTokoPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  const { storeId } = await params;
  const data = await fakturToko(session.user.id, storeId);
  if (!data) notFound();

  return <FakturTokoClient storeName={data.storeName} baris={data.baris} />;
}

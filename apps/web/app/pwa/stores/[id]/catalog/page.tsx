import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getStore, getActiveVisit } from "@/lib/stores/queries";
import { CatalogShell } from "./CatalogShell";

export const dynamic = "force-dynamic";

export default async function PwaStoreCatalog({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const { id } = await params;
  const store = await getStore(id);
  if (!store) notFound();

  const active = await getActiveVisit(session.user.id);
  const hasActiveVisit = active?.storeId === store.id;

  return (
    <CatalogShell
      storeId={store.id}
      storeName={store.name}
      termsType={store.termsType}
      hasActiveVisit={hasActiveVisit}
      visitId={hasActiveVisit ? active!.id : null}
    />
  );
}

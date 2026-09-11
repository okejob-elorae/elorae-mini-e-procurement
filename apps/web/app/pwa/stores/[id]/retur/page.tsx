import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getStore, getActiveVisit } from "@/lib/stores/queries";
import { ReturShell } from "./ReturShell";

export const dynamic = "force-dynamic";

export default async function PwaStoreRetur({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const { id } = await params;
  const store = await getStore(id);
  if (!store) notFound();

  const active = await getActiveVisit(session.user.id);
  const visitId = active?.storeId === store.id ? active.id : null;

  return <ReturShell storeId={store.id} storeName={store.name} visitId={visitId} />;
}

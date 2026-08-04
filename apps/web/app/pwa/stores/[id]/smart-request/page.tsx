import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { getStore, getActiveVisit } from "@/lib/stores/queries";
import { SmartRequestShell } from "./SmartRequestShell";

export const dynamic = "force-dynamic";

export default async function PwaSmartRequest({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const { id } = await params;
  const store = await getStore(id);
  if (!store) notFound();

  // Smart-request is a putus cart builder — a KONSI store has no selling price to build
  // against, so bounce back to the store workspace before loading any category data.
  if (store.termsType === "KONSI") redirect(`/pwa/stores/${store.id}`);

  const active = await getActiveVisit(session.user.id);
  const hasActiveVisit = active?.storeId === store.id;
  if (!hasActiveVisit) redirect(`/pwa/stores/${store.id}`);

  const categories = await prisma.itemCategory.findMany({
    where: { isActive: true, items: { some: { isActive: true, type: "FINISHED_GOOD" } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <SmartRequestShell
      storeId={store.id}
      storeName={store.name}
      visitId={active!.id}
      categories={categories}
    />
  );
}

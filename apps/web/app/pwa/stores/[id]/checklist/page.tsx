import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { getActiveVisit } from "@/lib/stores/queries";
import { bahanChecklistPwa } from "@/lib/salesman/checklist-queries";
import { ChecklistClient } from "./ChecklistClient";
import { PerluCheckIn } from "./PerluCheckIn";

export const dynamic = "force-dynamic";

/**
 * Daftar periksa display toko + panduan display yang berlaku di toko ini.
 * Hanya selama check-in di toko ini (aturan yang sama dengan katalog).
 */
export default async function ChecklistTokoPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  const { id } = await params;

  const toko = await prisma.store.findUnique({ where: { id }, select: { id: true, name: true, termsType: true, groupId: true } });
  if (!toko) notFound();

  const aktif = await getActiveVisit(session.user.id);
  if (!aktif || aktif.storeId !== toko.id) return <PerluCheckIn storeId={toko.id} nama={toko.name} />;

  const bahan = await bahanChecklistPwa(toko, aktif.id, new Date());
  return <ChecklistClient toko={{ id: toko.id, nama: toko.name }} visitId={aktif.id} bahan={bahan} />;
}

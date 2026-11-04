import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { getActiveVisit } from "@/lib/stores/queries";
import { hargaPesaingToko, saranHargaPesaing } from "@/lib/salesman/checklist-queries";
import { PerluCheckIn } from "../checklist/PerluCheckIn";
import { HargaPesaingClient } from "./HargaPesaingClient";

export const dynamic = "force-dynamic";

/** Catat harga merek lain di toko ini, selama check-in di sini. */
export default async function HargaPesaingPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  const { id } = await params;

  const toko = await prisma.store.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!toko) notFound();

  const aktif = await getActiveVisit(session.user.id);
  if (!aktif || aktif.storeId !== toko.id) return <PerluCheckIn storeId={toko.id} nama={toko.name} />;

  const [terakhir, saran] = await Promise.all([hargaPesaingToko(toko.id, 20), saranHargaPesaing()]);
  return (
    <HargaPesaingClient toko={{ id: toko.id, nama: toko.name }} visitId={aktif.id} terakhir={terakhir} saran={saran} />
  );
}

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { kunjunganTerakhirSaya } from "@/lib/salesman/queries";
import { PendingOrdersClient, type NamaKunjungan } from "./PendingOrdersClient";

export const dynamic = "force-dynamic";

export default async function PwaPendingOrders() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Antrean foto di HP hanya menyimpan id kunjungan dan id toko; nama toko dan
  // waktu kunjungannya diambil di sini supaya fotonya bisa dikenali.
  const kunjungan: Record<string, NamaKunjungan> = {};
  for (const k of await kunjunganTerakhirSaya(session.user.id)) {
    kunjungan[k.visitId] = { storeId: k.storeId, toko: k.toko, checkinAt: k.checkinAt.toISOString() };
  }

  return <PendingOrdersClient kunjungan={kunjungan} />;
}

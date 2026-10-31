import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { tokoSpg } from "@/lib/spg/queries";
import { AntreanSpgClient } from "./AntreanSpgClient";

export const dynamic = "force-dynamic";

/**
 * Nota penjualan SPG yang dicatat tanpa sinyal dan belum sampai ke kantor.
 * Isinya ada di HP (IndexedDB), jadi halaman server hanya menjaga pintunya:
 * hanya SPG (punya toko tetap) yang menjual dan karena itu punya antrean ini.
 */
export default async function AntreanSpgPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/pwa/spg/antrean");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");
  return <AntreanSpgClient />;
}

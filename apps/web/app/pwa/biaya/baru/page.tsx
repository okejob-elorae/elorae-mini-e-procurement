import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { bahanBiayaBaru } from "@/lib/salesman/biaya-queries";
import { BiayaBaruClient } from "./BiayaBaruClient";

export const dynamic = "force-dynamic";

/** Ajukan satu biaya perjalanan dari lapangan. */
export default async function BiayaBaruPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  // Layar salesman keliling: SPG (toko tetap) dikembalikan ke berandanya.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");

  return <BiayaBaruClient bahan={await bahanBiayaBaru(session.user.id, new Date())} />;
}

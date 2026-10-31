import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { menungguGudang } from "@/lib/receivables/pwa-queries";
import { GudangClient } from "./GudangClient";
import { untukPenghitung } from "./nilai";

export const dynamic = "force-dynamic";

export default async function GudangReturPage() {
  const session = await auth();
  const penghitungId = session?.user?.id ?? "";
  const nota = await menungguGudang();
  // Pelapor tiap nota, supaya nota milik penghitung sendiri ditandai di layar
  // (server tetap menolaknya — ini hanya agar ia tidak mencoba sia-sia).
  const pelapor = nota.length
    ? await prisma.storeReturn.findMany({
        where: { id: { in: nota.map((n) => n.id) } },
        select: { id: true, salesmanId: true },
      })
    : [];
  const pelaporPer = new Map(pelapor.map((p) => [p.id, p.salesmanId]));
  // Klaim dibuang DI SERVER: qty dan nilai klaim tidak pernah sampai ke peramban.
  return <GudangClient baris={nota.map((n) => untukPenghitung(n, penghitungId, pelaporPer.get(n.id) ?? null))} />;
}

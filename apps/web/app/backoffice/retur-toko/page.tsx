import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  daftarKerjaRetur,
  katalogBarang,
  notaBelumBerpasangan,
  ringkasKerjaRetur,
  tokoUntukRetur,
} from "@/lib/receivables/return-queries";
import { prisma } from "@elorae/db";
import { ReturTokoClient } from "./ReturTokoClient";

export const dynamic = "force-dynamic";

export default async function ReturTokoPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [baris, toko, calonPasangan, katalog] = await Promise.all([
    daftarKerjaRetur(),
    tokoUntukRetur(),
    notaBelumBerpasangan(),
    katalogBarang(),
  ]);
  const izin = session.user.permissions ?? [];
  // Nota yang dilaporkan SPG — diberi tanda "dari SPG" di daftar.
  const idNrt = baris.filter((b) => b.jenis === "NRT").map((b) => b.id);
  const dariSpg = idNrt.length
    ? (await prisma.storeReturn.findMany({ where: { id: { in: idNrt }, reportedBySpg: true }, select: { id: true } })).map((n) => n.id)
    : [];

  return (
    <ReturTokoClient
      baris={baris}
      ringkasan={ringkasKerjaRetur(baris)}
      toko={toko}
      katalog={katalog}
      calonPasangan={calonPasangan.map((n) => ({
        id: n.id,
        noNrt: n.noNrt,
        storeId: n.store.id,
        storeName: n.store.name,
        nilaiKlaim: Number(n.claimedAmount),
        tanggal: n.claimDate.toISOString(),
      }))}
      bolehMengelola={hasPermission(izin, PERMISSIONS.RECEIVABLES_MANAGE)}
      bolehMenghitung={hasPermission(izin, PERMISSIONS.INVENTORY_OPNAME_COUNT)}
      dariSpg={dariSpg}
    />
  );
}

import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { getHPPList } from "@/app/actions/hpp";
import { getItemsByType } from "@/app/actions/items";
import { getSuppliersForSelect } from "@/app/actions/suppliers";
import { ItemType } from "@/lib/constants/enums";
import { batasRentangWib } from "@/lib/dashboard/hari-wib";
import { bacaSaringanHpp, lolosStatus } from "./hpp-tampil";
import { HppPageClient, type BarisHpp } from "./HppPageClient";

export const dynamic = "force-dynamic";

/**
 * Laporan HPP per perintah kerja. Saringan ada di alamat (`?barang=`,
 * `?vendor=`, `?dari=`, `?sampai=`, `?status=`) dan diterapkan di server, jadi
 * tautannya bisa dibagikan dan bertahan sesudah muat ulang. WO dibatalkan
 * tersembunyi kecuali diminta (`?status=SEMUA` atau `CANCELLED`).
 */
export default async function HPPPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const saringan = bacaSaringanHpp(await searchParams);
  const rentang = batasRentangWib(saringan.dari, saringan.sampai);

  const [hpp, barangJadi, pemasok] = await Promise.all([
    getHPPList({
      finishedGoodId: saringan.barang || undefined,
      vendorId: saringan.vendor || undefined,
      dateFrom: rentang.dari,
      dateTo: rentang.sampai,
    }),
    // Pilihan saringan: kegagalan memuatnya tidak menggagalkan laporannya.
    getItemsByType(ItemType.FINISHED_GOOD).catch(() => []),
    getSuppliersForSelect({ approvedOnly: true }).catch(() => []),
  ]);

  const statusSpk = hpp.length
    ? await prisma.workOrder.findMany({ where: { id: { in: hpp.map((r) => r.woId) } }, select: { id: true, status: true } })
    : [];
  const statusById = new Map(statusSpk.map((w) => [w.id, String(w.status)]));

  const baris: BarisHpp[] = hpp
    .map((r) => ({ ...r, status: statusById.get(r.woId) ?? "DRAFT" }))
    .filter((r) => lolosStatus(r.status, saringan.status));

  return (
    <HppPageClient
      rows={baris}
      saringan={saringan}
      pilihanBarang={(barangJadi as Array<{ id: string; sku: string; nameId: string }>).map((x) => ({
        value: x.id,
        label: `${x.nameId} (${x.sku})`,
      }))}
      pilihanPemasok={(pemasok as Array<{ id: string; name: string; code?: string | null }>).map((x) => ({
        value: x.id,
        label: x.code ? `${x.name} (${x.code})` : x.name,
      }))}
      // Penyimpan markup/biaya tambahan (`updateWOHppAdjustments`) hanya menerima ADMIN.
      bolehAtur={session.user.role === "ADMIN"}
    />
  );
}

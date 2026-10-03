import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { rentangLaporan } from "@/lib/salesman/checklist-toko";
import { laporanHargaPesaing, saranHargaPesaing } from "@/lib/salesman/checklist-queries";
import { daftarArea } from "@/lib/stores/areas";
import { HargaPesaingKantorClient } from "./HargaPesaingKantorClient";

export const dynamic = "force-dynamic";

type Cari = { dari?: string; sampai?: string; merek?: string; kategori?: string; area?: string };

const teks = (x: unknown, maks: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, maks) : null);

/** Harga pesaing yang dicatat salesman: ringkasan per merek × kategori dan rinciannya. `stores:view`. */
export default async function HargaPesaingKantorPage({ searchParams }: { searchParams: Promise<Cari> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const cari = await searchParams;
  const r = rentangLaporan(cari.dari, cari.sampai, new Date());
  const saring = { merek: teks(cari.merek, 60), kategori: teks(cari.kategori, 60), area: teks(cari.area, 64) };
  const [data, area, saran] = await Promise.all([
    laporanHargaPesaing({ dari: r.dari, sampai: r.sampai, merek: saring.merek, kategori: saring.kategori, groupId: saring.area }),
    daftarArea(),
    saranHargaPesaing(),
  ]);

  return (
    <HargaPesaingKantorClient
      data={data}
      saring={{ dari: r.dariStr, sampai: r.sampaiStr, ...saring }}
      area={area.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
      kategori={saran.kategori}
    />
  );
}

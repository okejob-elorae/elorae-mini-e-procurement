import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bolehMemutuskanBeban, bolehMengelola } from "@/lib/receivables/izin";
import { pilihanOrangHilang, rincianHilangKantor } from "@/lib/spg/hilang-queries";
import { RincianHilangClient } from "./RincianHilangClient";

export const dynamic = "force-dynamic";

export default async function RincianBarangHilangPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  // Izin tiap tombol = izin aksinya (app/actions/barang-hilang.ts): menandai toko ditagih dan
  // membatalkan yang masih TERBUKA = receivables:manage; memutuskan, mengubah, dan membatalkan
  // keputusan = receivables:decide_bearer.
  const bolehKelola = bolehMengelola(izin);
  const bolehPutus = bolehMemutuskanBeban(izin);
  if (!bolehKelola && !bolehPutus && !hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const [rincian, orang] = await Promise.all([
    rincianHilangKantor(id),
    // Pilihan orang hanya dipakai dialog keputusan.
    bolehPutus ? pilihanOrangHilang() : Promise.resolve({ spg: [], sales: [] }),
  ]);
  if (!rincian) notFound();

  return <RincianHilangClient rincian={rincian} bolehKelola={bolehKelola} bolehPutus={bolehPutus} orang={orang} />;
}

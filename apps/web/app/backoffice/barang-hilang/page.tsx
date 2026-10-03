import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bolehMengelola } from "@/lib/receivables/izin";
import { bacaStatusHilang, bacaSumberHilang } from "@/lib/spg/hilang";
import { daftarHilangKantor } from "@/lib/spg/hilang-queries";
import { DaftarHilangClient } from "./DaftarHilangClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ status?: string; toko?: string; sumber?: string }>;
};

/**
 * Barang hilang — kantor. Pengawas SPG (`spg_sales:view`) melihat; yang
 * menetapkan siapa menanggung, mencatat manual, dan menandai pelunasan adalah
 * `receivables:manage`. Halaman memagari dirinya sendiri (salah satu izin).
 */
export default async function BarangHilangPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  const bolehKelola = bolehMengelola(izin);
  if (!bolehKelola && !hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const status = bacaStatusHilang(sp.status);
  const sumber = bacaSumberHilang(sp.sumber);
  const storeId = sp.toko?.trim().slice(0, 64) || null;
  const [data, tokoAktif] = await Promise.all([
    daftarHilangKantor({ status, storeId, sumber }),
    bolehKelola
      ? prisma.store.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);

  return (
    <DaftarHilangClient
      status={status}
      sumber={sumber}
      storeId={storeId}
      data={data}
      bolehKelola={bolehKelola}
      tokoAktif={tokoAktif}
    />
  );
}

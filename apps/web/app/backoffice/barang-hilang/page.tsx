import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bolehMemutuskanBeban, bolehMengelola } from "@/lib/receivables/izin";
import { bacaStatusHilang, bacaSumberHilang } from "@/lib/spg/hilang";
import { bacaSaringanKlaim } from "./tampilan";
import { daftarHilangKantor } from "@/lib/spg/hilang-queries";
import { DaftarHilangClient } from "./DaftarHilangClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ status?: string; toko?: string; sumber?: string; klaim?: string }>;
};

/**
 * Barang hilang — kantor. Pengawas SPG (`spg_sales:view`) melihat; mencatat
 * manual dan menandai pelunasan adalah `receivables:manage`; menetapkan siapa
 * menanggung adalah `receivables:decide_bearer`. Halaman memagari dirinya
 * sendiri (salah satu izin). `?klaim=` menyaring catatan yang klaim ekspedisinya
 * diajukan, menunggu cek, atau ditolak — tujuan baris klaim di Beranda.
 */
export default async function BarangHilangPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  const bolehKelola = bolehMengelola(izin);
  if (!bolehKelola && !bolehMemutuskanBeban(izin) && !hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const status = bacaStatusHilang(sp.status);
  const sumber = bacaSumberHilang(sp.sumber);
  const storeId = sp.toko?.trim().slice(0, 64) || null;
  const klaim = bacaSaringanKlaim(sp.klaim);
  const [data, tokoAktif] = await Promise.all([
    daftarHilangKantor({ status, storeId, sumber, klaim }),
    bolehKelola
      ? prisma.store.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);

  return (
    <DaftarHilangClient
      status={status}
      sumber={sumber}
      storeId={storeId}
      klaim={klaim}
      data={data}
      bolehKelola={bolehKelola}
      tokoAktif={tokoAktif}
    />
  );
}

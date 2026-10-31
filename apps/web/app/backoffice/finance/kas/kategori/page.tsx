import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarKategori } from "@/lib/finance/kas/kategori-writer";
import { KategoriClient } from "./KategoriClient";

export const dynamic = "force-dynamic";

/**
 * Kategori biaya/penerimaan kas: nama, akun yang didebit/dikredit, dan potongan
 * PPh bawaan. Melihat `journals:view`; mengubah `journals:manage`.
 */
export default async function KategoriKasPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");
  const [kategori, akun] = await Promise.all([
    daftarKategori(),
    prisma.chartAccount.findMany({
      where: { isActive: true, children: { none: {} }, type: { in: ["BEBAN", "PENDAPATAN", "HPP", "ASET", "LIABILITAS"] } },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: "asc" },
    }),
  ]);
  return <KategoriClient kategori={kategori} akun={akun.map((a) => ({ id: a.id, kode: a.code, nama: a.name, tipe: a.type }))} bolehKelola={hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE)} />;
}

import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ambilRuangKerjaTahapAction } from "@/app/actions/jadwal-produksi";
import { RuangKerjaClient, type PemasokPilihan } from "./RuangKerjaClient";

export const dynamic = "force-dynamic";

/*
 * Ruang kerja satu tahap Plan Kerja (2026-10-07): jadwal proses, dokumen
 * (SPK + PO tahap), dan kebutuhan bahan. Data lewat aksi baca yang sama dengan
 * layar lain (izin `production_planning:view`; PO/SPK hanya untuk pemegang
 * izinnya). Tombol tulis mengikuti izin, dan aksinya menjaga diri sendiri.
 */
export default async function RuangKerjaTahapPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.PRODUCTION_PLANNING_VIEW)) redirect("/backoffice/dashboard");

  const { id } = await params;
  const hasil = await ambilRuangKerjaTahapAction(id);
  if (!hasil.ok) {
    if (hasil.code === "TANPA_AKSES") redirect("/backoffice/dashboard");
    if (hasil.code === "TAHAP_TIDAK_ADA" || hasil.code === "ISIAN_TIDAK_SAH") notFound();
    throw new Error(`Ruang kerja tahap gagal dimuat (${hasil.code})`);
  }

  const bolehUbah = hasPermission(izin, PERMISSIONS.PRODUCTION_PLANNING_MANAGE);

  // Pilihan pemasok untuk langkah manual: pemasok aktif, ditambah pemasok yang
  // sudah menempel pada langkah (supaya namanya tetap tampil walau kini nonaktif).
  let pemasok: PemasokPilihan[] = [];
  if (bolehUbah) {
    const aktif = await prisma.supplier.findMany({
      where: { isActive: true, status: "ACTIVE" },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, type: { select: { name: true } } },
    });
    pemasok = aktif.map((s) => ({ id: s.id, name: s.name, jenis: s.type?.name ?? null }));
    for (const l of hasil.data.langkah) {
      if (l.pemasok && !pemasok.some((p) => p.id === l.pemasok!.id)) {
        pemasok.push({ id: l.pemasok.id, name: l.pemasok.name, jenis: null });
      }
    }
  }

  return (
    <RuangKerjaClient
      data={hasil.data}
      pemasok={pemasok}
      izin={{
        ubah: bolehUbah,
        buatWo: bolehUbah && hasPermission(izin, PERMISSIONS.WORK_ORDERS_CREATE),
        lihatSpk: hasPermission(izin, PERMISSIONS.WORK_ORDERS_VIEW),
        lihatPo: hasPermission(izin, PERMISSIONS.PURCHASE_ORDERS_VIEW),
        buatPo: hasPermission(izin, PERMISSIONS.PURCHASE_ORDERS_CREATE),
      }}
    />
  );
}

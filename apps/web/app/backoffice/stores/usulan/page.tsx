import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { formatDisplayDate } from "@/lib/date-only";
import { bacaSaringanStatus, daftarUsulan } from "@/lib/stores/usulan-queries";
import { UsulanTokoListClient } from "./UsulanTokoListClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ status?: string; q?: string; page?: string; pageSize?: string }>;
};

const UKURAN_HALAMAN = [10, 25, 50, 100];

/** Usulan toko baru dari lapangan. Melihat: `stores:view`; memutuskan: `stores:manage`. */
export default async function UsulanTokoPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const status = bacaSaringanStatus(sp.status);
  const cari = sp.q?.trim() ?? "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const n = parseInt(sp.pageSize ?? "", 10);
  const pageSize = UKURAN_HALAMAN.includes(n) ? n : DEFAULT_PAGE_SIZE;

  const { items, total } = await daftarUsulan({ status, cari: cari || undefined, page, pageSize });

  return (
    <UsulanTokoListClient
      status={status}
      cari={cari}
      page={page}
      pageSize={pageSize}
      total={total}
      baris={items.map((b) => ({
        id: b.id,
        name: b.name,
        address: b.address,
        status: b.status,
        termsType: b.termsType,
        areaCode: b.areaCode,
        pengusul: b.pengusul,
        adaLokasi: b.adaLokasi,
        tanggal: formatDisplayDate(b.createdAt),
      }))}
    />
  );
}

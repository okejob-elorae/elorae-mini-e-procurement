import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SuppliersPageClient } from "./SuppliersPageClient";
import { bacaSaringPemasok } from "./status-pemasok";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ cari?: string; jenis?: string; status?: string; page?: string; pageSize?: string }>;
};

/**
 * Daftar pemasok. Saringan dibaca dari alamat supaya bisa dibagikan; izin
 * dikirim dari server supaya tombol Setujui/Tolak tampil menurut
 * `suppliers:approve` sejak muat pertama.
 */
export default async function SuppliersPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const sp = await searchParams;
  return <SuppliersPageClient awal={bacaSaringPemasok(sp)} izin={session.user.permissions ?? []} />;
}

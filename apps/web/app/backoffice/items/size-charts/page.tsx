import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarTabelUkuran, kategoriUntukTabelUkuran } from "@/lib/items/size-chart-queries";
import { TabelUkuranClient } from "./TabelUkuranClient";

export const dynamic = "force-dynamic";

/**
 * Master tabel ukuran. Yang dilihat SPG di HP saat pembeli menanyakan ukuran
 * (Info produk). Lihat = `items:view`; buat/ubah/hapus = `items:manage` —
 * yang hanya boleh melihat membuka tabelnya tanpa tombol simpan.
 */
export default async function SizeChartsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.ITEMS_VIEW)) redirect("/backoffice");

  const [data, kategori] = await Promise.all([daftarTabelUkuran(), kategoriUntukTabelUkuran()]);
  return <TabelUkuranClient data={data} kategori={kategori} bolehUbah={hasPermission(perms, PERMISSIONS.ITEMS_MANAGE)} />;
}

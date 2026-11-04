import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaParamBrand } from "@/lib/creative/brand-param";
import { bacaPengaturanBrand } from "@/lib/creative/brand-pengaturan";
import { daftarBrand, kolUntukBrand } from "@/lib/creative/brand-queries";
import { BrandClient } from "./BrandClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Kreatif → Brand: brand yang pernah ditandai KOL (riwayat `KolBrandCollab`,
 * diisi ekstensi dan isian manual) — jumlah KOL, jumlah posting, posting
 * terakhir; `?brand=` membuka KOL-KOL yang menandai satu brand. Saringan,
 * pencarian, dan halaman di alamat; dikelompokkan dan dipotong di server.
 * Baca saja (`creative:view`).
 */
export default async function BrandPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");

  const param = bacaParamBrand(await searchParams);
  const pengaturan = await bacaPengaturanBrand();
  if (param.brand) {
    const data = await kolUntukBrand(param.brand, param.halaman, { pengaturan });
    return <BrandClient param={{ ...param, halaman: data.halaman }} rincian={data} />;
  }
  const data = await daftarBrand(param, { pengaturan });
  return <BrandClient param={{ ...param, halaman: data.halaman }} direktori={data} />;
}

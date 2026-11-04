import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { dataSuratJalanMutasi, responsSuratJalan, responsSuratJalanTidakAda } from "@/lib/spg/surat-jalan-queries";

export const dynamic = "force-dynamic";

/**
 * Surat jalan satu mutasi untuk kantor — dokumen yang sama dengan HP SPG,
 * dibuka di tab baru dan langsung masuk jendela cetak. Izinnya sama dengan
 * rincian mutasi kantor (`spg_sales:view`).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const kembali = `/backoffice/spg-transfers/${encodeURIComponent(id)}`;
  const session = await auth();
  if (!session?.user?.id) return responsSuratJalanTidakAda("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_VIEW)) {
    return responsSuratJalanTidakAda("/backoffice", "Anda tidak punya izin melihat mutasi antar toko.");
  }

  const data = await dataSuratJalanMutasi(id);
  if (!data) return responsSuratJalanTidakAda("/backoffice/spg-transfers", "Mutasi ini tidak ada.");

  return responsSuratJalan({
    data,
    userId: session.user.id,
    kembaliHref: kembali,
    pratinjau: req.nextUrl.searchParams.get("pratinjau") === "1",
    dari: "KANTOR",
  });
}

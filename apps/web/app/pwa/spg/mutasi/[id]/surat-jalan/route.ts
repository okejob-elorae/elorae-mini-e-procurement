import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { bolehDibukaSpg } from "@/lib/spg/surat-jalan";
import { dataSuratJalanMutasi, responsSuratJalan, responsSuratJalanTidakAda } from "@/lib/spg/surat-jalan-queries";

export const dynamic = "force-dynamic";

/**
 * Surat jalan satu mutasi untuk HP SPG — halaman HTML A4 mandiri yang langsung
 * membuka jendela cetak (cetak atau "Simpan sebagai PDF").
 *
 * Toko SPG selalu dari server (`assignedStoreId`). Toko asal boleh membukanya
 * kapan saja (draf sebelum dikirim); toko tujuan baru sesudah barang berangkat.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const kembali = `/pwa/spg/mutasi/${encodeURIComponent(id)}`;
  const session = await auth();
  if (!session?.user?.id) return responsSuratJalanTidakAda("/login");

  const storeId = await ambilTokoTetap(session.user.id);
  if (!storeId) return responsSuratJalanTidakAda("/pwa");

  const data = await dataSuratJalanMutasi(id);
  if (!data || !bolehDibukaSpg(data, storeId)) return responsSuratJalanTidakAda("/pwa/spg/mutasi");

  return responsSuratJalan({
    data,
    userId: session.user.id,
    kembaliHref: kembali,
    pratinjau: req.nextUrl.searchParams.get("pratinjau") === "1",
    dari: "HP",
  });
}

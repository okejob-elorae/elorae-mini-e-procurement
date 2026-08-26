import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { bahanKlaimBaru } from "@/lib/receivables/claim-queries";
import { KlaimBaruClient } from "@/app/backoffice/pelunasan/baru/KlaimBaruClient";

export const dynamic = "force-dynamic";

/**
 * Lapor pelunasan dari lapangan.
 *
 * Memakai ULANG formulir kantor, bukan menyalinnya. Ini formulir uang — ia
 * menghitung nilai faktur, potongan, dan yang diterima — dan dua salinan
 * formulir semacam itu akan menyimpang, lalu dua orang menyebut angka berbeda
 * untuk transfer yang sama. Susunannya sudah menumpuk sendiri di layar sempit.
 */
export default async function KlaimBaruLapanganPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  return <KlaimBaruClient bahan={await bahanKlaimBaru()} kembaliKe="/pwa/bkm" />;
}

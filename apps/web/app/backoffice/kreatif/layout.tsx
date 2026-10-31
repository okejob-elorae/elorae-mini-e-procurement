import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hitungTugasKreatif } from "@/lib/creative/tugas-queries";
import { KreatifTabs } from "./KreatifTabs";

/**
 * Gerbang modul creative marketing.
 *
 * Digerbangi di layout, bukan halaman per halaman: layar-layar Ruang KOL
 * membaca data yang sama dan pengiriman sampel menggerakkan stok gudang. Satu
 * pintu lebih susah ditinggalkan daripada sebelas.
 */
export default async function KreatifLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.CREATIVE_VIEW)) {
    redirect("/backoffice");
  }
  // Lencana Hari ini. `tugasKreatif` ber-`cache`: di halaman Hari ini bacaan
  // yang sama dipakai ulang. Gagal menghitung tidak boleh merobohkan tab.
  const jumlahTugas = await hitungTugasKreatif(session.user.id ?? null).catch((err) => {
    console.error("lencana Hari ini gagal dihitung:", err);
    return 0;
  });
  return (
    <div className="space-y-6">
      <KreatifTabs jumlahTugas={jumlahTugas} />
      {children}
    </div>
  );
}

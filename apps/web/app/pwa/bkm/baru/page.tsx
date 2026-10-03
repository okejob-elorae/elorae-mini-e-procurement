import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { bahanKlaimBaru, bahanSalinKlaim } from "@/lib/receivables/claim-queries";
import { Button } from "@/components/ui/button";
import { KlaimBaruClient } from "@/app/backoffice/pelunasan/baru/KlaimBaruClient";
import { TautanKembali } from "../../TautanKembali";

export const dynamic = "force-dynamic";

/**
 * Lapor pelunasan dari lapangan.
 *
 * Memakai ULANG formulir kantor, bukan menyalinnya. Ini formulir uang — ia
 * menghitung nilai faktur, potongan, dan yang diterima — dan dua salinan
 * formulir semacam itu akan menyimpang, lalu dua orang menyebut angka berbeda
 * untuk transfer yang sama. Susunannya sudah menumpuk sendiri di layar sempit.
 */
export default async function KlaimBaruLapanganPage({ searchParams }: { searchParams: Promise<{ salin?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  // Layar salesman keliling: SPG (toko tetap) dikembalikan ke berandanya.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");

  // "Laporkan ulang": hanya laporan milik sales ini yang ditolak/dibatalkan.
  const { salin } = await searchParams;
  const awal = salin ? await bahanSalinKlaim(salin, { salesmanId: session.user.id }) : null;

  // `antreLuring`: tanpa sinyal, laporan disimpan di HP dan terkirim sendiri
  // begitu sinyal kembali — formulir kantor tidak memakainya.
  return (
    <div className="p-4">
      {/* Hanya piutang yang ia tagih: toko yang ia pegang, atau yang ia jual
          selama tokonya belum punya pemegang. */}
      <KlaimBaruClient
        bahan={await bahanKlaimBaru({ penagihId: session.user.id })}
        kembaliKe="/pwa/bkm"
        antreLuring
        awal={awal}
        tombolKembali={
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <TautanKembali cadangan="/pwa/bkm" />
          </Button>
        }
      />
    </div>
  );
}

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { TautanDashboard } from "./TautanDashboard";
import { bolehMenghitung } from "@/lib/receivables/izin";

/**
 * Layar gudang, di luar pohon `/pwa`.
 *
 * `/pwa` digerbangi `pwa:access` — izin milik sales lapangan — dan orang gudang
 * tidak memilikinya. Memberikannya kepada gudang akan membuka seluruh layar
 * sales sekaligus, jadi layar ini berdiri sendiri dengan gerbangnya sendiri:
 * izin MENGHITUNG. Pemisahan tugas itu yang membuat retur dua sisi berarti.
 *
 * Konsekuensinya ia bukan bagian PWA — tidak terpasang sebagai aplikasi dan
 * tidak jalan luring. Untuk orang gudang yang berdiri di dalam gedung dengan
 * WiFi kantor, itu pertukaran yang wajar.
 */
export default async function LayoutGudangRetur({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/gudang-retur");
  if (!bolehMenghitung(session.user.permissions)) redirect("/backoffice");

  return (
    <div className="min-h-dvh bg-background">
      {/* Lebar dibatasi di desktop: kartu nota tidak melebar sepanjang layar 1440 px. */}
      <div className="mx-auto w-full max-w-3xl">
        <div className="px-4 pt-3">
          <TautanDashboard />
        </div>
        {children}
      </div>
    </div>
  );
}

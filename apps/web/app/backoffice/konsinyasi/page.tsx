import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bolehMembukaKonsi, bolehMengelolaKonsi } from "@/lib/receivables/izin";
import { daftarSiklus, tokoKonsi } from "@/lib/konsinyasi/queries";
import { katalogBarang } from "@/lib/receivables/return-queries";
import { KonsinyasiClient } from "./KonsinyasiClient";
import { bacaSaringSiklus, saringSiklus } from "./saring";
import { URUT_TAHAP } from "./tahap";
import { bacaCari, bacaHalaman, potongHalaman } from "../piutang/_daftar/halaman";

export const dynamic = "force-dynamic";

/**
 * Saringan di server: `?tahap=` (bawaannya yang belum selesai), `?cari=`,
 * `?halaman=`. Jumlah per tahap dan peringatan gaji tetap atas SEMUA siklus.
 */
export default async function KonsinyasiPage(props?: {
  searchParams: Promise<{ tahap?: string; cari?: string; halaman?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  if (!bolehMembukaKonsi(session.user.permissions)) redirect("/backoffice");

  const sp = (await props?.searchParams) ?? {};
  const saring = bacaSaringSiklus(sp.tahap);
  const cari = bacaCari(sp.cari);
  const kelola = bolehMengelolaKonsi(session.user.permissions);
  const [semua, toko, katalog] = await Promise.all([
    daftarSiklus(),
    kelola ? tokoKonsi() : Promise.resolve([]),
    kelola ? katalogBarang() : Promise.resolve([]),
  ]);
  const halaman = potongHalaman(saringSiklus(semua, { saring, cari }), bacaHalaman(sp.halaman));

  return (
    <KonsinyasiClient
      baris={halaman.baris}
      halaman={{ halaman: halaman.halaman, totalHalaman: halaman.totalHalaman, total: halaman.total, ukuran: halaman.ukuran }}
      jumlah={{
        semua: semua.length,
        berjalan: semua.filter((b) => b.tahap !== "selesai").length,
        terlambat: semua.filter((b) => b.gajiTerlambat).length,
        perTahap: Object.fromEntries(URUT_TAHAP.map((x) => [x, semua.filter((b) => b.tahap === x).length])) as Record<
          (typeof URUT_TAHAP)[number],
          number
        >,
      }}
      saring={saring}
      cari={cari}
      toko={toko}
      katalog={katalog}
      bolehMengelola={kelola}
      // Halaman isi ulang memagari dirinya dengan stores:view.
      bolehIsiUlang={hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_VIEW)}
    />
  );
}

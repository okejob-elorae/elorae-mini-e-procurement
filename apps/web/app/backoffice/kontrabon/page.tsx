import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarKontrabon, piutangSiapKontrabon } from "@/lib/receivables/collection-queries";
import { bolehMembacaPiutang } from "@/lib/receivables/izin";
import { KontrabonClient } from "./KontrabonClient";
import { bacaSaringKontrabon, perluKonfirmasi, saringKontrabon } from "./saring";
import { bacaCari, bacaHalaman, potongHalaman } from "../piutang/_daftar/halaman";

export const dynamic = "force-dynamic";

/**
 * Saringan di server: `?saring=belum` (tautan Beranda "Belum dikonfirmasi"),
 * `?saring=semua`, `?cari=`, `?halaman=`. Bawaannya hanya yang berjalan.
 */
export default async function KontrabonPage(props?: {
  searchParams: Promise<{ saring?: string; cari?: string; halaman?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  // Rute modul piutang tidak dipetakan di ROUTE_PERMISSIONS — halaman memagari dirinya sendiri.
  if (!bolehMembacaPiutang(session.user.permissions)) redirect("/backoffice");

  const sp = (await props?.searchParams) ?? {};
  const saring = bacaSaringKontrabon(sp.saring);
  const cari = bacaCari(sp.cari);
  const [semua, kandidat] = await Promise.all([daftarKontrabon(), piutangSiapKontrabon()]);
  const halaman = potongHalaman(saringKontrabon(semua, { saring, cari }), bacaHalaman(sp.halaman));

  return (
    <KontrabonClient
      baris={halaman.baris}
      halaman={{ halaman: halaman.halaman, totalHalaman: halaman.totalHalaman, total: halaman.total, ukuran: halaman.ukuran }}
      jumlah={{
        berjalan: semua.filter((b) => b.status === "BERJALAN").length,
        lewat: semua.filter((b) => b.status === "BERJALAN" && (b.sisaHari ?? 0) < 0).length,
        belum: semua.filter(perluKonfirmasi).length,
        semua: semua.length,
      }}
      saring={saring}
      cari={cari}
      kandidat={kandidat}
      bolehMengelola={hasPermission(
        session.user.permissions ?? [],
        PERMISSIONS.RECEIVABLES_MANAGE,
      )}
    />
  );
}

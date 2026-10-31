import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarPiutang, ringkasPiutang } from "@/lib/receivables/queries";
import { katalogBarang, tokoUntukRetur } from "@/lib/receivables/return-queries";
import { bacaKeadaanTampil } from "@/lib/receivables/jatuh-tempo";
import { bolehMembacaPiutang } from "@/lib/receivables/izin";
import { PiutangClient } from "./PiutangClient";
import { hitungPilPiutang, saringPiutang } from "./saring";
import { bacaCari, bacaHalaman, potongHalaman } from "./_daftar/halaman";

export const dynamic = "force-dynamic";

/**
 * `?keadaan=` (termasuk `jatuh_tempo`), `?cari=`, dan `?halaman=` disaring di
 * server: tautan beranda ("Lewat janji bayar", "Lewat jatuh tempo", satu faktur
 * di daftar tindakan) mendarat di daftar yang sudah tersaring, dan peramban
 * hanya menerima satu halaman. Ringkasan di kepala tetap atas SEMUA faktur.
 */
export default async function PiutangPage({
  searchParams,
}: {
  searchParams: Promise<{ keadaan?: string; cari?: string; halaman?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  // Rute modul piutang tidak dipetakan di ROUTE_PERMISSIONS — halaman memagari dirinya sendiri.
  if (!bolehMembacaPiutang(session.user.permissions)) redirect("/backoffice");
  const sp = await searchParams;
  const saring = bacaKeadaanTampil(sp.keadaan);
  const cari = bacaCari(sp.cari);

  const bolehMengelola = hasPermission(
    session.user.permissions ?? [],
    PERMISSIONS.RECEIVABLES_MANAGE,
  );
  // Toko dan katalog hanya dibutuhkan oleh formulir faktur manual; tidak
  // diambil sama sekali untuk yang tidak boleh membukanya.
  const [semua, toko, katalog] = await Promise.all([
    daftarPiutang(),
    bolehMengelola ? tokoUntukRetur() : Promise.resolve([]),
    bolehMengelola ? katalogBarang() : Promise.resolve([]),
  ]);
  const halaman = potongHalaman(saringPiutang(semua, { keadaan: saring, cari }), bacaHalaman(sp.halaman));

  return (
    <PiutangClient
      baris={halaman.baris}
      halaman={{ halaman: halaman.halaman, totalHalaman: halaman.totalHalaman, total: halaman.total, ukuran: halaman.ukuran }}
      adaFaktur={semua.length > 0}
      ringkasan={ringkasPiutang(semua)}
      pil={hitungPilPiutang(semua, cari)}
      toko={toko}
      katalog={katalog}
      bolehMengelola={bolehMengelola}
      saring={saring}
      cari={cari}
    />
  );
}

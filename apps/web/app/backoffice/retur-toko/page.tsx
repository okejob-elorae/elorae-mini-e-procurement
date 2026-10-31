import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  daftarKerjaRetur,
  katalogBarang,
  notaBelumBerpasangan,
  ringkasKerjaRetur,
  tokoUntukRetur,
} from "@/lib/receivables/return-queries";
import { prisma } from "@elorae/db";
import { bolehMembacaRetur } from "@/lib/receivables/izin";
import { koreksiTertunda } from "@/lib/receivables/koreksi";
import { ReturTokoClient } from "./ReturTokoClient";
import { bacaSaringRetur, butakan, calonUntukPenonton, saringKerjaRetur } from "./buta";
import { bacaCari, bacaHalaman, potongHalaman } from "../piutang/_daftar/halaman";

export const dynamic = "force-dynamic";

/**
 * Saringan di server: `?koreksi=1` (tautan Beranda "Permintaan koreksi nota
 * retur"), `?langkah=`, `?cari=`, `?halaman=`. Bawaannya daftar kerja (yang
 * belum beres). Ringkasan di kepala tetap atas SEMUA nota.
 */
export default async function ReturTokoPage(props?: {
  searchParams: Promise<{ koreksi?: string; langkah?: string; cari?: string; halaman?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  // Rute modul piutang tidak dipetakan di ROUTE_PERMISSIONS — halaman memagari dirinya sendiri.
  // Gudang yang menghitung dan keuangan yang memverifikasi ikut membaca.
  if (!bolehMembacaRetur(session.user.permissions)) redirect("/backoffice");

  const sp = (await props?.searchParams) ?? {};
  const saring = bacaSaringRetur(sp);
  const cari = bacaCari(sp.cari);

  const izin = session.user.permissions ?? [];
  const bolehMengelola = hasPermission(izin, PERMISSIONS.RECEIVABLES_MANAGE);
  const [semua, toko, calonPasangan, katalog] = await Promise.all([
    daftarKerjaRetur(),
    tokoUntukRetur(),
    // Hanya untuk dialog Jodohkan, yang hanya terbuka bagi pengelola.
    bolehMengelola ? notaBelumBerpasangan() : Promise.resolve([]),
    katalogBarang(),
  ]);
  const bolehMenghitung = hasPermission(izin, PERMISSIONS.INVENTORY_OPNAME_COUNT);
  const penggunaId = session.user.id ?? "";
  // Nota yang dilaporkan SPG — diberi tanda "dari SPG" di daftar.
  const idNrt = semua.filter((b) => b.jenis === "NRT").map((b) => b.id);
  const dariSpg = idNrt.length
    ? (await prisma.storeReturn.findMany({ where: { id: { in: idNrt }, reportedBySpg: true }, select: { id: true } })).map((n) => n.id)
    : [];
  // Definisi yang sama dengan baris Beranda (`dokumenKoreksiTertunda`).
  const koreksi = await koreksiTertunda("retur", idNrt);
  const halaman = potongHalaman(
    saringKerjaRetur(semua, { saring, cari, koreksi: new Set(koreksi.keys()) }),
    bacaHalaman(sp.halaman),
  );
  const lingkupButa = { bolehMenghitung, penggunaId };

  return (
    <ReturTokoClient
      // Klaim nota yang belum dihitung dibuang DI SERVER untuk orang yang akan
      // menghitungnya — hitungan gudang harus buta, juga di layar kantor.
      baris={butakan(halaman.baris, lingkupButa)}
      halaman={{ halaman: halaman.halaman, totalHalaman: halaman.totalHalaman, total: halaman.total, ukuran: halaman.ukuran }}
      adaBaris={semua.length > 0}
      // "Tertahan dari piutang" di kepala menjumlah potongan — dengan satu nota
      // buta, angkanya sama dengan klaim nota itu. Dihitung dari baris yang
      // sudah dibutakan, jadi yang tidak boleh terlihat tidak ikut terjumlah.
      ringkasan={ringkasKerjaRetur(butakan(semua, lingkupButa))}
      toko={toko}
      katalog={katalog}
      calonPasangan={calonUntukPenonton(
        calonPasangan.map((n) => ({
          id: n.id,
          noNrt: n.noNrt,
          storeId: n.store.id,
          storeName: n.store.name,
          nilaiKlaim: Number(n.claimedAmount),
          tanggal: n.claimDate.toISOString(),
        })),
        semua,
        { bolehMengelola, ...lingkupButa },
      )}
      bolehMengelola={bolehMengelola}
      bolehMenghitung={bolehMenghitung}
      penggunaId={penggunaId}
      dariSpg={dariSpg}
      jumlahKoreksi={koreksi.size}
      koreksiIds={[...koreksi.keys()]}
      saring={saring}
      cari={cari}
    />
  );
}

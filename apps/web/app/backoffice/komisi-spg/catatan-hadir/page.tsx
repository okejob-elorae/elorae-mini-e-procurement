import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bolehMembukaCatatanHadir, menungguDiperiksa, perluDimasukkan } from "@/lib/spg/absen-catatan-hadir";
import { daftarCatatanHadirKantor, rincianCatatanHadir, type BarisCatatanHadirKantor } from "@/lib/spg/absen-catatan-hadir-queries";
import { CatatanHadirClient, type SaringanCatatan } from "./CatatanHadirClient";

export const dynamic = "force-dynamic";

const SARINGAN: readonly SaringanCatatan[] = ["semua", "masukkan", "periksa", "dikembalikan"];

// "masukkan" dan "periksa" memakai predikat yang SAMA dengan angka Beranda yang menautkan ke sini
// (`jumlahCatatanHadirPerluDimasukkan` / `…MenungguPeriksa`), jadi angka dan barisnya selalu sama.
const cocok = (b: BarisCatatanHadirKantor, s: SaringanCatatan) =>
  s === "semua" ||
  (s === "masukkan" && perluDimasukkan(b)) ||
  (s === "periksa" && menungguDiperiksa(b)) ||
  (s === "dikembalikan" && b.catatan?.status === "DIKEMBALIKAN");

const satu = (x: string | string[] | undefined) => (Array.isArray(x) ? x[0] : x);

/**
 * Komisi SPG → Catatan check-in toko (P7d, P7e, P61a). Untuk SPG yang tidak mengisi jadwalnya:
 * kantor memasukkan catatan check-in dari toko (diketik atau berkas Excel/CSV,
 * `spg_attendance:record`), lalu orang lain memeriksanya (`spg_attendance:verify`) sebelum menjadi
 * dasar gaji pokok. Pengawas SPG (`spg_sales:view`) boleh membuka dan membaca saja (B32). Tombol
 * memakai izin yang sama dengan aksinya.
 *
 * `?perlu=masukkan|periksa|dikembalikan|semua` menyaring daftar (tautan lonceng dan Beranda);
 * `?user=&bulan=` membuka bandingan hari demi hari — catatan di samping jadwal, check-in sistem
 * (dengan tanda di luar radius), dan izin yang disetujui (B14).
 */
export default async function CatatanHadirPage({
  searchParams,
}: {
  searchParams: Promise<{ perlu?: string | string[]; user?: string | string[]; bulan?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!bolehMembukaCatatanHadir(izin)) redirect("/backoffice/dashboard");
  const bolehCatat = hasPermission(izin, PERMISSIONS.SPG_ATTENDANCE_RECORD);
  const bolehPeriksa = hasPermission(izin, PERMISSIONS.SPG_ATTENDANCE_VERIFY);

  const q = await searchParams;
  const perluTeks = satu(q.perlu);
  const perlu: SaringanCatatan = SARINGAN.includes(perluTeks as SaringanCatatan) ? (perluTeks as SaringanCatatan) : "semua";
  const userId = satu(q.user);
  const bulan = satu(q.bulan);

  const [semua, rincian] = await Promise.all([daftarCatatanHadirKantor(), userId && bulan ? rincianCatatanHadir(userId, bulan) : Promise.resolve(null)]);
  return (
    <CatatanHadirClient
      baris={semua.filter((b) => cocok(b, perlu))}
      perlu={perlu}
      rincian={rincian}
      bolehCatat={bolehCatat}
      bolehPeriksa={bolehPeriksa}
      penggunaId={session.user.id}
    />
  );
}

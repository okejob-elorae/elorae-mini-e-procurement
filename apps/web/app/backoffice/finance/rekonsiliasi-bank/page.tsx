import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { tanggalKalenderSah } from "@/lib/finance/kas/aturan";
import { akunBarisVoucher } from "@/lib/finance/kas/voucher-queries";
import { daftarKategori } from "@/lib/finance/kas/kategori-writer";
import {
  daftarImporMutasi,
  daftarMutasi,
  daftarRekeningRekonsiliasi,
  laporanRekonsiliasi,
  type HalamanMutasi,
  type ImporMutasiTampil,
  type LaporanRekonsiliasi,
} from "@/lib/finance/bank/queries";
import { RekonsiliasiBankClient, type SaringanRekonsiliasi } from "./RekonsiliasiBankClient";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;
const satu = (v: Param) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Keuangan → Rekonsiliasi bank: impor mutasi rekening (CSV/Excel BCA, Mandiri,
 * format umum), cocok otomatis ke baris jurnal akun bank (jumlah sama, ±3
 * hari), cocok manual, catat biaya admin/bunga sebagai voucher langsung dari
 * barisnya, abaikan, dan laporan rekonsiliasi per tanggal. Melihat
 * `journals:view`; mengubah `journals:manage`.
 */
export default async function RekonsiliasiBankPage({
  searchParams,
}: {
  searchParams: Promise<{ akun?: Param; tab?: Param; status?: Param; dari?: Param; sampai?: Param; halaman?: Param; tanggal?: Param }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");
  const sp = await searchParams;
  const hariIni = hariIniWib();
  const rekening = await daftarRekeningRekonsiliasi();
  const akunDiminta = satu(sp.akun);
  const akun = rekening.find((r) => r.id === akunDiminta)?.id ?? rekening[0]?.id ?? "";
  const tab = satu(sp.tab) === "laporan" ? "laporan" : satu(sp.tab) === "impor" ? "impor" : "mutasi";
  const status = satu(sp.status);
  const saringan: SaringanRekonsiliasi = {
    akun,
    tab,
    status: status === "MATCHED" || status === "IGNORED" || status === "SEMUA" ? status : "UNMATCHED",
    dari: tanggalKalenderSah(satu(sp.dari)) ? satu(sp.dari) : "",
    sampai: tanggalKalenderSah(satu(sp.sampai)) ? satu(sp.sampai) : "",
    halaman: Math.max(1, Number.parseInt(satu(sp.halaman), 10) || 1),
    tanggal: tanggalKalenderSah(satu(sp.tanggal)) ? satu(sp.tanggal) : hariIni,
  };
  const kelola = hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE);

  let mutasi: HalamanMutasi | null = null;
  let laporan: LaporanRekonsiliasi | null = null;
  let impor: ImporMutasiTampil[] = [];
  let gagal = false;
  if (akun) {
    try {
      if (tab === "mutasi") {
        mutasi = await daftarMutasi({ akunId: akun, status: saringan.status === "SEMUA" ? null : saringan.status, dari: saringan.dari || null, sampai: saringan.sampai || null, halaman: saringan.halaman });
      } else if (tab === "laporan") {
        laporan = await laporanRekonsiliasi(akun, saringan.tanggal);
      } else {
        impor = await daftarImporMutasi(akun);
      }
    } catch (e) {
      console.error("[rekonsiliasi-bank] gagal", e);
      gagal = true;
    }
  }
  const [akunPilihan, kategori] = kelola && tab === "mutasi" ? await Promise.all([akunBarisVoucher(new Set(rekening.map((r) => r.id))), daftarKategori()]) : [[], []];

  return (
    <RekonsiliasiBankClient
      key={JSON.stringify(saringan)}
      saringan={saringan}
      rekening={rekening}
      mutasi={mutasi}
      laporan={laporan}
      impor={impor}
      gagal={gagal}
      hariIni={hariIni}
      akunPilihan={akunPilihan}
      kategori={kategori.filter((k) => k.aktif)}
      bolehKelola={kelola}
    />
  );
}

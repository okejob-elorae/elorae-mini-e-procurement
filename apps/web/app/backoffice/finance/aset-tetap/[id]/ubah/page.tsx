import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { akunUntukAset, pemasokUntukAset, rincianAset } from "@/lib/finance/aset/queries";
import { FormAset } from "../../FormAset";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

/**
 * Keuangan → Aset tetap → Ubah aset. Butuh `journals:manage`. Nilai
 * penyusutannya terkunci sesudah ada penyusutan berjurnal atau bila
 * perolehannya dijurnal di sini (penulisnya yang menolak).
 */
export default async function UbahAsetPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) redirect(`/backoffice/finance/aset-tetap/${id}`);
  const [a, akun, pemasok] = await Promise.all([rincianAset(id), akunUntukAset(), pemasokUntukAset()]);
  if (!a) notFound();
  if (a.status !== "ACTIVE") redirect(`/backoffice/finance/aset-tetap/${id}`);
  const rp = (n: number) => (n ? String(n) : "");
  return (
    <FormAset
      akun={akun}
      pemasok={pemasok}
      hariIni={hariIniWib()}
      ubah={{
        id: a.id,
        kode: a.kode,
        nilaiTerkunci: a.sudahDisusutkan ? "SUDAH_DISUSUTKAN" : a.jurnalPerolehanId ? "ADA_JURNAL_PEROLEHAN" : null,
        nilai: {
          nama: a.nama,
          kategori: a.kategori,
          tanggalPerolehan: a.tanggalPerolehan,
          biaya: String(a.biaya),
          nilaiSisa: rp(a.nilaiSisa),
          umurBulan: String(a.umurBulan),
          metode: a.metode,
          tarifSaldoMenurun: a.tarifSaldoMenurun != null ? String(a.tarifSaldoMenurun) : "",
          mulaiDisusutkan: a.mulaiDisusutkan,
          akumulasiAwal: rp(a.akumulasiAwal),
          cara: a.jurnalPerolehanId ? "JURNAL" : (a.cara ?? "SUDAH_DICATAT"),
          akunAsetId: a.akunAset?.id ?? "",
          akunAkumulasiId: a.akunAkumulasi?.id ?? "",
          akunBebanId: a.akunBeban?.id ?? "",
          lokasi: a.lokasi ?? "",
          pemasokId: a.pemasok?.id ?? "",
          catatan: a.catatan ?? "",
        },
      }}
    />
  );
}

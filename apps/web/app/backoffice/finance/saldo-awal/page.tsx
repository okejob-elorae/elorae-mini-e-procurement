import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { jenisDariSlug, type EntriHutang, type EntriPiutangMarketplace, type EntriPiutangToko } from "@/lib/finance/saldo-awal/jenis";
import { tanggalJurnalSaldoAwal, type PeriodeTertutup } from "@/lib/finance/saldo-awal/tanggal";
import {
  akunUntukSaldoAwal,
  bacaKeadaanSaldoAwal,
  jumlahJurnalSebelumMulai,
  pemasokUntukSaldoAwal,
  periodeTertutupSaldoAwal,
  peranSaldoAwalBelumDipetakan,
  type AkunSaldoAwal,
} from "@/lib/finance/saldo-awal/queries";
import { hitungHutangPemasokAwal, hitungPiutangMarketplaceAwal, hitungPiutangTokoAwal } from "@/lib/finance/saldo-awal/hitung-queries";
import { SaldoAwalClient, type DataJenis } from "./SaldoAwalClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ jenis?: string | string[] }> };

/**
 * Keuangan → Saldo awal: posisi pada tanggal mulai buku besar, per jenis.
 * Melihat `journals:view`; menyimpan draf dan memposting `journals:manage`.
 * Hanya data jenis yang sedang dibuka yang dihitung (piutang marketplace
 * membaca seluruh pesanan sebelum tanggal mulai).
 */
export default async function SaldoAwalPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const jenis = jenisDariSlug(Array.isArray(sp.jenis) ? sp.jenis[0] : sp.jenis) ?? "ACCOUNTS";

  const mulai = await readGlCutover();
  const tanggalMulai = mulai ? formatDateOnlyJakarta(mulai) : null;
  const tanggalJurnal = tanggalMulai ? tanggalJurnalSaldoAwal(tanggalMulai) : null;

  let gagal = false;
  let data: DataJenis = { jenis: "ACCOUNTS", akun: [] };
  let periodeTertutup: PeriodeTertutup | null = null;
  let jurnalSebelum = 0;
  let peranBelum: string[] = [];
  let keadaan: Awaited<ReturnType<typeof bacaKeadaanSaldoAwal>> | null = null;
  try {
    const [k, belum, tertutup, sebelum] = await Promise.all([
      bacaKeadaanSaldoAwal(tanggalMulai),
      peranSaldoAwalBelumDipetakan(),
      tanggalJurnal ? periodeTertutupSaldoAwal(tanggalJurnal) : Promise.resolve(null),
      mulai ? jumlahJurnalSebelumMulai(mulai) : Promise.resolve(0),
    ]);
    keadaan = k;
    peranBelum = belum;
    periodeTertutup = tertutup;
    jurnalSebelum = sebelum;

    switch (jenis) {
      case "ACCOUNTS": {
        const akun: AkunSaldoAwal[] = await akunUntukSaldoAwal();
        data = { jenis, akun };
        break;
      }
      case "INVENTORY":
        data = { jenis };
        break;
      case "AR_STORE": {
        const hitungan: EntriPiutangToko[] = mulai ? await hitungPiutangTokoAwal(mulai) : [];
        data = { jenis, hitungan };
        break;
      }
      case "AR_MARKETPLACE": {
        const hitungan: EntriPiutangMarketplace[] = mulai ? await hitungPiutangMarketplaceAwal(mulai) : [];
        data = { jenis, hitungan };
        break;
      }
      case "AP": {
        const [hitungan, pemasok]: [EntriHutang[], Awaited<ReturnType<typeof pemasokUntukSaldoAwal>>] = await Promise.all([
          mulai ? hitungHutangPemasokAwal(mulai) : Promise.resolve([]),
          pemasokUntukSaldoAwal(),
        ]);
        data = { jenis, hitungan, pemasok };
        break;
      }
    }
  } catch (err) {
    console.error("[saldo-awal] halaman gagal dimuat", err);
    gagal = true;
  }

  return (
    <SaldoAwalClient
      jenis={jenis}
      tanggalMulai={tanggalMulai}
      tanggalJurnal={tanggalJurnal}
      keadaan={keadaan}
      data={data}
      periodeTertutup={periodeTertutup}
      jurnalSebelum={jurnalSebelum}
      peranBelum={peranBelum}
      gagal={gagal}
      bolehMengelola={hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE)}
      bolehBaganAkun={hasPermission(izin, PERMISSIONS.COA_VIEW)}
    />
  );
}

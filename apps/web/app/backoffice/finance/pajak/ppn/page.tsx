import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaMasaPajak } from "@/lib/finance/pajak/masa";
import { bacaPengaturanPpn } from "@/lib/finance/pajak/ppn-pengaturan";
import { bacaProfilPajak } from "@/lib/finance/pajak/profil-pengaturan";
import { daftarMasaPpn, rekapPpnMasa, type RekapPpnLengkap, type RingkasMasaPpn } from "@/lib/finance/pajak/masa-queries";
import { aksesPajak } from "../_bersama/akses";
import { RekapPpnClient } from "./RekapPpnClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ tahun?: string | string[]; masa?: string | string[] }> };

const satu = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Keuangan → Pajak → Rekap PPN: PPN keluaran − masukan per masa dari buku
 * besar, finalisasi (jurnal penyelesaian) dan buka kembali. Melihat
 * `journals:view`; finalisasi `journals:manage`.
 */
export default async function RekapPpnPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const akses = aksesPajak(session.user.permissions ?? []);
  if (!akses.bacaJurnal) redirect("/backoffice");

  const sp = await searchParams;
  const hariIni = hariIniWib();
  const masaIni = hariIni.slice(0, 7);
  const masa = bacaMasaPajak(satu(sp.masa));
  const tahunTeks = satu(sp.tahun);
  const tahun = masa ? Number(masa.slice(0, 4)) : /^\d{4}$/.test(tahunTeks ?? "") ? Number(tahunTeks) : Number(masaIni.slice(0, 4));

  let daftar: RingkasMasaPpn[] = [];
  let rincian: RekapPpnLengkap | null = null;
  let gagal = false;
  const [ppn, profil] = await Promise.all([bacaPengaturanPpn(), bacaProfilPajak()]);
  try {
    [daftar, rincian] = await Promise.all([daftarMasaPpn(tahun, masaIni), masa ? rekapPpnMasa(masa) : Promise.resolve(null)]);
  } catch (e) {
    console.error("[rekap-ppn] gagal", e);
    gagal = true;
  }
  return (
    <RekapPpnClient
      tahun={tahun}
      masaIni={masaIni}
      masa={masa}
      daftar={daftar}
      rincian={rincian}
      statusPkp={ppn.statusPkp}
      rezimPph={profil.rezimPph}
      akses={akses}
      gagal={gagal}
    />
  );
}

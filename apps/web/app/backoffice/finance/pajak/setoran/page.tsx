import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaMasaPajak } from "@/lib/finance/pajak/masa";
import { bacaJenisSetoran } from "@/lib/finance/pajak/setoran";
import { bacaPengaturanPpn } from "@/lib/finance/pajak/ppn-pengaturan";
import { bacaProfilPajak } from "@/lib/finance/pajak/profil-pengaturan";
import { daftarSetoran, rekeningKasBank, type BarisSetoran, type RekeningKasBank } from "@/lib/finance/pajak/setoran-queries";
import { aksesPajak } from "../_bersama/akses";
import { SetoranPajakClient } from "./SetoranPajakClient";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;
type PageProps = {
  searchParams: Promise<{ tahun?: Param; jenis?: Param; id?: Param; baru?: Param; masa?: Param; jumlah?: Param }>;
};

const satu = (v: Param) => (Array.isArray(v) ? v[0] : v);

/**
 * Keuangan → Pajak → Setoran: setoran pajak per tahun (NTPN, jurnal hutang
 * pajak / bank) dan pembatalannya. Melihat `journals:view`; mencatat dan
 * membatalkan `journals:manage`. `?baru=1&jenis=&masa=&jumlah=` membuka
 * formulir terisi dari kalender pajak; `?id=` (dari jurnal) membuka tahun
 * setoran itu.
 */
export default async function SetoranPajakPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const akses = aksesPajak(session.user.permissions ?? []);
  if (!akses.bacaJurnal) redirect("/backoffice");

  const sp = await searchParams;
  const hariIni = hariIniWib();
  const id = satu(sp.id) ?? null;
  let tahun = /^\d{4}$/.test(satu(sp.tahun) ?? "") ? (satu(sp.tahun) as string) : hariIni.slice(0, 4);
  if (id) {
    const t = await prisma.taxPayment.findUnique({ where: { id }, select: { period: true } });
    if (t) tahun = t.period.slice(0, 4);
  }
  const jenis = bacaJenisSetoran(satu(sp.jenis));
  const isiAwal =
    satu(sp.baru) === "1"
      ? { jenis: jenis ?? "PPN", masa: bacaMasaPajak(satu(sp.masa)) ?? "", jumlah: /^\d+$/.test(satu(sp.jumlah) ?? "") ? (satu(sp.jumlah) as string) : "" }
      : null;

  let baris: BarisSetoran[] = [];
  let rekening: RekeningKasBank[] = [];
  let gagal = false;
  const [ppn, profil] = await Promise.all([bacaPengaturanPpn(), bacaProfilPajak()]);
  try {
    [baris, rekening] = await Promise.all([daftarSetoran({ tahun, jenis: isiAwal ? null : jenis }), akses.kelola ? rekeningKasBank() : Promise.resolve([])]);
  } catch (e) {
    console.error("[setoran-pajak] gagal", e);
    gagal = true;
  }
  return (
    <SetoranPajakClient
      tahun={Number(tahun)}
      jenis={isiAwal ? null : jenis}
      sorot={id}
      baris={baris}
      rekening={rekening}
      isiAwal={isiAwal}
      hariIni={hariIni}
      statusPkp={ppn.statusPkp}
      rezimPph={profil.rezimPph}
      akses={akses}
      gagal={gagal}
    />
  );
}

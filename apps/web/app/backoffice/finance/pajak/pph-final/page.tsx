import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaPengaturanPpn } from "@/lib/finance/pajak/ppn-pengaturan";
import { bacaProfilPajak } from "@/lib/finance/pajak/profil-pengaturan";
import { pakaiPphFinalUmkm } from "@/lib/finance/pajak/profil";
import { hitungPphFinalMasa, type PphFinalMasa } from "@/lib/finance/pajak/pph-final-writer";
import { aksesPajak } from "../_bersama/akses";
import { PphFinalClient } from "./PphFinalClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ tahun?: string | string[] }> };

/**
 * Keuangan → Pajak → PPh final: PPh final UMKM 0,5% per masa dari omzet buku
 * besar (aktif hanya bila profil pajak memilih rezim PPh final UMKM).
 * Melihat `journals:view`; memposting `journals:manage`.
 */
export default async function PphFinalPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const akses = aksesPajak(session.user.permissions ?? []);
  if (!akses.bacaJurnal) redirect("/backoffice");

  const sp = await searchParams;
  const hariIni = hariIniWib();
  const masaIni = hariIni.slice(0, 7);
  const teks = Array.isArray(sp.tahun) ? sp.tahun[0] : sp.tahun;
  const tahun = /^\d{4}$/.test(teks ?? "") ? Number(teks) : Number(masaIni.slice(0, 4));
  const [ppn, profil] = await Promise.all([bacaPengaturanPpn(), bacaProfilPajak()]);
  const aktif = pakaiPphFinalUmkm(profil);

  let daftar: PphFinalMasa[] = [];
  let gagal = false;
  if (aktif) {
    try {
      const masa = Array.from({ length: 12 }, (_, i) => `${tahun}-${String(i + 1).padStart(2, "0")}`).filter((m) => m <= masaIni);
      daftar = (await Promise.all(masa.map((m) => hitungPphFinalMasa(m)))).reverse();
    } catch (e) {
      console.error("[pph-final] gagal", e);
      gagal = true;
    }
  }
  return (
    <PphFinalClient
      tahun={tahun}
      masaIni={masaIni}
      aktif={aktif}
      bentukUsaha={profil.bentukUsaha}
      daftar={daftar}
      statusPkp={ppn.statusPkp}
      rezimPph={profil.rezimPph}
      akses={akses}
      gagal={gagal}
    />
  );
}

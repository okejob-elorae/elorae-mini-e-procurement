import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { parseDateOnly } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { geserMasaPajak, hariTerakhirMasa } from "@/lib/finance/pajak/masa";
import { rapikanNpwp } from "@/lib/finance/pajak/identitas";
import { bacaIdentitasPajak } from "@/lib/finance/pajak/identitas-pengaturan";
import { bacaPengaturanPpn } from "@/lib/finance/pajak/ppn-pengaturan";
import { bacaProfilPajak } from "@/lib/finance/pajak/profil-pengaturan";
import { notaUntukEkspor, type BarisEkspor, type SertakanFaktur } from "@/lib/finance/pajak/coretax-queries";
import { aksesPajak } from "../_bersama/akses";
import { FakturKeluaranClient } from "./FakturKeluaranClient";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;
type PageProps = { searchParams: Promise<{ dari?: Param; sampai?: Param; sertakan?: Param }> };

const satu = (v: Param) => (Array.isArray(v) ? v[0] : v);
const POLA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Keuangan → Pajak → Faktur keluaran: nota tagihan putus dalam rentang
 * tanggal faktur, dihitung DPP / DPP nilai lain / PPN-nya, lalu diunduh
 * sebagai XML impor Coretax. Pembaca faktur pajak (`tax_invoices:view`).
 * Bawaan: bulan lalu, hanya nota yang masih menunggu faktur.
 */
export default async function FakturKeluaranPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const akses = aksesPajak(session.user.permissions ?? []);
  if (!akses.faktur) redirect("/backoffice");

  const sp = await searchParams;
  const hariIni = hariIniWib();
  const bulanLalu = geserMasaPajak(hariIni.slice(0, 7), -1);
  let dari = POLA.test(satu(sp.dari) ?? "") ? (satu(sp.dari) as string) : `${bulanLalu}-01`;
  let sampai = POLA.test(satu(sp.sampai) ?? "") ? (satu(sp.sampai) as string) : hariTerakhirMasa(bulanLalu);
  if (sampai < dari) [dari, sampai] = [sampai, dari];
  const sertakan: SertakanFaktur = satu(sp.sertakan) === "SEMUA" ? "SEMUA" : "MENUNGGU";

  const [ppn, profil, identitas] = await Promise.all([bacaPengaturanPpn(), bacaProfilPajak(), bacaIdentitasPajak()]);
  let baris: BarisEkspor[] = [];
  let terpotong = false;
  let gagal = false;
  try {
    const r = await notaUntukEkspor({
      mulai: parseDateOnly(dari) as Date,
      sampai: new Date((parseDateOnly(sampai) as Date).getTime() + 86_400_000),
      sertakan,
      pengaturan: ppn,
    });
    baris = r.baris;
    terpotong = r.terpotong;
  } catch (e) {
    console.error("[faktur-keluaran] gagal", e);
    gagal = true;
  }
  return (
    <FakturKeluaranClient
      dari={dari}
      sampai={sampai}
      sertakan={sertakan}
      baris={baris}
      terpotong={terpotong}
      adaNpwp={rapikanNpwp(identitas.npwp) != null}
      statusPkp={ppn.statusPkp}
      rezimPph={profil.rezimPph}
      akses={akses}
      gagal={gagal}
    />
  );
}

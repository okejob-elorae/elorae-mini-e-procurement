import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaKategoriAset } from "@/lib/finance/aset/kelompok";
import { bacaSaringanStatusAset, daftarAset, hitungPenyusutanTertunda, type BarisAset, type RingkasanAset } from "@/lib/finance/aset/queries";
import { AsetTetapClient } from "./AsetTetapClient";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;
type PageProps = { searchParams: Promise<{ status?: Param; kategori?: Param; cari?: Param; halaman?: Param }> };

const satu = (v: Param) => (Array.isArray(v) ? v[0] : v);
const UKURAN = 25;

/**
 * Keuangan → Aset tetap: daftar aset (kelompok fiskal, nilai buku), ringkasan
 * atas seluruh hasil saringan, dan posting penyusutan bulanan. Melihat
 * `journals:view`; mencatat dan memposting `journals:manage`.
 */
export default async function AsetTetapPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const status = bacaSaringanStatusAset(satu(sp.status));
  const kategori = bacaKategoriAset(satu(sp.kategori));
  const cari = satu(sp.cari)?.trim() || null;
  const halaman = Math.max(1, Number.parseInt(satu(sp.halaman) ?? "1", 10) || 1);
  const bulanIni = hariIniWib().slice(0, 7);

  let baris: BarisAset[] = [];
  let total = 0;
  let ringkasan: RingkasanAset = { jumlah: 0, biaya: 0, akumulasi: 0, nilaiBuku: 0 };
  let tertunda = 0;
  let gagal = false;
  try {
    const [d, t] = await Promise.all([
      daftarAset({ status, kategori, cari, halaman, ukuran: UKURAN }),
      hitungPenyusutanTertunda({ tahun: Number(bulanIni.slice(0, 4)), bulan: Number(bulanIni.slice(5, 7)) }),
    ]);
    baris = d.baris;
    total = d.total;
    ringkasan = d.ringkasan;
    tertunda = t;
  } catch (e) {
    console.error("[aset-tetap] gagal memuat", e);
    gagal = true;
  }

  return (
    <AsetTetapClient
      baris={baris}
      total={total}
      ringkasan={ringkasan}
      halaman={halaman}
      ukuran={UKURAN}
      saringan={{ status, kategori: kategori ?? "", cari: cari ?? "" }}
      bulanIni={bulanIni}
      penyusutanTertunda={tertunda}
      bolehMengelola={hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE)}
      gagal={gagal}
    />
  );
}

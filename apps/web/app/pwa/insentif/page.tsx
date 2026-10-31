import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { bacaBulan, daftarBulanTerakhir } from "@/lib/salesman/komisi";
import { insentifHp } from "@/lib/salesman/penjualan-hp-queries";
import { InsentifClient } from "./InsentifClient";

export const dynamic = "force-dynamic";

/** Bulan yang bisa dipilih: bulan ini dan lima sebelumnya. */
const JUMLAH_BULAN = 6;

/**
 * Insentif saya — perkiraan komisi salesman per bulan, dengan dasar, tarif,
 * capaian target, dan rincian uang tertagih yang membentuknya.
 *
 * Hanya milik salesman yang login. SPG punya gaji & komisinya sendiri di
 * beranda SPG, jadi dikembalikan ke sana.
 *
 * Aturan mutlak: rupiah konsinyasi tidak pernah sampai ke HP. `insentifHp`
 * menghitung perkiraan atas putus + van (komisi resmi yang memuat konsi bisa
 * dihitung mundur jadi omzet konsi) dan mengirim konsinyasi hanya sebagai pcs.
 * Perhitungan resmi kantor tidak berubah.
 */
export default async function InsentifPage({
  searchParams,
}: {
  searchParams: Promise<{ bulan?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");

  const hariIni = new Date();
  const pilihan = daftarBulanTerakhir(hariIni, JUMLAH_BULAN);
  const bulan = bacaBulan((await searchParams).bulan, pilihan);
  // Tanggal verifikasi diformat di server (di dalam insentifHp).
  const r = await insentifHp(session.user.id, bulan, { hariIni });

  return (
    <InsentifClient
      data={{
        // Nama bulan dirakit klien dari pesan i18n (bukan Intl), jadi aman dari
        // beda format Node vs Safari.
        bulan: pilihan.map((k) => ({ kunci: k, href: `/pwa/insentif?bulan=${k}` })),
        bulanDipilih: bulan,
        bulanBerjalan: bulan === pilihan[0],
        ...r,
      }}
    />
  );
}

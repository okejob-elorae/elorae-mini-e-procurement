import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/date-only";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { bacaBulan, daftarBulanTerakhir } from "@/lib/salesman/komisi";
import { komisiSalesman } from "@/lib/salesman/komisi-queries";
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

  const pilihan = daftarBulanTerakhir(new Date(), JUMLAH_BULAN);
  const bulan = bacaBulan((await searchParams).bulan, pilihan);
  const r = await komisiSalesman(session.user.id, bulan);

  return (
    <InsentifClient
      data={{
        // Nama bulan dirakit klien dari pesan i18n (bukan Intl), jadi aman dari
        // beda format Node vs Safari. Tanggal verifikasi diformat di server.
        bulan: pilihan.map((k) => ({ kunci: k, href: `/pwa/insentif?bulan=${k}` })),
        bulanDipilih: bulan,
        bulanBerjalan: bulan === pilihan[0],
        aktif: r.skema.aktif,
        dasar: r.hasil.dasar,
        komisi: r.hasil.komisi,
        dasarNilai: r.hasil.dasarNilai,
        tarifDasar: r.hasil.tarifDasar,
        tarifDipakai: r.hasil.tarifDipakai,
        capaianPersen: r.hasil.capaianPersen,
        target: r.target,
        omzet: r.omzet,
        tingkat: r.hasil.tingkat,
        tingkatBerikut: r.hasil.tingkatBerikut,
        bagianPenagihPersen: r.skema.bagianPenagihPersen,
        tertagih: r.tertagih,
        baris: r.baris.map((b) => ({
          kunci: `${b.claimId}:${b.receivableId}`,
          docNo: b.docNo,
          toko: b.toko,
          invoiceNo: b.invoiceNo,
          tanggal: formatDisplayDate(b.verifiedAt),
          nilai: b.nilai,
          dilunasi: b.dilunasi,
          peran: b.peran,
          bagian: b.bagian,
        })),
      }}
    />
  );
}

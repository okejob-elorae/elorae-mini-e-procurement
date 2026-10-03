import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { bolehMelihatAbsensi } from "@/lib/salesman/absensi";
import { absensiBulan, absensiHari, labelHariPanjang } from "@/lib/salesman/absensi-queries";
import { bacaBulan, daftarBulanTerakhir, labelBulan } from "@/lib/salesman/biaya";
import { AbsensiClient } from "./AbsensiClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ tampilan?: string; tanggal?: string; bulan?: string }>;
};

const HARI_MS = 86_400_000;

/** Geser "YYYY-MM-DD" sejumlah hari (kalender, tanpa zona). */
function geserHari(dayKey: string, n: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + n * HARI_MS).toISOString().slice(0, 10);
}

/**
 * Absensi salesman — kantor. Per hari: siapa sudah/belum absen, jam, terlambat,
 * swafoto, tautan peta. Per bulan: rekap per orang + unduh Excel.
 */
export default async function AbsensiPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!bolehMelihatAbsensi(session.user.permissions)) redirect("/backoffice");

  const sp = await searchParams;
  const sekarang = new Date();
  const hariIni = kunciHariWib(sekarang);
  const tampilan = sp.tampilan === "bulan" ? "bulan" : "hari";
  const tanggalSah =
    typeof sp.tanggal === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.tanggal) && !Number.isNaN(Date.parse(sp.tanggal));
  // Hari depan belum terjadi — alamat yang menunjuk ke sana dibawa ke hari ini.
  const tanggal = tanggalSah && (sp.tanggal as string) <= hariIni ? (sp.tanggal as string) : hariIni;
  const bulan = tampilan === "bulan" ? bacaBulan(sp.bulan, sekarang) : tanggal.slice(0, 7);

  const pilihan = daftarBulanTerakhir(12, sekarang);
  if (!pilihan.includes(bulan)) pilihan.push(bulan);

  if (tampilan === "bulan") {
    const data = await absensiBulan(bulan);
    return (
      <AbsensiClient
        tampilan="bulan"
        tanggal={tanggal}
        hariIni={hariIni}
        bulan={bulan}
        pilihanBulan={pilihan.map((b) => ({ kunci: b, label: labelBulan(b) }))}
        pengaturan={data.pengaturan}
        rekap={data.rekap}
      />
    );
  }

  const data = await absensiHari(tanggal);
  return (
    <AbsensiClient
      tampilan="hari"
      tanggal={tanggal}
      hariIni={hariIni}
      labelTanggal={labelHariPanjang(tanggal)}
      sebelum={geserHari(tanggal, -1)}
      sesudah={tanggal < hariIni ? geserHari(tanggal, 1) : null}
      bulan={bulan}
      pilihanBulan={pilihan.map((b) => ({ kunci: b, label: labelBulan(b) }))}
      pengaturan={data.pengaturan}
      baris={data.baris}
    />
  );
}

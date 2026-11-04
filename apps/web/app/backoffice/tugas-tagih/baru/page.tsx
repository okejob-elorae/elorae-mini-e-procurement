import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { bolehMengelola } from "@/lib/receivables/izin";
import { bahanTugasBaru } from "@/lib/receivables/tugas-tagih-queries";
import { formatDisplayDate } from "@/lib/date-only";
import { tambahHari, hariWib } from "@/lib/receivables/giro";
import { TugasBaruClient, type BahanTugasTampil } from "./TugasBaruClient";

export const dynamic = "force-dynamic";

/** Tenggat bawaan: sepekan — cukup untuk satu putaran kunjungan. */
const TENGGAT_BAWAAN_HARI = 7;

export default async function TugasTagihBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ toko?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!bolehMengelola(session.user.permissions)) redirect("/backoffice/tugas-tagih");

  const [{ toko }, bahan] = await Promise.all([searchParams, bahanTugasBaru()]);
  const hariIni = hariWib(new Date());

  const tampil: BahanTugasTampil = {
    toko: bahan.toko,
    petugas: bahan.petugas,
    fakturPerToko: Object.fromEntries(
      Object.entries(bahan.fakturPerToko).map(([storeId, faktur]) => [
        storeId,
        faktur.map((f) => ({ ...f, jatuhTempoTeks: formatDisplayDate(f.dueDate) })),
      ]),
    ),
  };

  return (
    <TugasBaruClient
      bahan={tampil}
      tokoAwal={toko && bahan.fakturPerToko[toko] ? toko : ""}
      hariIni={hariIni}
      tenggatAwal={tambahHari(hariIni, TENGGAT_BAWAAN_HARI) ?? hariIni}
    />
  );
}

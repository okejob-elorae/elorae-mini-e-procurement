import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  bolehMembayarKomisiSpg,
  bolehMembukaKonsi,
  bolehMemverifikasi,
  bolehMencatatNomorKonsi,
  bolehMengelolaKonsi,
  bolehMengunciKonsi,
} from "@/lib/receivables/izin";
import { rincianSiklus } from "@/lib/konsinyasi/queries";
import { katalogBarang } from "@/lib/receivables/return-queries";
import { RincianSiklusClient } from "./RincianSiklusClient";

export const dynamic = "force-dynamic";

export default async function RincianSiklusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  if (!bolehMembukaKonsi(session.user.permissions)) redirect("/backoffice");

  const { id } = await params;
  const izin = session.user.permissions;
  // Setiap tombol memakai izin yang SAMA dengan aksi servernya (app/actions/konsinyasi.ts):
  // laporan = consignment:manage, kunci/buka kunci = consignment:lock, nomor nota =
  // consignment:note_number, nomor faktur pajak = consignment:tax_number, gaji SPG =
  // spg_commission:pay. Pembayaran toko dicatat keuangan — izin memverifikasi BKM.
  const kelola = bolehMengelolaKonsi(izin);
  const kunci = bolehMengunciKonsi(izin);
  const [data, katalog] = await Promise.all([
    rincianSiklus(id),
    // Pilihan barang hanya dipakai dialog kunci angka.
    kunci ? katalogBarang() : Promise.resolve([]),
  ]);
  if (!data) notFound();

  return (
    <RincianSiklusClient
      data={data}
      katalog={katalog}
      bolehMengelola={kelola}
      bolehMengunci={kunci}
      bolehCatatNota={bolehMencatatNomorKonsi(izin, "NOTA")}
      bolehCatatPajak={bolehMencatatNomorKonsi(izin, "PAJAK")}
      bolehBayarGaji={bolehMembayarKomisiSpg(izin)}
      bolehCatatBayar={bolehMemverifikasi(izin)}
    />
  );
}

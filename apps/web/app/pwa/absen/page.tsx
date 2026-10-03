import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { bacaBulan, daftarBulanTerakhir, labelBulan } from "@/lib/salesman/biaya";
import { absenBeranda, riwayatAbsenSaya } from "@/lib/salesman/absensi-queries";
import { izinSaya } from "@/lib/salesman/izin-queries";
import { RiwayatAbsenClient } from "./RiwayatAbsenClient";

export const dynamic = "force-dynamic";

/**
 * Absen — kartu hari ini di atas, lalu izin/sakit/cuti (ajukan + ajuan saya),
 * lalu riwayat satu bulan (hari tanpa absen tetap tampil; hari yang izinnya
 * disetujui tampil sebagai Izin/Sakit/Cuti). Terlambat dinilai terhadap jam
 * masuk yang berlaku. Dipakai salesman dan SPG — SPG tidak menekan tombol
 * absen: check-in di toko tetapnya adalah absen masuknya (`KartuAbsenSpg`).
 */
export default async function AbsenPage({ searchParams }: { searchParams: Promise<{ bulan?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  const sekarang = new Date();
  const bulan = bacaBulan((await searchParams).bulan, sekarang);
  const [kartu, riwayat, izin, tokoTetap] = await Promise.all([
    absenBeranda(session.user.id, sekarang),
    riwayatAbsenSaya(session.user.id, bulan, sekarang),
    izinSaya(session.user.id, sekarang),
    ambilTokoTetap(session.user.id),
  ]);
  const toko = tokoTetap
    ? await prisma.store.findUnique({ where: { id: tokoTetap }, select: { id: true, name: true } })
    : null;
  const pilihan = daftarBulanTerakhir(12, sekarang);
  if (!pilihan.includes(bulan)) pilihan.push(bulan);

  return (
    <RiwayatAbsenClient
      kartu={kartu}
      aktif={riwayat.pengaturan.aktif}
      jamMasukPaling={riwayat.pengaturan.jamMasukPaling}
      bulan={bulan}
      pilihanBulan={pilihan.map((b) => ({ kunci: b, label: labelBulan(b) }))}
      hari={riwayat.hari}
      ringkasan={riwayat.ringkasan}
      ringkasanIzin={riwayat.izin}
      izin={izin}
      kuotaCutiTahunan={riwayat.pengaturan.kuotaCutiTahunan}
      tokoSpg={toko ? { id: toko.id, nama: toko.name } : null}
    />
  );
}

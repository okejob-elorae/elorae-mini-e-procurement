import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaAmbangKreatif } from "@/lib/creative/pengaturan";
import { dataPanelTermin } from "@/lib/creative/termin-queries";
import { PanelBayarKlien } from "./PanelBayarKlien";

/**
 * Panel pembayaran di rincian kolaborasi — komponen SERVER. Termin (bruto,
 * PPh, neto, jatuh tempo), mode pajak, dan riwayat dari jejak. Keuangan
 * (`journals:manage`) juga melihat jurnal yang tertunda dan tombol posting
 * ulangnya.
 */
export async function PanelBayar({ kolaborasiId, bolehMengelola }: { kolaborasiId: string; bolehMengelola: boolean }) {
  const hariIni = hariIniWib();
  const session = await auth();
  const izin = session?.user?.permissions ?? [];
  const keuangan = hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE);
  const [data, ambang] = await Promise.all([dataPanelTermin(kolaborasiId, { hariIni, denganJurnal: keuangan }), bacaAmbangKreatif()]);
  return (
    <PanelBayarKlien
      data={data}
      hariIni={hariIni}
      bolehMengelola={bolehMengelola || keuangan}
      keuangan={keuangan}
      jatuhTempoBawaan={ambang.jatuhTempoBayarHari}
    />
  );
}

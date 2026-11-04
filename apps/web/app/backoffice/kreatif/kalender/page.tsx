import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { kalenderKreatif, opsiAgenda, type OpsiAgenda } from "@/lib/creative/agenda-queries";
import { ringkasLanggananKalender } from "@/lib/creative/kalender-langganan-queries";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaParamKalender, rentangKisi } from "./kalender";
import { KalenderKreatifClient } from "./KalenderKreatifClient";
import { KartuLanggananKalender } from "./KartuLanggananKalender";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const OPSI_KOSONG: OpsiAgenda = { campaign: [], kolaborasi: [], kol: [] };

/**
 * Kalender Ruang KOL. Bulan dibaca dari `?bulan=` (pindah bulan memuat ulang
 * dari server); tanggal yang dipilih (`?tanggal=`) dan preset (`?jenis=`)
 * diganti di klien tanpa membaca ulang. `?agenda=<id>` membuka agenda itu
 * langsung — tautan dari baris agenda di Hari ini.
 */
export default async function KalenderPage({ searchParams }: PageProps) {
  const session = await auth();
  const izin = session?.user.permissions ?? [];
  if (!session?.user?.id || !hasPermission(izin, PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");
  const bolehMengelola = hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE);

  const hariIni = hariIniWib();
  const param = bacaParamKalender(await searchParams, hariIni);
  const rentang = rentangKisi(param.bulan) ?? { dari: `${param.bulan}-01`, sampai: `${param.bulan}-28` };
  const [data, opsi, langganan] = await Promise.all([
    kalenderKreatif({ dari: rentang.dari, sampai: rentang.sampai, userId: session.user.id, hariIni }),
    bolehMengelola ? opsiAgenda() : Promise.resolve(OPSI_KOSONG),
    ringkasLanggananKalender(session.user.id),
  ]);

  // Tanpa pembungkus: tata letak Kreatif sudah memberi jarak antaranak (`space-y-6`).
  return (
    <>
      <KalenderKreatifClient
        key={param.bulan}
        param={param}
        data={data}
        hariIni={hariIni}
        opsi={opsi}
        userId={session.user.id}
        bolehMengelola={bolehMengelola}
      />
      <KartuLanggananKalender
        aktif={
          langganan.aktif
            ? { sejak: langganan.aktif.sejak.toISOString(), terakhirDibaca: langganan.aktif.terakhirDibaca?.toISOString() ?? null }
            : null
        }
      />
    </>
  );
}

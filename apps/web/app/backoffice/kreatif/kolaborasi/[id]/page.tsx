import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaAmbangKreatif } from "@/lib/creative/pengaturan";
import { pilihanCampaign } from "@/lib/creative/campaign-queries";
import { detailKolaborasi, pilihanPic } from "@/lib/creative/kolaborasi-queries";
import { PanelBayar } from "@/components/kreatif/PanelBayar";
import { PanelCatatan } from "@/components/kreatif/PanelCatatan";
import { PanelKontenKol } from "@/components/kreatif/PanelKontenKol";
import { PanelPenjualan } from "@/components/kreatif/PanelPenjualan";
import { PanelPengiriman } from "@/components/kreatif/PanelPengiriman";
import { KepalaKolaborasi } from "./KepalaKolaborasi";
import { TabBrief } from "./TabBrief";
import { bacaTabKolaborasi } from "./tab-kolaborasi";
import { TabKolaborasi } from "./TabKolaborasi";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

/**
 * Rincian satu kolaborasi: kepala (tahap, angka, tenggat, alamat) dan tab
 * Pengiriman · Konten · Penjualan · Pembayaran · Catatan & riwayat · Brief.
 * Panel tiap tab adalah komponen server milik layarnya masing-masing.
 */
export default async function DetailKolaborasiPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");
  const bolehMengelola = hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE);

  const { id } = await params;
  const sp = await searchParams;
  const hariIni = hariIniWib();
  const ambang = await bacaAmbangKreatif();
  const d = await detailKolaborasi(id, { hariIni, ambang });
  if (!d) notFound();
  const [campaigns, pics] = await Promise.all([pilihanCampaign(), pilihanPic()]);

  return (
    <div className="space-y-6">
      <KepalaKolaborasi d={d} hariIni={hariIni} campaigns={campaigns} pics={pics} bolehMengelola={bolehMengelola} />
      <TabKolaborasi
        awal={bacaTabKolaborasi(Array.isArray(sp.tab) ? sp.tab[0] : sp.tab)}
        jumlah={{ pengiriman: d.jumlah.pengiriman, konten: d.jumlah.konten, penjualan: d.jumlah.penjualan }}
        isi={{
          pengiriman: <PanelPengiriman kolaborasiId={d.id} bolehMengelola={bolehMengelola} />,
          konten: <PanelKontenKol kolaborasiId={d.id} bolehMengelola={bolehMengelola} />,
          penjualan: <PanelPenjualan kolaborasiId={d.id} bolehMengelola={bolehMengelola} />,
          pembayaran: <PanelBayar kolaborasiId={d.id} bolehMengelola={bolehMengelola} />,
          catatan: <PanelCatatan kolId={d.kol.id} kolaborasiId={d.id} bolehMengelola={bolehMengelola} />,
          brief: <TabBrief d={d} campaigns={campaigns} pics={pics} bolehMengelola={bolehMengelola} />,
        }}
      />
    </div>
  );
}

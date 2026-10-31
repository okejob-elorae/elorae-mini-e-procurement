import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaStatusCampaignKol } from "@/lib/creative/campaign-aturan";
import { daftarCampaign, ringkasanDaftarCampaign, type StatusCampaign } from "@/lib/creative/campaign-queries";
import { CampaignClient } from "./CampaignClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ status?: string | string[]; keadaan?: string | string[] }> };

function bacaStatus(v: string | string[] | undefined): StatusCampaign {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "aktif" || s === "arsip" ? s : "semua";
}

/** Daftar campaign KOL (`?status=aktif|arsip`, `?keadaan=DRAFT|BERJALAN|SELESAI|BATAL`). */
export default async function CampaignPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");
  const sp = await searchParams;
  const status = bacaStatus(sp.status);
  const keadaan = bacaStatusCampaignKol(sp.keadaan);
  const [{ baris, jumlah, jumlahStatus }, ringkasan] = await Promise.all([daftarCampaign({ status, keadaan }), ringkasanDaftarCampaign()]);
  return (
    <CampaignClient
      baris={baris}
      jumlah={jumlah}
      jumlahStatus={jumlahStatus}
      status={status}
      keadaan={keadaan}
      ringkasan={ringkasan}
      bolehMengelola={hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE)}
    />
  );
}

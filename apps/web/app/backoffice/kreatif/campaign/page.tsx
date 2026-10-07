import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarCampaign, type StatusCampaign } from "@/lib/creative/campaign-queries";
import { CampaignClient } from "./CampaignClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ status?: string | string[] }> };

function bacaStatus(v: string | string[] | undefined): StatusCampaign {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "aktif" || s === "arsip" ? s : "semua";
}

/** Daftar campaign KOL (`?status=aktif|arsip`). */
export default async function CampaignPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");
  const status = bacaStatus((await searchParams).status);
  const { baris, jumlah } = await daftarCampaign({ status });
  return (
    <CampaignClient
      baris={baris}
      jumlah={jumlah}
      status={status}
      bolehMengelola={hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE)}
    />
  );
}

import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { KartuPajakKol } from "@/components/kreatif/KartuPajakKol";
import { PanelCatatan } from "@/components/kreatif/PanelCatatan";
import { pilihanSaringKol, profilKol } from "@/lib/creative/kol-queries";
import { ProfilKolClient } from "./ProfilKolClient";

export const dynamic = "force-dynamic";

/** Profil satu KOL: ringkasan angka, kolaborasi, konten, ukuran & alamat, riwayat pengikut, catatan & riwayat. */
export default async function ProfilKolPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");
  const bolehMengelola = hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE);

  const { id } = await params;
  const [profil, pilihan] = await Promise.all([profilKol(id), bolehMengelola ? pilihanSaringKol() : Promise.resolve(null)]);
  if (!profil) notFound();

  return (
    <ProfilKolClient
      profil={profil}
      bolehMengelola={bolehMengelola}
      niche={pilihan?.niche ?? []}
      labelSaran={pilihan?.label ?? []}
      panelCatatan={<PanelCatatan kolId={id} bolehMengelola={bolehMengelola} />}
      kartuPajak={<KartuPajakKol kolId={id} />}
    />
  );
}

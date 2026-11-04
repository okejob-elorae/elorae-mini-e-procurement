import { redirect } from "next/navigation";
import { tujuanAkunProfil } from "../../tujuan";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

/** Akun Profil ditutup — akun diubah di Pengaturan → Pengguna (`../../page.tsx`). */
export default async function EditAccountPage({ params }: PageProps) {
  const { id } = await params;
  redirect(tujuanAkunProfil({ jenis: "ubah", id }));
}

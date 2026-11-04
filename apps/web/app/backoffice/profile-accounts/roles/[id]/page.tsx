import { redirect } from "next/navigation";
import { tujuanAkunProfil } from "../../tujuan";

export const dynamic = "force-dynamic";

/** Akun Profil ditutup — peran diubah di Pengaturan → Peran & izin (`../../page.tsx`). */
export default function RoleEditPage() {
  redirect(tujuanAkunProfil({ jenis: "peran" }));
}

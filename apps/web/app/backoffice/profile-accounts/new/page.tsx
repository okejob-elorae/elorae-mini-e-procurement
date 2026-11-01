import { redirect } from "next/navigation";
import { tujuanAkunProfil } from "../tujuan";

export const dynamic = "force-dynamic";

/** Akun Profil ditutup — akun baru dibuat di Pengaturan → Pengguna (`../page.tsx`). */
export default function NewAccountPage() {
  redirect(tujuanAkunProfil({ jenis: "baru" }));
}

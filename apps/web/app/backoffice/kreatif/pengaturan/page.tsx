import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaPengaturanKreatif } from "@/lib/creative/pengaturan";
import { bacaTarifPajakKreatif } from "@/lib/creative/pajak-pengaturan";
import { KartuPajakKreatif } from "./KartuPajakKreatif";
import { PengaturanKreatifClient } from "./PengaturanKreatifClient";

export const dynamic = "force-dynamic";

/**
 * Pengaturan Ruang KOL: ambang hari, identitas pesan, template WhatsApp, dan
 * tarif PPh fee KOL. Pembaca memakai bawaan di kode bila barisnya kosong, jadi
 * layar selalu menampilkan angka yang sedang BERLAKU. Pengelola
 * (`creative:manage`) mengubah; yang lain hanya melihat. Tarif pajak boleh
 * diubah pengelola Kreatif atau keuangan.
 */
export default async function PengaturanKreatifPage() {
  const session = await auth();
  const izin = session?.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");
  const [pengaturan, tarif] = await Promise.all([bacaPengaturanKreatif(), bacaTarifPajakKreatif()]);
  return (
    <div className="space-y-6">
      <PengaturanKreatifClient awal={pengaturan} bolehMengelola={hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE)} />
      <KartuPajakKreatif
        awal={tarif}
        bolehMengelola={hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE) || hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE)}
      />
    </div>
  );
}

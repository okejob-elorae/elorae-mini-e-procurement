import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { aturanKelasToko, daftarKelasToko, HARI_NILAI_KELAS } from "@/lib/stores/queries";
import { persenDariBatas } from "@/lib/stores/kelas-toko";
import { KelasTokoClient } from "./KelasTokoClient";

export const dynamic = "force-dynamic";

/**
 * Kelas toko: nilai beli 180 hari setiap toko aktif, kelasnya sekarang, dan
 * usulan kelas otomatis — admin memilih toko mana yang mengikuti usulan.
 * Melihat cukup `stores:view`; menerapkan butuh `stores:manage`.
 */
export default async function KelasTokoPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_VIEW)) redirect("/backoffice");

  const aturan = await aturanKelasToko();
  const baris = await daftarKelasToko(aturan);

  return (
    <KelasTokoClient
      baris={baris}
      hari={HARI_NILAI_KELAS}
      jarakHari={aturan.jarakHari}
      persen={persenDariBatas(aturan.otomatis)}
      otomatisAktif={aturan.otomatis.aktif}
      bolehKelola={hasPermission(perms, PERMISSIONS.STORES_MANAGE)}
      bolehAturJarak={hasPermission(perms, PERMISSIONS.FIELD_SALES_ORDERS_VIEW)}
    />
  );
}

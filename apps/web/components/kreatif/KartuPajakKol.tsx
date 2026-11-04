import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ringkasPajakKol } from "@/lib/creative/pajak-kol-queries";
import { KartuPajakKolKlien } from "./KartuPajakKolKlien";

/**
 * Kartu "Pajak & rekening" di profil KOL — komponen SERVER. Pengelola Kreatif
 * mengisi (tulis-saja); hanya keuangan yang bisa membuka isi lengkapnya
 * dengan PIN. Data yang dikirim ke layar selalu tersamar.
 */
export async function KartuPajakKol({ kolId }: { kolId: string }) {
  const session = await auth();
  const izin = session?.user?.permissions ?? [];
  const data = await ringkasPajakKol(kolId);
  if (!data) return null;
  return (
    <KartuPajakKolKlien
      data={data}
      bolehMengelola={hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE)}
      bolehBuka={hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE)}
    />
  );
}

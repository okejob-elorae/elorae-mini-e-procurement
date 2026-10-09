import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ringkasFormulirKol } from "@/lib/creative/formulir-kol-queries";
import { KartuFormulirKolKlien } from "./KartuFormulirKolKlien";

/**
 * Kartu "Link formulir data" di profil KOL — komponen SERVER. Pengelola Kreatif membuat link untuk
 * dikirim lewat WhatsApp; KOL mengisi sendiri alamat, ukuran, dan rekening; kiriman yang masuk
 * diperiksa di sini (kolom yang menimpa isian kantor bisa dikembalikan).
 */
export async function KartuFormulirKol({ kolId }: { kolId: string }) {
  const session = await auth();
  const izin = session?.user?.permissions ?? [];
  const data = await ringkasFormulirKol(kolId);
  return <KartuFormulirKolKlien kolId={kolId} data={data} bolehMengelola={hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE)} />;
}

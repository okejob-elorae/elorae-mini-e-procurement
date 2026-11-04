import { notFound } from "next/navigation";
import { bukaTautanPortal, capTautanDipakai } from "@/lib/field-sales/portal-toko";
import { katalogPortal } from "@/lib/field-sales/portal-writer";
import { PortalTokoShell } from "./PortalTokoShell";

export const dynamic = "force-dynamic";

/**
 * Portal pesan mandiri toko: katalog → keranjang → tinjau → kirim. Tanpa masuk;
 * tautannya sendiri adalah kuncinya, dan dibuka ulang di setiap permintaan.
 * Tautan yang tidak berlaku → 404 (`not-found.tsx`), tanpa keterangan toko.
 */
export default async function PortalTokoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const buka = await bukaTautanPortal(token);
  if (!buka.ok) notFound();
  const katalog = await katalogPortal(buka.akses);
  if (!katalog) notFound();
  await capTautanDipakai(buka.akses.linkId);
  return <PortalTokoShell token={token} katalog={katalog} />;
}

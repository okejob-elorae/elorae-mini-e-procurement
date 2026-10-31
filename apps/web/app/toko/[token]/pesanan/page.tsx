import { notFound } from "next/navigation";
import { bukaTautanPortal, capTautanDipakai } from "@/lib/field-sales/portal-toko";
import { pesananTokoPortal } from "@/lib/field-sales/portal-writer";
import { PesananTokoClient } from "./PesananTokoClient";

export const dynamic = "force-dynamic";

/** "Pesanan saya" untuk toko: pesanan terbaru toko ini, dari portal maupun dari salesman. */
export default async function PesananTokoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const buka = await bukaTautanPortal(token);
  if (!buka.ok) notFound();
  const pesanan = await pesananTokoPortal(buka.akses);
  await capTautanDipakai(buka.akses.linkId);
  return (
    <PesananTokoClient
      token={token}
      namaToko={buka.akses.toko.name}
      konsi={buka.akses.toko.termsType === "KONSI"}
      pesanan={pesanan}
    />
  );
}

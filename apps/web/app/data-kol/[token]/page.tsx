import { notFound } from "next/navigation";
import { bukaLinkFormulirKol, catatLinkDibuka, dataFormulirPublik } from "@/lib/creative/formulir-kol-writer";
import { bacaIdentitasKreatif } from "@/lib/creative/pengaturan";
import { FormulirDataKolClient } from "./FormulirDataKolClient";

export const dynamic = "force-dynamic";

/**
 * Formulir data KOL. Tanpa masuk; link-nya sendiri adalah kuncinya dan dibuka ulang di setiap
 * permintaan. Link tidak berlaku → 404 (`not-found.tsx`) tanpa keterangan apa pun tentang KOL-nya.
 */
export default async function FormulirDataKolPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const akses = await bukaLinkFormulirKol(token);
  if (!akses) notFound();
  const [data, identitas] = await Promise.all([dataFormulirPublik(akses), bacaIdentitasKreatif()]);
  if (!data) notFound();
  await catatLinkDibuka(akses.linkId);
  return <FormulirDataKolClient token={token} data={data} brand={identitas.brand} />;
}

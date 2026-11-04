import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { bolehMembacaArsip } from "@/lib/receivables/izin";
import { folderArsip, isiArsip } from "@/lib/receivables/return-queries";
import { ArsipClient } from "./ArsipClient";

export const dynamic = "force-dynamic";

export default async function ArsipReturPage({
  searchParams,
}: {
  searchParams: Promise<{ toko?: string; v?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  /*
   * Arsip ini berisi foto nota retur toko — dokumen keuangan milik toko dan
   * sales. Sebelum ini halamannya hanya menuntut sudah masuk, jadi seluruh isi
   * kantor bisa membukanya.
   */
  if (!bolehMembacaArsip(session.user.permissions)) redirect("/backoffice");

  const { toko, v } = await searchParams;
  // "yatim" adalah folder tanpa nota toko; ia tidak punya id toko.
  const dibuka = toko === undefined ? undefined : toko === "yatim" ? null : toko;

  const [folder, isi] = await Promise.all([
    folderArsip(),
    dibuka === undefined ? Promise.resolve([]) : isiArsip(dibuka),
  ]);

  return (
    <ArsipClient
      folder={folder}
      isi={isi}
      dibuka={dibuka}
      tampilan={v === "daftar" ? "daftar" : "ikon"}
    />
  );
}

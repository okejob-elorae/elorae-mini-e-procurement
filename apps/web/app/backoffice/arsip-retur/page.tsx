import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
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

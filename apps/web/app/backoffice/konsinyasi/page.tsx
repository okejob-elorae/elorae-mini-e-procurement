import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { bolehMembukaKonsi, bolehMengelolaKonsi } from "@/lib/receivables/izin";
import { daftarSiklus, tokoKonsi } from "@/lib/konsinyasi/queries";
import { katalogBarang } from "@/lib/receivables/return-queries";
import { KonsinyasiClient } from "./KonsinyasiClient";

export const dynamic = "force-dynamic";

export default async function KonsinyasiPage() {
  const session = await auth();
  if (!session) redirect("/login");

  if (!bolehMembukaKonsi(session.user.permissions)) redirect("/backoffice");

  const kelola = bolehMengelolaKonsi(session.user.permissions);
  const [baris, toko, katalog] = await Promise.all([
    daftarSiklus(),
    kelola ? tokoKonsi() : Promise.resolve([]),
    kelola ? katalogBarang() : Promise.resolve([]),
  ]);

  return (
    <KonsinyasiClient baris={baris} toko={toko} katalog={katalog} bolehMengelola={kelola} />
  );
}

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { bolehMengelola } from "@/lib/receivables/izin";
import { daftarJenisPotongan } from "@/lib/receivables/deduction-types";
import { JenisPotonganClient } from "./JenisPotonganClient";

export const dynamic = "force-dynamic";

export default async function JenisPotonganPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!bolehMengelola(session.user.permissions)) redirect("/backoffice/settings");

  return <JenisPotonganClient baris={await daftarJenisPotongan()} />;
}

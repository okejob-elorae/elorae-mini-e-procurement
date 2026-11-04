import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hasilEfektivitasPromo } from "@/lib/spg/efektivitas-promo-queries";
import { hariSah } from "@/lib/spg/promo-konter-kantor";
import { HasilEfektivitasClient } from "./HasilEfektivitasClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dari?: string; sampai?: string }>;
};

/**
 * Hasil satu promo konter. Tanpa `?dari=&sampai=` = seluruh masa promo; dengan
 * rentang (dari tab Efektivitas) = masa promo dipotong rentang itu, supaya
 * angkanya sama dengan baris di daftar. Izinnya sama dengan halaman promo konter.
 */
export default async function HasilEfektivitasPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.PROMOS_VIEW)) redirect("/backoffice");

  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ada = sp.dari && sp.sampai && hariSah(sp.dari) && hariSah(sp.sampai);
  // Rentang terbalik dari alamat yang diketik tangan dibalik, bukan dibuang.
  const [awal, akhir] = ada ? (sp.dari! <= sp.sampai! ? [sp.dari!, sp.sampai!] : [sp.sampai!, sp.dari!]) : [null, null];
  const rentang = awal && akhir ? { dari: parseDateOnly(awal) ?? null, sampai: parseDateOnlyEnd(akhir) ?? null } : null;

  const data = await hasilEfektivitasPromo(id, { rentang });
  if (!data) notFound();

  return <HasilEfektivitasClient data={data} dari={awal} sampai={akhir} />;
}

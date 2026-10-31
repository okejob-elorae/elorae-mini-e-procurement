import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { pengumumanHp } from "@/lib/pengumuman/queries";
import { RincianPengumumanHp } from "./RincianPengumumanHp";

export const dynamic = "force-dynamic";

/**
 * Satu pengumuman. Membukanya = membacanya (ditandai dari klien sesudah tampil,
 * bukan saat render — prefetch tautan tidak boleh menandai apa pun). Pengumuman
 * untuk peran lain 404; yang diarsipkan/belum terbit menampilkan keterangan.
 */
export default async function PengumumanHpRincianPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  const { id } = await params;
  const data = await pengumumanHp(id, session.user.id);
  if (!data) notFound();
  return <RincianPengumumanHp data={data} />;
}

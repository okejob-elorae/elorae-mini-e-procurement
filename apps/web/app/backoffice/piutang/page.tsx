import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarPiutang, ringkasPiutang } from "@/lib/receivables/queries";
import { katalogBarang, tokoUntukRetur } from "@/lib/receivables/return-queries";
import type { KeadaanPiutang } from "@/lib/receivables/rules";
import { PiutangClient } from "./PiutangClient";

export const dynamic = "force-dynamic";

const KEADAAN: readonly KeadaanPiutang[] = ["lunas", "klaim", "tertahan", "lewat", "tt", "belum"];

/**
 * `?keadaan=lewat` dari tautan beranda ("Lewat janji bayar"). Sebelumnya
 * saringannya hanya hidup di state komponen, jadi tautan apa pun ke halaman ini
 * mendarat di daftar penuh.
 */
function bacaKeadaan(raw: string | undefined): KeadaanPiutang | null {
  return raw && (KEADAAN as readonly string[]).includes(raw) ? (raw as KeadaanPiutang) : null;
}

export default async function PiutangPage({
  searchParams,
}: {
  searchParams: Promise<{ keadaan?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  const saringAwal = bacaKeadaan((await searchParams).keadaan);

  const bolehMengelola = hasPermission(
    session.user.permissions ?? [],
    PERMISSIONS.RECEIVABLES_MANAGE,
  );
  // Toko dan katalog hanya dibutuhkan oleh formulir faktur manual; tidak
  // diambil sama sekali untuk yang tidak boleh membukanya.
  const [baris, toko, katalog] = await Promise.all([
    daftarPiutang(),
    bolehMengelola ? tokoUntukRetur() : Promise.resolve([]),
    bolehMengelola ? katalogBarang() : Promise.resolve([]),
  ]);

  return (
    <PiutangClient
      // Dipasang ulang saat `?keadaan=` berubah lewat navigasi — state awal
      // saringan hanya dibaca sekali saat dipasang.
      key={saringAwal ?? "semua"}
      baris={baris}
      ringkasan={ringkasPiutang(baris)}
      toko={toko}
      katalog={katalog}
      bolehMengelola={bolehMengelola}
      saringAwal={saringAwal}
    />
  );
}

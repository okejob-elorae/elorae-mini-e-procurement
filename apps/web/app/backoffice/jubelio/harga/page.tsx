import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { formatDisplayDateTime } from "@/lib/date-only";
import { daftarHargaMenunggu, hitungBarangJubelioTanpaHarga } from "@/lib/jubelio/harga/queries";
import type { JenisMenunggu } from "@/lib/jubelio/harga/aturan";
import { HargaJubelioClient, type BarisHargaTampil } from "./HargaJubelioClient";

export const dynamic = "force-dynamic";

/**
 * Jubelio → Konfirmasi harga (keputusan pemilik 2026-11-02). Harga jual baru dan produk baru
 * menunggu di sini sampai dikonfirmasi; Jubelio tetap memakai harga yang terakhir dikonfirmasi.
 * Halaman, tombolnya, aksinya, dan baris Beranda memakai izin yang sama: `jubelio_prices:confirm`.
 *
 * Tanggal diformat di sini, bukan di klien: format tanggal Node dan Safari bisa berbeda dan memicu
 * hydration error.
 */
export default async function HargaJubelioPage({
  searchParams,
}: {
  searchParams: Promise<{ jenis?: string; cari?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.JUBELIO_PRICES_CONFIRM)) redirect("/backoffice");

  const sp = await searchParams;
  const jenis: JenisMenunggu | null = sp.jenis === "BARU" || sp.jenis === "UBAH" ? sp.jenis : null;
  const cari = (sp.cari ?? "").trim().slice(0, 100);

  const [daftar, tanpaHarga] = await Promise.all([
    daftarHargaMenunggu({ jenis: jenis ?? undefined, cari: cari || undefined }),
    hitungBarangJubelioTanpaHarga(),
  ]);

  const baris: BarisHargaTampil[] = daftar.baris.map((b) => ({
    ...b,
    diubahPadaTampil: b.diubahPada ? formatDisplayDateTime(b.diubahPada) : null,
  }));

  return (
    <HargaJubelioClient
      baris={baris}
      total={daftar.total}
      terpotong={daftar.terpotong}
      jenis={jenis}
      cari={cari}
      tanpaHarga={tanpaHarga}
    />
  );
}

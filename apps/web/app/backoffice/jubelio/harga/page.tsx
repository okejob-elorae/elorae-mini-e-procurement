import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { formatDisplayDateTime } from "@/lib/date-only";
import {
  daftarHargaBedaDiJubelio,
  daftarHargaMenunggu,
  hitungBarangJubelioTanpaHarga,
  hitungHargaBedaDiJubelio,
} from "@/lib/jubelio/harga/queries";
import { bacaJenisTampil } from "@/lib/jubelio/harga/aturan";
import { HargaJubelioClient, type BarisHargaTampil } from "./HargaJubelioClient";
import type { BarisHargaBedaTampil } from "./TabelBedaJubelio";

export const dynamic = "force-dynamic";

/**
 * Jubelio → Konfirmasi harga (keputusan pemilik 2026-11-02). Harga jual baru dan produk baru
 * menunggu di sini sampai dikonfirmasi; Jubelio tetap memakai harga yang terakhir dikonfirmasi.
 * `?jenis=BEDA` menampilkan barang yang harganya di Jubelio berbeda dengan ERP (jawaban pemilik
 * P2/P74/P75), dengan satu tindakan: "Kirim ulang harga ERP". Halaman, tombolnya, aksinya, baris
 * Beranda dan lonceng memakai izin yang sama: `jubelio_prices:confirm`.
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
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.JUBELIO_PRICES_CONFIRM)) redirect("/backoffice");

  const sp = await searchParams;
  const jenis = bacaJenisTampil(sp.jenis);
  const cari = (sp.cari ?? "").trim().slice(0, 100);

  const [daftar, beda, tanpaHarga, jumlahBeda] = await Promise.all([
    jenis === "BEDA" ? Promise.resolve(null) : daftarHargaMenunggu({ jenis: jenis ?? undefined, cari: cari || undefined }),
    jenis === "BEDA" ? daftarHargaBedaDiJubelio({ cari: cari || undefined }) : Promise.resolve(null),
    hitungBarangJubelioTanpaHarga(),
    hitungHargaBedaDiJubelio(),
  ]);

  const baris: BarisHargaTampil[] = (daftar?.baris ?? []).map((b) => ({
    ...b,
    diubahPadaTampil: b.diubahPada ? formatDisplayDateTime(b.diubahPada) : null,
  }));
  const barisBeda: BarisHargaBedaTampil[] = (beda?.baris ?? []).map((b) => ({
    ...b,
    terbacaPadaTampil: formatDisplayDateTime(b.terbacaPada),
    berubahPadaTampil: b.berubahPada ? formatDisplayDateTime(b.berubahPada) : null,
  }));

  return (
    <HargaJubelioClient
      baris={baris}
      total={daftar?.total ?? 0}
      terpotong={daftar?.terpotong ?? false}
      beda={beda ? { baris: barisBeda, total: beda.total, terpotong: beda.terpotong } : null}
      jumlahBeda={jumlahBeda}
      jenis={jenis}
      cari={cari}
      tanpaHarga={tanpaHarga}
      // "Dijual di" diubah di halaman barang oleh pemegang items:edit (P76) — tautannya hanya untuk mereka.
      bolehUbahBarang={hasPermission(izin, PERMISSIONS.ITEMS_EDIT)}
    />
  );
}

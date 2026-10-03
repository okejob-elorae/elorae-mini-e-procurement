import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { formatDisplayDateTime } from "@/lib/date-only";
import { daftarPermintaanKiriman, type PermintaanKiriman, type StatusPermintaan } from "@/lib/spg/kantor-queries";
import { PermintaanKirimanClient, type BarisPermintaan, type SaringanPermintaan } from "./PermintaanKirimanClient";

export const dynamic = "force-dynamic";

const SARINGAN: SaringanPermintaan[] = ["aktif", "BARU", "DIPROSES", "SELESAI", "DITOLAK", "semua"];
/** Batas baris kueri — tiap panggilan `daftarPermintaanKiriman` memotong di sini. */
const BATAS_KUERI = 200;

/**
 * Permintaan kiriman dari SPG. Bawaannya "perlu ditangani" (BARU lalu
 * DIPROSES): layar ini antrean kerja, bukan arsip — yang sudah selesai atau
 * ditolak hanya dibuka lewat tabnya sendiri.
 *
 * Tanggal diformat di sini, bukan di klien: format tanggal Node dan Safari bisa
 * berbeda dan memicu hydration error.
 */
export default async function PermintaanKirimanPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const saringan: SaringanPermintaan = SARINGAN.includes(sp.status as SaringanPermintaan)
    ? (sp.status as SaringanPermintaan)
    : "aktif";

  // Tab "perlu ditangani" selalu dimuat: jumlahnya ditampilkan di tab walau
  // yang dibuka tab lain, supaya antrean yang menumpuk tetap terlihat.
  const [baru, diproses] = await Promise.all([
    daftarPermintaanKiriman({ status: "BARU" }),
    daftarPermintaanKiriman({ status: "DIPROSES" }),
  ]);

  let rows: PermintaanKiriman[];
  let terpotong: boolean;
  if (saringan === "aktif") {
    rows = [...baru, ...diproses];
    terpotong = baru.length >= BATAS_KUERI || diproses.length >= BATAS_KUERI;
  } else if (saringan === "BARU" || saringan === "DIPROSES") {
    rows = saringan === "BARU" ? baru : diproses;
    terpotong = rows.length >= BATAS_KUERI;
  } else {
    rows = await daftarPermintaanKiriman(saringan === "semua" ? {} : { status: saringan as StatusPermintaan });
    terpotong = rows.length >= BATAS_KUERI;
  }

  const baris: BarisPermintaan[] = rows.map((r) => ({
    id: r.id,
    toko: r.toko.name,
    peminta: r.peminta,
    status: r.status,
    catatan: r.catatan,
    waktu: formatDisplayDateTime(r.dibuat),
    ditangani: r.ditangani
      ? { oleh: r.ditangani.oleh, pada: formatDisplayDateTime(r.ditangani.pada), catatan: r.ditangani.catatan }
      : null,
    barang: r.baris,
    totalQty: r.totalQty,
  }));

  return (
    <PermintaanKirimanClient
      saringan={saringan}
      baris={baris}
      jumlahAktif={baru.length + diproses.length}
      terpotong={terpotong}
      bolehUbah={hasPermission(izin, PERMISSIONS.STORES_MANAGE)}
    />
  );
}

import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { formatDisplayDateTime } from "@/lib/date-only";
import { salesMonthLabelId } from "@/lib/spg-commission/payout";
import { rincianReturPembeliKantor } from "@/lib/spg/retur-pembeli-queries";
import { RincianReturPembeliClient, type RincianReturPembeliTampil } from "./RincianReturPembeliClient";

export const dynamic = "force-dynamic";

/** "2026-10" → "October 2026" (bulan WIB yang sudah berupa kunci, jadi dibaca sebagai UTC). */
function bulanInggris(periode: string): string {
  const [tahun, bulan] = periode.split("-").map(Number);
  if (!tahun || !bulan) return periode;
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(tahun, bulan - 1, 15)));
}

export default async function RincianReturPembeliSpgPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const r = await rincianReturPembeliKantor(id.slice(0, 64));
  if (!r) notFound();

  // Sama dengan penjaga aksi dan penulisnya: izin `spg_returns:approve`, dan
  // tidak ada yang memutuskan laporan yang ia buat sendiri (admin juga tidak).
  const pegangIzin = hasPermission(izin, PERMISSIONS.SPG_RETURNS_APPROVE);
  const pelaporSendiri = session.user.id === r.pelapor.id;

  const rincian: RincianReturPembeliTampil = {
    id: r.id,
    status: r.status,
    dilaporkan: formatDisplayDateTime(r.dilaporkanPada),
    pelapor: r.pelapor.nama,
    toko: r.toko,
    nota: { id: r.nota.id, docNo: r.nota.docNo, waktu: formatDisplayDateTime(r.nota.waktu), total: r.nota.total },
    alasan: r.alasan,
    diputuskan: {
      oleh: r.diputuskan.oleh,
      pada: r.diputuskan.pada ? formatDisplayDateTime(r.diputuskan.pada) : null,
      alasanTolak: r.diputuskan.alasanTolak,
    },
    langsungBerlaku: r.langsungBerlaku,
    baris: r.baris,
    peringatan: {
      bulan: { id: salesMonthLabelId(r.peringatan.bulan), en: bulanInggris(r.peringatan.bulan) },
      komisiPutusDicek: r.peringatan.komisiPutusDicek,
      siklusKonsiTerkunci: r.peringatan.siklusKonsiTerkunci,
    },
    jejak: r.jejak.map((j) => ({ action: j.action, oleh: j.oleh, pada: formatDisplayDateTime(j.pada), reason: j.reason })),
  };

  return (
    <RincianReturPembeliClient
      rincian={rincian}
      bolehMemutuskan={pegangIzin && !pelaporSendiri}
      alasanTidakBoleh={pelaporSendiri ? "PELAPOR_SENDIRI" : pegangIzin ? null : "TANPA_IZIN"}
    />
  );
}

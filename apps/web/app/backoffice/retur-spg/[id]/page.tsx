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

const bulanDuaBahasa = (periode: string) => ({ id: salesMonthLabelId(periode), en: bulanInggris(periode) });

export default async function RincianReturPembeliSpgPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const r = await rincianReturPembeliKantor(id.slice(0, 64));
  if (!r) notFound();

  // Sama dengan penjaga setiap aksi keputusan dan penulisnya: izin
  // `spg_returns:approve`, dan tidak ada yang memutuskan laporan yang ia buat
  // sendiri (admin juga tidak) — setuju, tolak, batalkan penolakan, ubah besar
  // beban, dan putuskan barangnya.
  const pegangIzin = hasPermission(izin, PERMISSIONS.SPG_RETURNS_APPROVE);
  const pelaporSendiri = session.user.id === r.pelapor.id;

  const b = r.beban;
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
    uang: {
      keadaan: r.uang.keadaan,
      pada: r.uang.pada ? formatDisplayDateTime(r.uang.pada) : null,
      olehKantor: r.uang.olehKantor,
    },
    foto: r.foto,
    strukTidakTercatat: r.strukTidakTercatat.map((s) => ({ url: s.url, pada: formatDisplayDateTime(s.pada) })),
    bebanJikaDitolak: r.bebanJikaDitolak,
    beban: b
      ? {
          spg: b.spg,
          keadaan: b.keadaan,
          dihitung: b.dihitung,
          jumlah: b.jumlah,
          alasanJumlah: b.alasanJumlah,
          dipotong: b.dipotong,
          sisa: b.sisa,
          potongan: b.potongan.map((p) => ({
            bulan: bulanDuaBahasa(p.bulan),
            jumlah: p.jumlah,
            dariKomisi: p.dariKomisi,
            dariGaji: p.dariGaji,
            keUtang: p.keUtang,
            utangLunas: p.utangLunas,
          })),
          barang: b.barang ? { keputusan: b.barang.keputusan, oleh: b.barang.oleh, pada: formatDisplayDateTime(b.barang.pada), catatan: b.barang.catatan } : null,
          kembali: b.kembali
            ? {
                jumlah: b.kembali.jumlah,
                mengurangiUtang: b.kembali.mengurangiUtang,
                dibayar: b.kembali.dibayarPada !== null,
                bulan: b.kembali.bulan ? bulanDuaBahasa(b.kembali.bulan) : null,
              }
            : null,
          dibatalkan: b.dibatalkan ? { oleh: b.dibatalkan.oleh, pada: formatDisplayDateTime(b.dibatalkan.pada), alasan: b.dibatalkan.alasan } : null,
          bisaDibatalkan: b.bisaDibatalkan,
          bisaDiubah: b.bisaDiubah,
          bisaDiputuskan: b.bisaDiputuskan,
        }
      : null,
    baris: r.baris,
    peringatan: {
      bulanKomisi: bulanDuaBahasa(r.peringatan.bulanKomisi),
      komisiDitutup: r.peringatan.komisiDitutup,
      bulanLaporan: bulanDuaBahasa(r.peringatan.bulanLaporan),
      siklusKonsiTerkunci: r.peringatan.siklusKonsiTerkunci,
    },
    jejak: r.jejak.map((j) => ({ action: j.action, entityType: j.entityType, oleh: j.oleh, pada: formatDisplayDateTime(j.pada), reason: j.reason })),
  };

  return (
    <RincianReturPembeliClient
      rincian={rincian}
      bolehMemutuskan={pegangIzin && !pelaporSendiri}
      alasanTidakBoleh={pelaporSendiri ? "PELAPOR_SENDIRI" : pegangIzin ? null : "TANPA_IZIN"}
    />
  );
}

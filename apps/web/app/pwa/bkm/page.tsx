import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { klaimSaya } from "@/lib/receivables/pwa-queries";
import { tautanPesanKlaim } from "@/lib/receivables/tugas-tagih-queries";
import { formatDisplayDate } from "@/lib/date-only";
import { koreksiTertunda, penggantiUntuk, tautanPembatalanKlaim } from "@/lib/receivables/koreksi";
import { KlaimSayaClient } from "./KlaimSayaClient";

export const dynamic = "force-dynamic";

export default async function KlaimSayaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  // Layar salesman keliling: SPG (toko tetap) dikembalikan ke berandanya.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");

  const baris = await klaimSaya(session.user.id);
  // Pesan WhatsApp ke toko per laporan: tanda terima selama menunggu verifikasi,
  // konfirmasi sesudah terverifikasi. Hanya BKM yang ia laporkan sendiri.
  const pesan = await tautanPesanKlaim(
    baris.map((b) => b.id),
    { pemilik: session.user.id },
  );
  // Koreksi: pengganti BKM yang ditarik/ditolak, permintaan koreksi yang
  // menunggu kantor, dan pesan "tanda terima dibatalkan" untuk toko.
  const ditutup = baris.filter((b) => b.status === "DIBATALKAN" || b.status === "DITOLAK").map((b) => b.id);
  const [pengganti, koreksi, pesanBatal] = await Promise.all([
    penggantiUntuk("bkm", ditutup),
    koreksiTertunda("bkm", baris.filter((b) => b.status === "TERVERIFIKASI").map((b) => b.id)),
    tautanPembatalanKlaim(ditutup, { pemilik: session.user.id }),
  ]);
  // Tanggal efektif giro diformat di server — klien menerima teks jadi.
  return (
    <KlaimSayaClient
      baris={baris.map((b) => {
        const k = koreksi.get(b.id);
        return {
          ...b,
          giroEfektifTeks: b.giro?.tanggalEfektif ? formatDisplayDate(b.giro.tanggalEfektif) : null,
          pesanToko: pesan.get(b.id) ?? null,
          digantiOleh: pengganti.get(b.id)?.nomor ?? null,
          koreksi: k ? { pada: formatDisplayDate(k.pada), alasan: k.alasan } : null,
          pesanBatal: pesanBatal.get(b.id) ?? null,
        };
      })}
    />
  );
}

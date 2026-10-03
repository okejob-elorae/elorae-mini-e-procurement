import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { bolehMembacaArsip, bolehMemverifikasi } from "@/lib/receivables/izin";
import { giroBaruDiputuskan, giroMenunggu, type BarisGiro } from "@/lib/receivables/giro-queries";
import { ringkasGiro, URUTAN_KELOMPOK_GIRO } from "@/lib/receivables/giro";
import { formatDisplayDate } from "@/lib/date-only";
import { DaftarGiroClient, type GiroTampil, type KelompokTampil } from "./DaftarGiroClient";

export const dynamic = "force-dynamic";

/** Tanggal diformat di server — komponen klien menerima teks jadi. */
function tampil(g: BarisGiro): GiroTampil {
  return {
    id: g.id,
    docNo: g.docNo,
    storeName: g.storeName,
    salesmanName: g.salesmanName,
    giroNo: g.giroNo,
    giroBank: g.giroBank,
    terbit: formatDisplayDate(g.tanggalTerbit),
    efektif: formatDisplayDate(g.tanggalEfektif),
    nilai: g.nilai,
    status: g.giroStatus,
    kedaluwarsa: g.kedaluwarsa,
    diputuskanPada: g.diputuskanPada ? formatDisplayDate(g.diputuskanPada) : null,
    catatan: g.catatan,
  };
}

/**
 * Daftar giro — bilyet yang dipegang kantor dan belum jadi uang.
 *
 * Dikelompokkan menurut kapan harus disetor, bukan menurut toko: pertanyaan
 * pagi admin keuangan adalah "bilyet mana yang harus ke bank hari ini", dan
 * yang lewat tanggal efektifnya mendekati akhir masa berlaku 70 hari.
 */
export default async function DaftarGiroPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const izin = session.user.permissions;
  if (!bolehMembacaArsip(izin) && !bolehMemverifikasi(izin)) redirect("/backoffice");

  const sekarang = new Date();
  const [menunggu, baruSaja] = await Promise.all([
    giroMenunggu({ sekarang }),
    giroBaruDiputuskan({ sekarang }),
  ]);

  const ringkas = ringkasGiro(
    menunggu.flatMap((g) => (g.tanggalEfektif ? [{ tanggalEfektif: g.tanggalEfektif, nilai: g.nilai }] : [])),
    sekarang,
  );
  const kelompok: KelompokTampil[] = URUTAN_KELOMPOK_GIRO.map((k) => ({
    kelompok: k,
    jumlah: ringkas[k].jumlah,
    nilai: ringkas[k].nilai,
    baris: menunggu.filter((g) => g.kelompok === k).map(tampil),
  }));
  // Giro tanpa tanggal efektif (dicatat sebelum kolomnya ada) tidak punya
  // kelompok. Ditaruh di "Lewat" — arah yang aman: dilihat, bukan dilupakan.
  const tanpaTanggal = menunggu.filter((g) => g.kelompok === null).map(tampil);
  if (tanpaTanggal.length > 0) {
    kelompok[0].baris.push(...tanpaTanggal);
    kelompok[0].jumlah += tanpaTanggal.length;
    kelompok[0].nilai += tanpaTanggal.reduce((s, g) => s + g.nilai, 0);
  }

  return (
    <DaftarGiroClient
      kelompok={kelompok}
      baruSaja={baruSaja.map(tampil)}
      bolehMemutuskan={bolehMemverifikasi(izin)}
    />
  );
}

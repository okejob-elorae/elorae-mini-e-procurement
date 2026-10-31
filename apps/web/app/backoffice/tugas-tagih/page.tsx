import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { bolehMembacaArsip, bolehMengelola } from "@/lib/receivables/izin";
import { daftarSalesman } from "@/lib/salesman/queries";
import { daftarTugasTagih, type SaringTugas } from "@/lib/receivables/tugas-tagih-queries";
import { bolehDitutupOtomatis, STATUS_TUGAS, type StatusTugas } from "@/lib/receivables/tugas-tagih";
import { tutupTugasLunasOtomatis } from "@/lib/receivables/tugas-tagih-writer";
import { formatDisplayDate } from "@/lib/date-only";
import { TugasTagihClient, type BarisTugasTampil } from "./TugasTagihClient";

export const dynamic = "force-dynamic";

const STATUS_SARING = [STATUS_TUGAS.TERBUKA, STATUS_TUGAS.SELESAI, STATUS_TUGAS.DIBATALKAN, "SEMUA"] as const;
type StatusSaring = (typeof STATUS_SARING)[number];

export default async function TugasTagihPage({
  searchParams,
}: {
  searchParams: Promise<{ petugas?: string; status?: string; terlambat?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Rute modul piutang tidak dipetakan di ROUTE_PERMISSIONS — halaman memagari dirinya sendiri.
  if (!bolehMembacaArsip(session.user.permissions)) redirect("/backoffice");

  const sp = await searchParams;
  const status: StatusSaring = (STATUS_SARING as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as StatusSaring)
    : STATUS_TUGAS.TERBUKA;
  const saring: SaringTugas = {
    assigneeId: sp.petugas || undefined,
    status: status as StatusTugas | "SEMUA",
    hanyaTerlambat: sp.terlambat === "1",
  };

  let baris = await daftarTugasTagih(saring);
  /*
   * Penutupan otomatis yang malas: tugas yang semua fakturnya sudah lunas
   * terverifikasi ditutup saat daftar ini dibaca — tanpa cron. Penulisnya
   * menghitung ulang lagi di dalam transaksi; kalau ada yang tertutup, daftar
   * dibaca ulang supaya yang tampil adalah keadaan sesudahnya.
   */
  const calon = baris.filter((b) => bolehDitutupOtomatis(b.status, b.keadaan)).map((b) => b.id);
  if (calon.length > 0) {
    const ditutup = await tutupTugasLunasOtomatis({ taskIds: calon, olehUserId: session.user.id });
    if (ditutup.length > 0) baris = await daftarTugasTagih(saring);
  }

  const tampil: BarisTugasTampil[] = baris.map((b) => ({
    id: b.id,
    storeId: b.storeId,
    storeName: b.storeName,
    assigneeName: b.assigneeName,
    status: b.status,
    keadaan: b.keadaan,
    note: b.note,
    totalSisa: b.totalSisa,
    hilang: b.hilang,
    faktur: b.faktur.map((f) => ({ id: f.id, invoiceNo: f.invoiceNo, sisa: f.sisa, keadaan: f.keadaan })),
    tenggatTeks: b.dueDate ? formatDisplayDate(b.dueDate) : null,
    dibuat: { nama: b.createdByName, tanggal: formatDisplayDate(b.createdAt) },
    penutup: b.penutup
      ? {
          catatan: b.penutup.catatan,
          oleh: b.penutup.oleh,
          otomatis: b.penutup.otomatis,
          tanggal: formatDisplayDate(b.penutup.pada),
        }
      : null,
  }));

  return (
    <TugasTagihClient
      baris={tampil}
      petugas={await daftarSalesman()}
      saring={{ petugas: sp.petugas ?? "", status, terlambat: sp.terlambat === "1" }}
      bolehMengelola={bolehMengelola(session.user.permissions)}
    />
  );
}

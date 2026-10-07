import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { returTertahan } from "@/lib/receivables/rules";
import { PILIH_POTONGAN, potonganRetur } from "@/lib/receivables/deductions";
import { giroKedaluwarsa, STATUS_GIRO, type StatusGiro } from "@/lib/receivables/giro";
import { formatDisplayDate } from "@/lib/date-only";
import { bolehMembacaPelunasan } from "@/lib/receivables/izin";
import { koreksiTertunda } from "@/lib/receivables/koreksi";
import { PelunasanClient, type BarisKlaim, type StatusKlaim } from "./PelunasanClient";
import { pemeriksaSamaKlaim } from "./[id]/putusan-klaim";
import { bacaCari, bacaHalaman, cocokCari, potongHalaman } from "../piutang/_daftar/halaman";

export const dynamic = "force-dynamic";

const STATUS_KLAIM: readonly StatusKlaim[] = ["DIKIRIM", "TERVERIFIKASI", "DITOLAK"];

/**
 * `?status=` (DIKIRIM/TERVERIFIKASI/DITOLAK), `?koreksi=1`, `?cari=`, dan
 * `?halaman=` disaring di server, supaya tautan Beranda ("BKM menunggu
 * verifikasi", "Permintaan koreksi BKM") mendarat di daftar yang angkanya sama
 * dan peramban hanya menerima satu halaman.
 */
export default async function PelunasanPage(props?: {
  searchParams: Promise<{ status?: string; koreksi?: string; cari?: string; halaman?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  // Rute modul piutang tidak dipetakan di ROUTE_PERMISSIONS — halaman memagari dirinya sendiri.
  // Keuangan ikut: BKM menunggu verifikasinya ada di sini.
  if (!bolehMembacaPelunasan(session.user.permissions)) redirect("/backoffice");

  const sp = (await props?.searchParams) ?? {};
  const saringStatus = (STATUS_KLAIM as readonly string[]).includes(sp.status ?? "") ? (sp.status as StatusKlaim) : null;
  const saringKoreksi = sp.koreksi === "1";
  const cari = bacaCari(sp.cari);

  const rows = await prisma.paymentClaim.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      docNo: true,
      claimedTransferAt: true,
      invoiceAmount: true,
      deductionTotal: true,
      receivedAmount: true,
      status: true,
      verifyNote: true,
      method: true,
      giroNo: true,
      giroIssueDate: true,
      giroEffectiveDate: true,
      giroStatus: true,
      salesmanId: true,
      createdById: true,
      store: { select: { name: true } },
      salesman: { select: { name: true } },
      deductions: { select: PILIH_POTONGAN },
    },
  });
  // Definisi yang sama dengan baris Beranda (`dokumenKoreksiTertunda`).
  const koreksi = await koreksiTertunda(
    "bkm",
    rows.map((r) => r.id),
  );

  const sekarang = new Date();
  const semua: BarisKlaim[] = rows.map((r) => ({
    id: r.id,
    docNo: r.docNo,
    storeName: r.store.name,
    salesmanName: r.salesman?.name ?? null,
    claimedTransferAt: r.claimedTransferAt.toISOString(),
    invoiceAmount: Number(r.invoiceAmount),
    deductionTotal: Number(r.deductionTotal),
    receivedAmount: Number(r.receivedAmount),
    deductionCount: r.deductions.length,
    status: r.status,
    verifyNote: r.verifyNote,
    mintaKoreksi: koreksi.has(r.id),
    // Pelapor/pencatat tidak boleh memutuskan BKM-nya sendiri (penulis menolak
    // dengan PEMERIKSA_SAMA); tombolnya dimatikan dengan alasan sejak awal.
    pemeriksaSama: pemeriksaSamaKlaim(session.user.id, r),
    /*
     * Lewat penerjemah yang sama dengan halaman piutang dan halaman rinci.
     * Sebelumnya baris ini menghitung sendiri dengan asumsi "gudang belum
     * pernah menghitung" — benar saat tabel returnya belum ada, dan diam-diam
     * salah begitu ia ada: daftar ini akan menyebut angka tertahan yang berbeda
     * dari yang disebut halaman piutang untuk faktur yang sama.
     */
    nilaiTertahan: returTertahan(potonganRetur(r.deductions)),
    // Giro dibawa dengan statusnya sendiri: klaim giro yang menunggu tidak boleh
    // diverifikasi lewat tombol biasa, jadi barisnya menawarkan "cair/ditolak".
    giro: r.giroStatus
      ? {
          nomor: r.giroNo ?? "—",
          efektif: formatDisplayDate(r.giroEffectiveDate),
          status: r.giroStatus as StatusGiro,
          kedaluwarsa:
            r.giroStatus === STATUS_GIRO.MENUNGGU && r.giroIssueDate !== null
              ? giroKedaluwarsa(r.giroIssueDate, sekarang)
              : false,
        }
      : null,
  }));
  const giroMenunggu = semua.filter((b) => b.status === "DIKIRIM" && b.giro?.status === "MENUNGGU").length;
  const jumlah = {
    semua: semua.length,
    DIKIRIM: semua.filter((b) => b.status === "DIKIRIM").length,
    TERVERIFIKASI: semua.filter((b) => b.status === "TERVERIFIKASI").length,
    DITOLAK: semua.filter((b) => b.status === "DITOLAK").length,
    koreksi: semua.filter((b) => b.mintaKoreksi).length,
  };
  const halaman = potongHalaman(
    semua.filter(
      (b) =>
        (!saringStatus || b.status === saringStatus) &&
        (!saringKoreksi || b.mintaKoreksi) &&
        cocokCari(cari, b.docNo, b.storeName, b.salesmanName, b.giro?.nomor),
    ),
    bacaHalaman(sp.halaman),
  );

  return (
    <PelunasanClient
      baris={halaman.baris}
      halaman={{ halaman: halaman.halaman, totalHalaman: halaman.totalHalaman, total: halaman.total, ukuran: halaman.ukuran }}
      saring={{ status: saringStatus, koreksi: saringKoreksi, cari }}
      jumlah={jumlah}
      giroMenunggu={giroMenunggu}
      bolehMemutuskan={hasPermission(
        session.user.permissions ?? [],
        PERMISSIONS.JOURNALS_MANAGE,
      )}
      bolehMengelola={hasPermission(
        session.user.permissions ?? [],
        PERMISSIONS.RECEIVABLES_MANAGE,
      )}
    />
  );
}

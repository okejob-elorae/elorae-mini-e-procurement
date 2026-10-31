import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { rincianKlaim } from "@/lib/receivables/claim-queries";
import { giroKedaluwarsa, STATUS_GIRO, type StatusGiro } from "@/lib/receivables/giro";
import { formatDisplayDate } from "@/lib/date-only";
import { bolehMembacaArsip, bolehMembacaPelunasan, bolehMembacaPiutang } from "@/lib/receivables/izin";
import { tautanPesanKlaim } from "@/lib/receivables/tugas-tagih-queries";
import { RincianKlaimClient, type GiroKlaim } from "./RincianKlaimClient";
import { pemeriksaSamaKlaim } from "./putusan-klaim";
import { koreksiTertunda, penggantiUntuk, riwayatDokumen } from "@/lib/receivables/koreksi";

export const dynamic = "force-dynamic";

/**
 * Rincian bilyet giro sebuah BKM, dengan tanggal yang sudah diformat.
 *
 * Dibaca terpisah dari `rincianKlaim` supaya kueri rincian klaim tidak perlu
 * tahu soal giro; `null` untuk klaim yang bukan giro.
 */
async function giroKlaim(id: string): Promise<GiroKlaim | null> {
  const g = await prisma.paymentClaim.findUnique({
    where: { id },
    select: {
      giroNo: true,
      giroBank: true,
      giroIssueDate: true,
      giroEffectiveDate: true,
      giroStatus: true,
      giroSettledAt: true,
    },
  });
  if (!g?.giroStatus) return null;
  return {
    nomor: g.giroNo ?? "—",
    bank: g.giroBank ?? "—",
    terbit: formatDisplayDate(g.giroIssueDate),
    efektif: formatDisplayDate(g.giroEffectiveDate),
    status: g.giroStatus as StatusGiro,
    cairPada: g.giroSettledAt ? formatDisplayDate(g.giroSettledAt) : null,
    kedaluwarsa:
      g.giroStatus === STATUS_GIRO.MENUNGGU && g.giroIssueDate !== null
        ? giroKedaluwarsa(g.giroIssueDate, new Date())
        : false,
  };
}

export default async function RincianKlaimPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  // Rute modul piutang tidak dipetakan di ROUTE_PERMISSIONS — halaman memagari dirinya sendiri.
  if (!bolehMembacaPelunasan(session.user.permissions)) redirect("/backoffice");

  const { id } = await params;
  const [data, giro] = await Promise.all([rincianKlaim(id), giroKlaim(id)]);
  if (!data) notFound();

  // Koreksi: laporan pengganti (dua arah), permintaan koreksi dari sales, dan
  // riwayat keputusan atas BKM ini.
  const pelaku = await prisma.paymentClaim.findUnique({
    where: { id },
    select: { replacesClaimId: true, salesmanId: true, createdById: true },
  });
  const [pengganti, asal, koreksi, riwayat] = await Promise.all([
    penggantiUntuk("bkm", [id]),
    pelaku?.replacesClaimId
      ? prisma.paymentClaim.findUnique({ where: { id: pelaku.replacesClaimId }, select: { id: true, docNo: true } })
      : null,
    koreksiTertunda("bkm", [id]),
    riwayatDokumen([id]),
  ]);
  const k = koreksi.get(id);

  /*
   * "Kirim konfirmasi ke toko" — hanya sesudah keuangan memverifikasi, dengan
   * sisa faktur yang dihitung ulang sekarang. Klaim yang masih menunggu tidak
   * mendapat tombol ini di sini: pesan sebelum verifikasi adalah tanda terima,
   * dan itu dikirim pelapornya dari formulir/daftar BKM.
   */
  const konfirmasi =
    data.status === "TERVERIFIKASI" && bolehMembacaArsip(session.user.permissions)
      ? ((await tautanPesanKlaim([id])).get(id) ?? null)
      : null;

  return (
    <RincianKlaimClient
      data={data}
      giro={giro}
      konfirmasiToko={konfirmasi?.jenis === "KONFIRMASI" ? { url: konfirmasi.url, adaNomor: konfirmasi.adaNomor } : null}
      bolehMemutuskan={hasPermission(
        session.user.permissions ?? [],
        PERMISSIONS.JOURNALS_MANAGE,
      )}
      bolehMembuat={hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE)}
      digantiOleh={pengganti.get(id) ? { id: pengganti.get(id)!.id, nomor: pengganti.get(id)!.nomor } : null}
      menggantikan={asal ? { id: asal.id, nomor: asal.docNo } : null}
      koreksi={k ? { pada: formatDisplayDate(k.pada), alasan: k.alasan } : null}
      riwayat={riwayat}
      // Pelapor/pencatat tidak boleh memutuskan BKM-nya sendiri: tombolnya mati
      // dengan alasan sejak awal, bukan baru sesudah server menolak.
      pemeriksaSama={pelaku ? pemeriksaSamaKlaim(session.user.id, pelaku) : false}
      bolehBacaPiutang={bolehMembacaPiutang(session.user.permissions)}
    />
  );
}

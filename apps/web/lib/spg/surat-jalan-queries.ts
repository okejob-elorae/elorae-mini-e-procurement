import { prisma } from "@elorae/db";
import { logAudit } from "@/lib/audit";
import { buildSuratJalanMutasiHtml } from "@/lib/print/surat-jalan-mutasi-html";
import { bacaVarian } from "@/lib/salesman/analisa-toko";
import { ENTITAS_SURAT_JALAN, keadaanSuratJalan, LABEL_STATUS_SURAT_JALAN, type DataSuratJalan } from "./surat-jalan";

/**
 * Kueri dan respons surat jalan mutasi — server saja.
 *
 * Dokumen dibangun di server dan dikirim sebagai halaman HTML utuh (rute
 * `.../surat-jalan`), bukan dicetak dari iframe di layar rincian: halaman
 * mandiri dicetak sama di setiap peramban, termasuk Safari iPhone dan Chrome
 * Android, dan sekaligus menjadi pratinjau sebelum "Simpan sebagai PDF".
 * Mutasi tidak membawa harga sama sekali, jadi tidak ada yang perlu disaring.
 */

/** Data dokumen satu mutasi, apa pun statusnya; null bila tidak ada. Akses diperiksa pemanggil. */
export async function dataSuratJalanMutasi(id: string): Promise<DataSuratJalan | null> {
  const m = await prisma.storeTransfer.findUnique({
    where: { id },
    select: {
      id: true,
      docNo: true,
      status: true,
      reason: true,
      reviewNote: true,
      createdAt: true,
      approvedAt: true,
      shippedById: true,
      shippedAt: true,
      fromStore: { select: { id: true, code: true, name: true, address: true, phone: true, contactName: true } },
      toStore: { select: { id: true, code: true, name: true, address: true, phone: true, contactName: true } },
      lines: {
        orderBy: { productName: "asc" },
        select: { productName: true, variantSku: true, qty: true, item: { select: { sku: true, variants: true } } },
      },
    },
  });
  if (!m) return null;

  // Tanda terima toko tujuan (sumber MUTASI) — bukan terima kembali toko asal.
  const terima =
    m.status === "DITERIMA"
      ? await prisma.storeReceipt.findUnique({
          where: { sourceType_sourceId: { sourceType: "MUTASI", sourceId: m.id } },
          select: { receivedById: true, receivedAt: true },
        })
      : null;

  const orangIds = [m.shippedById, terima?.receivedById].filter((x): x is string => Boolean(x));
  const orang = orangIds.length
    ? await prisma.user.findMany({ where: { id: { in: orangIds } }, select: { id: true, name: true, email: true } })
    : [];
  const nama = new Map(orang.map((u) => [u.id, u.name ?? u.email]));

  const toko = (t: typeof m.fromStore) => ({
    id: t.id,
    kode: t.code,
    nama: t.name,
    alamat: t.address,
    telepon: t.phone,
    kontak: t.contactName,
  });

  return {
    id: m.id,
    docNo: m.docNo,
    status: m.status,
    asal: toko(m.fromStore),
    tujuan: toko(m.toStore),
    diajukanIso: m.createdAt.toISOString(),
    disetujuiIso: m.approvedAt ? m.approvedAt.toISOString() : null,
    dikirimIso: m.shippedAt ? m.shippedAt.toISOString() : null,
    diterimaIso: terima ? terima.receivedAt.toISOString() : null,
    pengirim: m.shippedById ? (nama.get(m.shippedById) ?? null) : null,
    penerima: terima ? (nama.get(terima.receivedById) ?? null) : null,
    alasan: m.reason,
    catatanKantor: m.reviewNote,
    baris: m.lines.map((l) => {
      const v = bacaVarian(l.item.variants, l.variantSku, l.item.sku);
      const varian = [v.warna, v.ukuran].filter(Boolean).join(" · ");
      return { sku: l.variantSku || l.item.sku, nama: l.productName, varian: varian || null, qty: l.qty };
    }),
  };
}

// ─── Respons halaman ─────────────────────────────────────────────────────────

const KEPALA = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
} as const;

function halamanPesan(judul: string, isi: string, kembaliHref: string, status: number): Response {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
<title>${esc(judul)}</title>
<style>body{margin:0;padding:32px 20px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111827;background:#fff}
main{max-width:32rem;margin:0 auto}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 20px;color:#4b5563}
a{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1px solid #e5e7eb;border-radius:8px;color:#111827;text-decoration:none;font-weight:600}</style>
</head><body><main><h1>${esc(judul)}</h1><p>${esc(isi)}</p><a href="${esc(kembaliHref)}">← Kembali</a></main></body></html>`;
  return new Response(html, { status, headers: KEPALA });
}

export const responsSuratJalanTidakAda = (kembaliHref: string, isi = "Mutasi ini tidak ada, atau bukan milik toko Anda."): Response =>
  halamanPesan("Surat jalan tidak ditemukan", isi, kembaliHref, 404);

/**
 * Halaman surat jalan untuk data yang aksesnya SUDAH diperiksa pemanggil.
 * Menulis jejak cetak (`PRINT`) setiap kali dokumen yang bisa dicetak dibuka —
 * halaman ini langsung membuka jendela cetak, jadi membukanya = mencetak.
 */
export async function responsSuratJalan(input: {
  data: DataSuratJalan;
  userId: string;
  kembaliHref: string;
  pratinjau: boolean;
  dari: "HP" | "KANTOR";
  sekarang?: Date;
}): Promise<Response> {
  const { data } = input;
  const html = buildSuratJalanMutasiHtml(data, {
    dicetakPada: input.sekarang ?? new Date(),
    layar: { kembaliHref: input.kembaliHref, cetakOtomatis: true },
  });
  if (html === null) {
    const status = LABEL_STATUS_SURAT_JALAN[data.status] ?? data.status;
    return halamanPesan(
      "Surat jalan tidak bisa dicetak",
      `Mutasi ${data.docNo} berstatus "${status}" — surat jalannya tidak berlaku lagi.`,
      input.kembaliHref,
      409,
    );
  }
  await logAudit({
    userId: input.userId,
    action: "PRINT",
    entityType: ENTITAS_SURAT_JALAN,
    entityId: data.id,
    metadata: { docNo: data.docNo, status: data.status, draf: keadaanSuratJalan(data.status) === "DRAF", pratinjau: input.pratinjau, dari: input.dari },
  });
  return new Response(html, { status: 200, headers: KEPALA });
}

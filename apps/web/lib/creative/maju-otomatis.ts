import type { Prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { angkaSudahMatang, indeksTahap, majuOtomatis, type FaktaKolaborasi, type StatusBayar, type Tahap } from "./tahap";

/**
 * Majukan tahap kolaborasi dari fakta lapangan — DI DALAM transaksi pemanggil.
 *
 * Satu pintu untuk semua penulis yang mengubah fakta (pengiriman sampel,
 * konten, angka konten, pembayaran): mereka menulis faktanya, lalu memanggil
 * ini dengan `tx` yang sama. Faktanya dibaca ulang dari basis data — bukan
 * dikirim pemanggil — supaya penulis yang berbeda tidak bisa berbeda pendapat
 * soal tahapnya. Aturannya murni di `majuOtomatis` (hanya maju, tidak pernah
 * dari jalur keluar atau SELESAI).
 *
 * Mengembalikan perpindahannya, atau `null` bila tahapnya tetap.
 */
export async function terapkanMajuOtomatis(
  tx: Prisma.TransactionClient,
  input: { kolaborasiId: string; olehUserId: string; sebab: string },
): Promise<{ dari: Tahap; ke: Tahap } | null> {
  const c = await tx.kolBrief.findUnique({
    where: { id: input.kolaborasiId },
    select: {
      id: true,
      docNo: true,
      tahap: true,
      payStatus: true,
      liveAt: true,
      kol: { select: { name: true } },
      shipments: { select: { trackingNo: true, receivedAt: true } },
      kolContents: {
        select: {
          link: true,
          liveAt: true,
          draftLink: true,
          draftStatus: true,
          metrics: { select: { recordedAt: true }, orderBy: { recordedAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!c) return null;

  const tayang = c.kolContents.filter((k) => Boolean(k.link?.trim()));
  const pasangan = tayang
    .filter((k) => k.liveAt)
    .map((k) => ({
      tayangHari: formatDateOnlyJakarta(k.liveAt!),
      angkaTerakhirHari: k.metrics[0] ? formatDateOnlyJakarta(k.metrics[0].recordedAt) : null,
    }));
  const matang = pasangan.find((p) => angkaSudahMatang(p.tayangHari, p.angkaTerakhirHari)) ?? pasangan[0];

  const fakta: FaktaKolaborasi = {
    adaResi: c.shipments.some((s) => Boolean(s.trackingNo?.trim())),
    adaTerima: c.shipments.some((s) => s.receivedAt !== null),
    adaLinkDraf: c.kolContents.some((k) => Boolean(k.draftLink?.trim())),
    drafDisetujui: c.kolContents.some((k) => k.draftStatus === "DISETUJUI"),
    adaLinkKonten: tayang.length > 0,
    tayangHari: matang?.tayangHari ?? null,
    angkaTerakhirHari: matang?.angkaTerakhirHari ?? null,
    statusBayar: c.payStatus as StatusBayar,
  };

  const dari = c.tahap as Tahap;
  const ke = majuOtomatis(dari, fakta);
  if (!ke) return null;

  const sekarang = new Date();
  const tayangPertama = tayang
    .map((k) => k.liveAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  await tx.kolBrief.update({
    where: { id: c.id },
    data: {
      tahap: ke,
      tahapAt: sekarang,
      ...(indeksTahap(ke) >= indeksTahap("TAYANG") && !c.liveAt ? { liveAt: tayangPertama ?? sekarang } : {}),
    },
  });

  await catatJejak(tx, {
    userId: input.olehUserId,
    action: JEJAK.KOLABORASI_MAJU_OTOMATIS,
    entityType: "KolBrief",
    entityId: c.id,
    changes: { before: { tahap: dari }, after: { tahap: ke } },
    metadata: { docNo: c.docNo, kol: c.kol.name, sebab: input.sebab, otomatis: true },
  });

  return { dari, ke };
}

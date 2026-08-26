import { Prisma } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';

/**
 * Penulis faktur yang diketik manual.
 *
 * Terpisah dari impor karena tuntutannya berbeda: impor menerima berkas apa
 * adanya dan melaporkan yang tidak bisa dipakai, sedangkan yang diketik orang
 * harus ditolak di depan supaya ia bisa langsung membetulkannya.
 */

const D = (n: number) => new Prisma.Decimal(n);

export type BarisFaktur = {
  itemId?: string | null;
  itemName: string;
  qty: number;
  price: number;
};

export type AlasanGagalFaktur =
  | 'NOMOR_WAJIB'
  | 'NOMOR_SUDAH_ADA'
  | 'TOKO_TIDAK_DITEMUKAN'
  | 'TOKO_KONSI'
  | 'NILAI_TIDAK_VALID'
  | 'TEMPO_SEBELUM_FAKTUR';

export async function buatPiutangManual(input: {
  invoiceNo: string;
  storeId: string;
  salesmanId?: string | null;
  invoiceDate: Date;
  dueDate: Date;
  amount?: number;
  items?: BarisFaktur[];
}): Promise<{ ok: true; id: string } | { ok: false; alasan: AlasanGagalFaktur }> {
  const nomor = input.invoiceNo?.trim();
  if (!nomor) return { ok: false, alasan: 'NOMOR_WAJIB' };

  const items = (input.items ?? []).filter((b) => b.itemName.trim() && b.qty > 0);
  // Kalau rinciannya ada, totalnya DIHITUNG dari rincian — total yang diketik
  // di samping rincian yang tidak menjumlah ke sana adalah dua kebenaran.
  const total = items.length > 0
    ? items.reduce((s, b) => s + b.qty * b.price, 0)
    : (input.amount ?? 0);
  if (!(total > 0)) return { ok: false, alasan: 'NILAI_TIDAK_VALID' };

  // Jatuh tempo sebelum tanggal faktur akan langsung tampil lewat tempo pada
  // hari fakturnya dibuat — angka yang tidak berarti apa pun bagi siapa pun.
  if (input.dueDate < input.invoiceDate) return { ok: false, alasan: 'TEMPO_SEBELUM_FAKTUR' };

  return runSerializable(async (tx) => {
    const toko = await tx.store.findUnique({
      where: { id: input.storeId },
      select: { id: true, termsType: true },
    });
    if (!toko) return { ok: false as const, alasan: 'TOKO_TIDAK_DITEMUKAN' as const };
    // Toko konsinyasi tidak melahirkan piutang: barangnya masih milik kita.
    if (toko.termsType === 'KONSI') return { ok: false as const, alasan: 'TOKO_KONSI' as const };

    const kembar = await tx.receivable.findFirst({
      where: { invoiceNo: nomor },
      select: { id: true },
    });
    if (kembar) return { ok: false as const, alasan: 'NOMOR_SUDAH_ADA' as const };

    const piutang = await tx.receivable.create({
      data: {
        invoiceNo: nomor,
        storeId: input.storeId,
        salesmanId: input.salesmanId ?? null,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        amount: D(total),
        // Faktur baru belum dibayar apa pun. Sisanya tetap dihitung ulang oleh
        // pembacanya dari klaim yang menyentuhnya, jadi kolom ini cache.
        outstanding: D(total),
        source: 'MANUAL',
        items: {
          create: items.map((b) => ({
            itemId: b.itemId ?? null,
            itemName: b.itemName.trim(),
            qty: b.qty,
            price: D(b.price),
            amount: D(b.qty * b.price),
          })),
        },
      },
      select: { id: true },
    });

    return { ok: true as const, id: piutang.id };
  });
}

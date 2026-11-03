import type { AdminNotification, Prisma } from "@elorae/db";
import { catatBebanDipotong, catatPengembalianBebanDibayar } from "./beban-spg-writer";
import { keSen } from "./hilang";
import { potongBebanHilangPenuh } from "./hilang-potong";
import type { RencanaBayarKomisi } from "./koreksi";
import { catatKoreksiDiterapkan } from "./koreksi-writer";
import { potongUtangSpg, tutupKeUtangSpg } from "./utang-writer";

/**
 * Langkah bersama pembayaran gaji & komisi SPG — toko putus (`tandaiKomisiDibayar`) dan konsinyasi
 * (`bayarKomisi`) — DI DALAM transaksi pembayaran, sesudah tukar-bandingkan `paidAt`: setiap
 * pengurang rencana diambil persis seperti yang ditampilkan (B22), koreksi ditulis, dan pada
 * pembayaran terakhir SPG yang berhenti yang tidak tertutup menjadi utang (B28). Semua di transaksi
 * yang sama dengan jejaknya, jadi pembayaran yang gagal tidak meninggalkan apa pun.
 */

type Tx = Prisma.TransactionClient;

export async function terapkanPembayaran(
  tx: Tx,
  input: {
    userId: string;
    rencana: RencanaBayarKomisi;
    bulanBayar: string;
    olehUserId: string;
    waktu: Date;
    catatan: string;
  },
): Promise<{
  koreksi: Awaited<ReturnType<typeof catatKoreksiDiterapkan>>;
  utangBaru: { id: string; jumlah: number }[];
  notifikasi: AdminNotification[];
}> {
  const { rencana } = input;
  const diambil = (p: { dariKomisi: number; dariGaji: number }) => keSen(p.dariKomisi) + keSen(p.dariGaji);

  const hilang = rencana.potong.filter((p) => p.jenis === "BARANG_HILANG" && diambil(p) > 0);
  if (hilang.length > 0) {
    await potongBebanHilangPenuh(tx, {
      userId: input.userId,
      potong: hilang.map((p) => ({ shareId: p.sumber, sen: diambil(p) })),
      refType: rencana.refType,
      refId: rencana.refId,
      createdById: input.olehUserId,
      note: input.catatan,
    });
  }

  const notifikasi: AdminNotification[] = [];
  const retur = rencana.potong.filter((p) => p.jenis === "RETUR_PEMBELI" && diambil(p) > 0);
  if (retur.length > 0) {
    const r = await catatBebanDipotong(tx, {
      olehUserId: input.olehUserId,
      waktu: input.waktu,
      bulanBayar: input.bulanBayar,
      potong: retur.map((p) => ({
        chargeId: p.sumber,
        jumlah: diambil(p) / 100,
        dariKomisi: p.dariKomisi,
        dariGaji: p.dariGaji,
        paidRefType: rencana.refType,
        paidRefId: rencana.refId,
      })),
    });
    notifikasi.push(...r.lunas);
  }

  const utang = rencana.potong.filter((p) => p.jenis === "UTANG" && diambil(p) > 0);
  if (utang.length > 0) {
    await potongUtangSpg(tx, { potong: utang.map((p) => ({ debtId: p.sumber, sen: diambil(p) })), refType: rencana.refType, refId: rencana.refId, olehUserId: input.olehUserId });
  }

  if (rencana.kembaliBeban.length > 0) {
    await catatPengembalianBebanDibayar(tx, {
      olehUserId: input.olehUserId,
      waktu: input.waktu,
      bulanBayar: input.bulanBayar,
      paidRefType: rencana.refType,
      paidRefId: rencana.refId,
      kembali: rencana.kembaliBeban.map((k) => ({ chargeId: k.chargeId, jumlah: k.jumlah })),
    });
  }

  const koreksi = await catatKoreksiDiterapkan(tx, { userId: input.userId, rencana, bulanBayar: input.bulanBayar, olehUserId: input.olehUserId, waktu: input.waktu });

  const utangBaru =
    rencana.akhir && rencana.keUtang
      ? await tutupKeUtangSpg(tx, {
          spgUserId: input.userId,
          createdRefType: rencana.refType,
          createdRefId: rencana.refId,
          keUtang: rencana.keUtang,
          bulanBayar: input.bulanBayar,
          olehUserId: input.olehUserId,
          waktu: input.waktu,
        })
      : [];

  return { koreksi, utangBaru, notifikasi };
}

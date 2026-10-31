import { prisma } from "@elorae/db";
import { dekripsi, konteksKol, kunciTersedia, type KolomSensitif } from "./data-sensitif";
import type { JenisPajak } from "./pph";

/**
 * Ringkasan pajak & rekening KOL untuk layar — KHUSUS SERVER. Klien hanya
 * `import type`.
 *
 * TIDAK PERNAH membawa nomor rekening, NIK, atau NPWP lengkap: hanya nama bank
 * (dibuka di server; bukan data rahasia), empat digit terakhir, dan "ada /
 * tidak". Isi lengkap hanya lewat aksi buka data (keuangan + PIN + jejak).
 */

export type RingkasPajakKol = {
  kolId: string;
  jenisPajak: JenisPajak;
  alasanTidakDipotong: string | null;
  adaNpwp: boolean;
  grossUpBawaan: boolean;
  dataPajakLengkap: boolean;
  bankNama: string | null;
  bankLast4: string | null;
  nikLast4: string | null;
  ada: Record<KolomSensitif, boolean>;
  kunciTersedia: boolean;
};

export async function ringkasPajakKol(kolId: string): Promise<RingkasPajakKol | null> {
  const k = await prisma.kol.findUnique({
    where: { id: kolId },
    select: {
      id: true,
      jenisPajak: true,
      alasanTidakDipotong: true,
      adaNpwp: true,
      grossUpBawaan: true,
      dataPajakLengkap: true,
      bankNameEnc: true,
      bankAccountEnc: true,
      bankHolderEnc: true,
      nikEnc: true,
      npwpEnc: true,
      bankLast4: true,
      nikLast4: true,
    },
  });
  if (!k) return null;
  const kunci = kunciTersedia();
  let bankNama: string | null = null;
  if (k.bankNameEnc && kunci) {
    try {
      bankNama = dekripsi(k.bankNameEnc, konteksKol(k.id, "bankName"));
    } catch {
      bankNama = null;
    }
  }
  return {
    kolId: k.id,
    jenisPajak: k.jenisPajak as JenisPajak,
    alasanTidakDipotong: k.alasanTidakDipotong,
    adaNpwp: k.adaNpwp,
    grossUpBawaan: k.grossUpBawaan,
    dataPajakLengkap: k.dataPajakLengkap,
    bankNama,
    bankLast4: k.bankLast4,
    nikLast4: k.nikLast4,
    ada: {
      bankName: Boolean(k.bankNameEnc),
      bankAccount: Boolean(k.bankAccountEnc),
      bankHolder: Boolean(k.bankHolderEnc),
      nik: Boolean(k.nikEnc),
      npwp: Boolean(k.npwpEnc),
    },
    kunciTersedia: kunci,
  };
}
